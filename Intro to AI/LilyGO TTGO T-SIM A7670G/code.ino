/*
* Project: Weather-based Flood Alert System with GPS
* Device: LilyGO TTGO T-SIM A7670G
* Sensors: BME280 (temp/hum/pres) + Tipping Bucket (rain) + BH1750 (light) +
* JSN-SR04T (water level) Function: Reads all sensors, computes derived
* metrics, gets GPS location, uploads to Firebase, and sends SMS alerts based
* on Firebase config
*/


#define TINY_GSM_MODEM_A7670
#include <Adafruit_BME280.h>
#include <Adafruit_Sensor.h>
#include <ArduinoHttpClient.h>
#include <ArduinoJson.h>
#include <BH1750.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <TinyGPS++.h>
#include <TinyGsmClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <esp_task_wdt.h>
#include <time.h>


/*
* Required Libraries:
* - TinyGSM by lewisxhe (fork) — https://github.com/lewisxhe/TinyGSM
*   ⚠ Do NOT use the official TinyGSM by vshymanskyy. Remove it if installed.
* - ArduinoHttpClient >= 0.4.0
* - ArduinoJson >= 7.0.0
* - Adafruit BME280 Library
* - Adafruit Unified Sensor
* - BH1750 (by Christopher Laws)
*
* Board: ESP32 Dev Module (or LilyGO T-SIM A7670G if available)
*/
#if ARDUINOJSON_VERSION_MAJOR < 7
#error "ArduinoJson v7+ is required. Update via Arduino Library Manager."
#endif


// --- Firebase Configuration ---
const char server[] = "firestore.googleapis.com";
const int port = 443;
const String firebaseProjectId = "weather-project-a5fb5";
const String firebaseApiKey = "AIzaSyCBrJFnwz7zl4NdJHxh__a43E-76HLmvLY";


// --- SIM Card Settings ---
const char apn[] = "internet.globe.com.ph";


// --- WiFi Settings (Updated from Admin) ---
String wifiSsid = "";
String wifiPass = "";


// --- Pin Definitions for T-SIM A7670G  ---
#define MODEM_RX 27
#define MODEM_TX 26
#define MODEM_PWRKEY 4
#define MODEM_DTR 25
#define MODEM_FLIGHT 15


// I2C_SCL
#define BOARD_POWERON_PIN 12
#define BATTERY_PIN 35
#define RAIN_GAUGE_PIN 34


// I2C Pins for BME280 + BH1750 (GPIO 32 = SDA, GPIO 33 = SCL per working sensor
// sample)
#define I2C_SDA 32
#define I2C_SCL 33


// JSN-SR04T Ultrasonic Water Level Sensor
#define ULTRASONIC_TRIG 14
#define ULTRASONIC_ECHO 36


// GPS Module (standalone, on Serial2)
#define BOARD_GPS_TX_PIN 21
#define BOARD_GPS_RX_PIN 22
#define BOARD_GPS_PPS_PIN 23
#define BOARD_GPS_WAKEUP_PIN 19
#define BOARD_RST_PIN 5


// --- Sensor Calibration Constants ---
// Distance from JSN-SR04T sensor face to the bottom of the channel/drain (cm)
// Adjust this via Admin Dashboard
float sensorHeightCm = 200.0;


// Tipping bucket volume per tip (mm of rain)
const float BUCKET_SIZE = 0.2794;


// Maximum expected lux for clear sky at your location (used for cloud cover
// estimation)
float maxClearSkyLux = 65000.0;
float basePressure = 1013.25;


// --- Configurable Thresholds (updated from Firebase) ---
float alertThreshold = 50.0;
String alertMessage = "FLOOD ALERT! Potential flooding in your area.";
float alertCooldownHours = 5.0;
int normalIntervalMin = 10;
int emergencyIntervalMin = 1;
bool maintenanceMode = false;
float tempOffset = 0.0;
float waterOffset = 0.0;


// --- Timing Intervals ---
unsigned long uploadInterval = 60000;              // Default 1 minute
const unsigned long CONFIG_INTERVAL = 300000;      // 5 minutes
const unsigned long SIM_CHECK_INTERVAL = 86400000; // 24 hours


// --- Global Sensor Variables ---
// Timing & RTC Variables (survive deep sleep)
RTC_DATA_ATTR float totalRainfall = 0.0; // Lifetime rain
RTC_DATA_ATTR float dailyRainfall = 0.0; // Resets daily at midnight
RTC_DATA_ATTR uint64_t lastUploadTime = 0;
RTC_DATA_ATTR uint64_t lastSmsTime = 0;
RTC_DATA_ATTR uint64_t lastConfigCheck = 0;
RTC_DATA_ATTR int lastSimCheckDay = -1;
RTC_DATA_ATTR int lastRainResetDay = -1;
RTC_DATA_ATTR unsigned long bootCount = 0;


// ============================================================
// RAIN GAUGE CONFIGURATION
// ============================================================
#define RAIN_WINDOW_MINUTES    60
#define DEBOUNCE_MS            150
#define DEBOUNCE_US            (DEBOUNCE_MS * 1000ULL)
#define US_PER_MINUTE          60000000ULL
#define INVALID_TIMESTAMP      0xFFFFFFFFFFFFFFFFULL
#define MAX_TIPS_PER_MINUTE    100
#define MIN_REPORTABLE_RATE    0.05f


typedef uint32_t tip_count_t;
typedef int8_t  buffer_index_t;


// ============================================================
// RTC PERSISTENT VARIABLES (Survive Deep Sleep)
// ============================================================
RTC_DATA_ATTR tip_count_t     rtc_todayTips = 0;
RTC_DATA_ATTR uint64_t        rtc_lastMinuteTickUs = INVALID_TIMESTAMP;
RTC_DATA_ATTR uint64_t        rtc_lastTipTimeUs = INVALID_TIMESTAMP;
RTC_DATA_ATTR tip_count_t     rtc_minuteTips[RAIN_WINDOW_MINUTES] = {0};
RTC_DATA_ATTR buffer_index_t  rtc_currentIndex = 0;
RTC_DATA_ATTR bool            rtc_bufferInitialized = false;


// Runtime variables
volatile tip_count_t isr_pendingTips = 0;


RTC_DATA_ATTR float latitude = 0.0;  // Survives deep sleep as GPS fallback
RTC_DATA_ATTR float longitude = 0.0; // Survives deep sleep as GPS fallback
RTC_DATA_ATTR bool gpsHasValidFix = false; // True only after a real satellite fix
RTC_DATA_ATTR int lastRainPinState = HIGH; // Tracks rain gauge pin state across sleep
RTC_DATA_ATTR float rainRateMMH = 0.0;


// Sensor availability flags
bool bmeAvailable = false;
bool bh1750Available = false;


// Per-cycle cached sensor readings (read once, used by both upload functions)
float cachedTemp = 0.0;
float cachedHum = 0.0;
float cachedPres = 0.0;
float cachedLux = -1.0;
float cachedWaterLevel = -1.0;
float cachedRiseRate = 0.0;
float cachedDewPoint = 0.0;
float cachedHeatIndex = 0.0;
float cachedCloudCover = -1.0;
float cachedPresTrend = 0.0;
float cachedBattVolt = 0.0;
String cachedRainIntensity = "None";
bool sensorsCachedThisCycle = false;


// Rain rate tracking
RTC_DATA_ATTR unsigned long lastRainRateCalc = 0;


// Pressure trend tracking (store last 3 hours of readings)
#define PRESSURE_HISTORY_SIZE 36 // 36 readings at ~5min intervals = 3 hours
RTC_DATA_ATTR float pressureHistory[PRESSURE_HISTORY_SIZE];
RTC_DATA_ATTR int pressureHistoryIndex = 0;
RTC_DATA_ATTR int pressureHistoryCount = 0;
RTC_DATA_ATTR unsigned long lastPressureRecord = 0;


// Water level tracking for rise rate
RTC_DATA_ATTR float lastWaterLevel = -1.0;
RTC_DATA_ATTR unsigned long lastWaterLevelTime = 0;
RTC_DATA_ATTR float waterRiseRateCMH = 0.0;


// Hardware
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
WiFiClientSecure wifiClient;
HttpClient wifiHttp(wifiClient, server, port);


// Track whether WiFi actually has internet (not just AP association)
RTC_DATA_ATTR bool wifiHasInternet = false;


Preferences preferences;
Adafruit_BME280 bme;
BH1750 lightMeter;
#define SerialGPS Serial2
TinyGPSPlus gps;


// --- Forward Function Declarations ---
uint64_t getMicrosWallClock();
void initRainBuffer();
int advanceRainBuffer();
void recordRainTips(tip_count_t tips);
float getRainToday_mm();
float getRainRate_mmh();
void syncTime();
String getISOTime();
void connectWiFi();
void connectGPRS();
void ensureConnection();
void updateGPS();
void uploadToFirestore();
void uploadToHistory();
void fetchConfig();
void checkSimStatus();
void checkSimStatusIfNeeded();
void logErrorToFirestore(String type, String message);
void resetManualTrigger();
void fetchUsersAndSendSMS();
void checkDailyRainReset();
void saveOfflineReading(String payload);
void flushOfflineQueue();
void readAllSensors();
bool waitForNetworkCustom(unsigned long timeoutMs = 60000L);
void feedWDT();


// --- Helper to get persistent microseconds across deep sleep ---
uint64_t getMicrosWallClock() {
  struct timeval tv;
  if (gettimeofday(&tv, NULL) != 0) return INVALID_TIMESTAMP;
  return (uint64_t)tv.tv_sec * 1000000ULL + (uint64_t)tv.tv_usec;
}


static inline uint64_t getMicrosMonotonic() {
  return esp_timer_get_time();
}


void initRainBuffer() {
  uint64_t now = getMicrosWallClock();
  if (now == INVALID_TIMESTAMP) return;


  if (!rtc_bufferInitialized) {
    rtc_lastMinuteTickUs = now;
    rtc_currentIndex = 0;
    memset(rtc_minuteTips, 0, sizeof(rtc_minuteTips));
    rtc_bufferInitialized = true;
    Serial.println("[RAIN] Buffer initialized.");
  } else if (now < rtc_lastMinuteTickUs) {
    rtc_lastMinuteTickUs = now; // Clock jump adjustment
  }
}


int advanceRainBuffer() {
  if (!rtc_bufferInitialized) return -1;
  uint64_t now = getMicrosWallClock();
  if (now == INVALID_TIMESTAMP || now < rtc_lastMinuteTickUs) return -1;


  uint64_t elapsed = now - rtc_lastMinuteTickUs;
  int minutesPassed = (int)(elapsed / US_PER_MINUTE);
  if (minutesPassed <= 0) return 0;


  int toAdvance = (minutesPassed > RAIN_WINDOW_MINUTES) ? RAIN_WINDOW_MINUTES : minutesPassed;
  for (int i = 0; i < toAdvance; i++) {
    rtc_currentIndex = (buffer_index_t)((rtc_currentIndex + 1) % RAIN_WINDOW_MINUTES);
    rtc_minuteTips[rtc_currentIndex] = 0;
  }


  rtc_lastMinuteTickUs += (uint64_t)minutesPassed * US_PER_MINUTE;


  // Drift correction
  if (now > rtc_lastMinuteTickUs && (now - rtc_lastMinuteTickUs) > 30000000ULL) {
    rtc_lastMinuteTickUs = now - (now % US_PER_MINUTE);
  }
  return toAdvance;
}


float getRainToday_mm() {
  return (float)rtc_todayTips * BUCKET_SIZE;
}


float getRainRate_mmh() {
  uint32_t totalTips = 0;
  for (int i = 0; i < RAIN_WINDOW_MINUTES; i++) {
    totalTips += rtc_minuteTips[i];
  }
  float rate = (float)totalTips * BUCKET_SIZE * (60.0f / RAIN_WINDOW_MINUTES);
  return (rate < MIN_REPORTABLE_RATE) ? 0.0f : rate;
}


void recordRainTips(tip_count_t tips) {
  if (tips == 0) return;
  if (tips > MAX_TIPS_PER_MINUTE) tips = MAX_TIPS_PER_MINUTE;


  // Note: advanceRainBuffer() is now called only at the start of loop()
  // to ensure data survives between deep sleep wakes.

  uint64_t nowUs = getMicrosWallClock();


  // Update rolling buffer
  rtc_minuteTips[rtc_currentIndex] += tips;
  rtc_todayTips += tips;


  // Update memory variables immediately
  float increment = (float)tips * BUCKET_SIZE;
  totalRainfall += increment;
  dailyRainfall = getRainToday_mm();


  // Calculate instantaneous rain rate (based on time since last tip batch)
  if (rtc_lastTipTimeUs != INVALID_TIMESTAMP && rtc_lastTipTimeUs > 0) {
    uint64_t diffUs = nowUs - rtc_lastTipTimeUs;
    if (diffUs > 0) {
      float intervalHours = (float)diffUs / 3600000000.0;
      rainRateMMH = increment / intervalHours;
    }
  } else {
    rainRateMMH = 0.0;
  }


  rtc_lastTipTimeUs = nowUs;


  // Persistence to flash
  preferences.begin("weather", false);
  preferences.putFloat("rainfall", totalRainfall);
  preferences.putFloat("dailyRainfall", dailyRainfall);
  preferences.end();


  Serial.printf("[RAIN GAUGE] +%.2f mm (%d tips) | Daily: %.2f mm | Rate: %.1f mm/h\n",
                increment, tips, dailyRainfall, getRainRate_mmh());
}


// --- Interrupt Service Routine for Rain Gauge ---
void IRAM_ATTR rainGaugeISR() {
  static uint64_t lastInterruptUs = 0;
  uint64_t now = getMicrosMonotonic();
  if ((now - lastInterruptUs) >= DEBOUNCE_US) {
    lastInterruptUs = now;
    isr_pendingTips++;
  }
}


// ==============================================================
//                          SETUP
// ==============================================================
void setup() {
  // 1. IMMEDIATELY latch all board power pins to keep battery DC-DC regulator active
  pinMode(BOARD_POWERON_PIN, OUTPUT); // GPIO 12 - Main power hold
  digitalWrite(BOARD_POWERON_PIN, HIGH);


  pinMode(MODEM_DTR, OUTPUT);        // GPIO 25 - Wake modem
  digitalWrite(MODEM_DTR, LOW);


  pinMode(MODEM_PWRKEY, OUTPUT);     // GPIO 4
  digitalWrite(MODEM_PWRKEY, LOW);


  Serial.begin(115200);
  delay(100);
  Serial.println("\n=== ULAN System Starting (Full Sensor Suite) ===");


  // 2. Battery Voltage Diagnostic Check
  float initBatt = readBatteryVoltage();
  Serial.printf("[POWER CHECK] Measured Battery Voltage: %.2fV\n", initBatt);
  if (initBatt < 3.65) {
    Serial.println("[POWER WARNING] ⚠️ Battery voltage is low (< 3.65V)! 2A LTE transmission spikes may trigger brownout resets. Charge battery to > 3.8V.");
  }


  // Check Wakeup Cause (Deep Sleep Wakeup vs Cold Boot)
  esp_sleep_wakeup_cause_t wakeup_reason = esp_sleep_get_wakeup_cause();
  int currentRainPinState = digitalRead(RAIN_GAUGE_PIN);


  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
    // Process the tip immediately from the wake event
    // EXT0 wake means the reed switch closed (tip)
    initRainBuffer(); // Ensure buffer is ready
    recordRainTips(1);


    Serial.printf("[RAIN GAUGE] 🌧️ Wake Tip! Daily Total: %.2f mm | Rain Rate: %.1f mm/h\n",
                  getRainToday_mm(), getRainRate_mmh());


    // Always stay awake for a rain event to update the dashboard immediately
    Serial.println("[RAIN GAUGE] Rain detected — Staying awake for immediate dashboard update.");
  }


  lastRainPinState = currentRainPinState;


  // Initialize LittleFS Internal Flash Storage
  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed!");
  } else {
    Serial.println("LittleFS Storage Mounted Successfully.");
  }


  // Initialize Permanent Memory
  preferences.begin("weather", false);
  totalRainfall = preferences.getFloat("rainfall", 0.0);
  dailyRainfall = preferences.getFloat("dailyRainfall", 0.0);

  // Restore RTC today tips from Flash if needed (Cold Boot Recovery)
  if (rtc_todayTips == 0 && dailyRainfall > 0.05) {
    rtc_todayTips = (tip_count_t)(dailyRainfall / BUCKET_SIZE + 0.5);
    Serial.printf("[RAIN] Restored %d tips from Flash to RTC counter.\n", rtc_todayTips);
  }

  Serial.print("Restored Rainfall from memory: Daily=");
  Serial.print(dailyRainfall);
  Serial.print("mm, Total=");
  Serial.println(totalRainfall);


  // Power on logic for LilyGO T-SIM A7670G
  pinMode(BOARD_POWERON_PIN, OUTPUT);
  digitalWrite(BOARD_POWERON_PIN, HIGH);


  pinMode(BOARD_RST_PIN, OUTPUT);
  digitalWrite(BOARD_RST_PIN, LOW);


  // Initialize modem control pins
  pinMode(MODEM_PWRKEY, OUTPUT);
  digitalWrite(MODEM_PWRKEY, LOW);


  // DTR LOW = wake modem from sleep (must allow 300ms for serial UART wake)
  pinMode(MODEM_DTR, OUTPUT);
  digitalWrite(MODEM_DTR, LOW);
  delay(300);


  SerialAT.setRxBufferSize(2048);
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  SerialGPS.begin(9600, SERIAL_8N1, BOARD_GPS_RX_PIN, BOARD_GPS_TX_PIN);


  // Smart Power-On Check: A7670 PWRKEY is a TOGGLE switch.
  // Only pulse PWRKEY if the modem is confirmed OFF to avoid turning an active modem OFF!
  if (!modem.testAT(1000)) {
    delay(300);
    if (!modem.testAT(1000)) {
      Serial.println("[MODEM] Modem is OFF. Pulsing PWRKEY to turn ON...");
      digitalWrite(MODEM_PWRKEY, LOW);
      delay(100);
      digitalWrite(MODEM_PWRKEY, HIGH);
      delay(1000);
      digitalWrite(MODEM_PWRKEY, LOW);
      delay(3000);
    } else {
      Serial.println("[MODEM] Modem is ALREADY ON. Skipping PWRKEY toggle.");
    }
  } else {
    Serial.println("[MODEM] Modem is ALREADY ON. Skipping PWRKEY toggle.");
  }


  Serial.println("Initializing modem...");
  if (!modem.init()) {
    Serial.println("Modem init retry...");
    delay(1000);
    modem.init();
  }


  // Configure SSL for Google Firestore (SNI is mandatory)
  SerialAT.println("AT+CSSLCFG=\"sslversion\",0,3"); // TLS 1.2
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  SerialAT.println("AT+CSSLCFG=\"enableSNI\",0,1"); // Enable SNI
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  SerialAT.println("AT+CSSLCFG=\"ignorertctime\",0,1");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  // Ensure cellular radio RF is fully active and set to Auto network selection (GSM/LTE)
  SerialAT.println("AT+CFUN=1");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  SerialAT.println("AT+CNMP=2");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  // Flush buffer before handoff to network check
  while (SerialAT.available()) SerialAT.read();


  // Wait up to 5 seconds for SIM card PIN to be READY
  Serial.print("Checking SIM card readiness...");
  unsigned long cpinStart = millis();
  while (millis() - cpinStart < 5000) {
    feedWDT();
    if (modem.getSimStatus() == SIM_READY) {
      Serial.println(" SIM READY!");
      break;
    }
    delay(500);
  }


  // Wait for network (robust check for 2G voice + 4G LTE data towers)
  if (!waitForNetworkCustom(30000L)) {
    Serial.println("[CELLULAR WARNING] Network registration check timed out. Proceeding to GPRS attachment...");
  } else {
    Serial.print("Operator: ");
    Serial.println(modem.getOperator());
  }


  // --- Configure SSL client for WiFi HTTPS ---
  wifiClient.setInsecure(); // Simplify for Firestore/Google APIs




  // Load WiFi from preferences ONLY if stored; otherwise keep hardcoded
  // defaults
  String storedSsid = preferences.getString("wifi_ssid", "");
  String storedPass = preferences.getString("wifi_pass", "");
  if (storedSsid.length() > 0) {
    wifiSsid = storedSsid;
    wifiPass = storedPass;
  }
  if (wifiSsid.length() > 0) {
    connectWiFi();
  }


  // Connect GPRS
  connectGPRS();


  // --- Initialize I2C Bus ---
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(100000); // 100kHz standard mode for reliable sensor reads


  // --- Initialize BME280 ---
  if (bme.begin(0x76)) {
    bmeAvailable = true;
    // Set sampling for weather monitoring (low power, filtered)
    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X2,  // temperature
                    Adafruit_BME280::SAMPLING_X16, // pressure (high precision)
                    Adafruit_BME280::SAMPLING_X1,  // humidity
                    Adafruit_BME280::FILTER_X16,   // IIR filter
                    Adafruit_BME280::STANDBY_MS_500);
    Serial.println("BME280 sensor found (optimized sampling).");
  } else {
    Serial.println("BME280 not found! Using default values.");
  }


  // --- Initialize BH1750 Light Sensor ---
  if (lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    bh1750Available = true;
    Serial.println("BH1750 light sensor found.");
  } else {
    Serial.println("BH1750 not found! Light data unavailable.");
  }


  // --- Initialize JSN-SR04T Ultrasonic Sensor ---
  pinMode(ULTRASONIC_TRIG, OUTPUT);
  pinMode(ULTRASONIC_ECHO, INPUT);
  digitalWrite(ULTRASONIC_TRIG, LOW);
  Serial.println("JSN-SR04T ultrasonic sensor initialized.");


  // --- Initialize Battery Pin ---
  pinMode(BATTERY_PIN, INPUT);


  // --- Initialize Rain Gauge ---
  pinMode(RAIN_GAUGE_PIN, INPUT); // GPIO 34 is input-only, use external pull-up

  // Only process wake tip if not already processed in setup's early check
  if (wakeup_reason == ESP_SLEEP_WAKEUP_EXT0) {
      // Clear any pending ISR flags that might have triggered during modem init
      noInterrupts();
      isr_pendingTips = 0;
      interrupts();
  }

  attachInterrupt(digitalPinToInterrupt(RAIN_GAUGE_PIN), rainGaugeISR, FALLING);


  // Initialize pressure history
  memset(pressureHistory, 0, sizeof(pressureHistory));


// Initialize ESP32 Hardware Watchdog Timer at the VERY END of setup() (90
// Second Timeout)
#if defined(ESP_IDF_VERSION_MAJOR) && ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t wdt_config = {.timeout_ms = 90000,
                                     .idle_core_mask =
                                         (1 << portNUM_PROCESSORS) - 1,
                                     .trigger_panic = true};
 esp_task_wdt_reconfigure(&wdt_config);
#else
  esp_task_wdt_init(90, true);
#endif


  Serial.println("=== System Ready (All Sensors Active) ===\n");
}


void feedWDT() {
  static bool taskSubscribed = false;
  if (!taskSubscribed) {
    esp_task_wdt_add(NULL);
    taskSubscribed = true;
  }
  esp_task_wdt_reset();
}


// ==============================================================
//                        MAIN LOOP
// ==============================================================
void loop() {
  // Feed hardware watchdog timer
  feedWDT();


  // Reset sensor cache for this new cycle
  sensorsCachedThisCycle = false;


  // Sync the 5-minute rolling buffer
  advanceRainBuffer();


  // Feed GPS data continuously
  while (SerialGPS.available()) {
    gps.encode(SerialGPS.read());
  }


  // Process rain tips accumulated
  if (isr_pendingTips > 0) {
    noInterrupts();
    tip_count_t pending = isr_pendingTips;
    isr_pendingTips = 0;
    interrupts();


    initRainBuffer(); // Ensure buffer is ready
    recordRainTips(pending);


    Serial.printf("[RAIN GAUGE] Tip Recorded! Daily: %.2f mm | Rate: %.1f mm/h\n",
                  getRainToday_mm(), getRainRate_mmh());
  }


  // Check Daily Rain Counter Reset at 12:00 AM Midnight
  checkDailyRainReset();


  // Dynamic Upload Interval Logic: Emergency mode triggers ONLY if valid alertThreshold > 0
  if ((alertThreshold > 0.0 && getRainToday_mm() >= alertThreshold) || waterRiseRateCMH >= 15.0) {
    uploadInterval = (unsigned long)max(1, emergencyIntervalMin) * 60000;
  } else {
    uploadInterval = (unsigned long)max(1, normalIntervalMin) * 60000;
  }


  // Read all sensors once per cycle (cached for both uploads)
  ensureConnection();
  updateGPS();
  readAllSensors();
  uploadToFirestore();
  uploadToHistory();
  flushOfflineQueue();
  lastUploadTime = getMicrosWallClock();


  // Check config every 5 minutes (300 seconds = 300,000,000 us)
  if (getMicrosWallClock() - lastConfigCheck > 300000000ULL || lastConfigCheck == 0) {
    ensureConnection();
    fetchConfig();
    lastConfigCheck = getMicrosWallClock();
  }


  // Check SIM status after 12:00 AM (midnight) once per calendar day
  checkSimStatusIfNeeded();


  // Alert check (Dynamic cooldown from Admin OR rapid water rise >= 15 cm/h)
  uint64_t cooldownUs = (uint64_t)(alertCooldownHours * 3600.0 * 1000000.0);
  bool isEmergency =
          (getRainToday_mm() >= alertThreshold) || (waterRiseRateCMH >= 15.0);
  if (!maintenanceMode && isEmergency &&
      (getMicrosWallClock() - lastSmsTime > cooldownUs)) {
    ensureConnection();
    fetchUsersAndSendSMS();
    lastSmsTime = getMicrosWallClock();
  }


  // --- Battery Efficiency / Sleep Logic ---
  // Prepare for Deep Sleep with Rain Gauge Interrupt (GPIO 34)
  Serial.printf("Entering sleep for %d minutes... (Rain gauge interrupt active "
                "on GPIO 34)\n",
                uploadInterval / 60000);
  Serial.flush();


  // Final check for tips before sleep
  if (isr_pendingTips > 0) {
    noInterrupts();
    tip_count_t finalTips = isr_pendingTips;
    isr_pendingTips = 0;
    interrupts();
    recordRainTips(finalTips);

    // CRITICAL: Upload one last time so the dashboard is up-to-date during sleep
    Serial.println("[RAIN GAUGE] Late tips detected! Performing final pre-sleep upload...");
    sensorsCachedThisCycle = false;
    readAllSensors();
    uploadToFirestore();
    uploadToHistory();
  }

  // Enable wake up on rain gauge pin (GPIO 34) - always wake on LOW
  esp_sleep_enable_ext0_wakeup(GPIO_NUM_34, 0);


  // Enable timer wake up for next scheduled upload
  uint64_t sleepTimeUs = (uint64_t)uploadInterval * 1000ULL;
  esp_sleep_enable_timer_wakeup(sleepTimeUs);


  // Put modem into DTR hardware sleep mode (~1-3mA) before ESP32 deep sleep.
  // Using sleep mode (not full power-off) to avoid 2A inrush power spikes
  // from 144 daily power cycles that degrade RF components and capacitors.
  // AT+CSCLK=1 + DTR HIGH is the SIMCom-recommended method for IoT periodic
  // wake.
  modem.sleepEnable(true);
  delay(100);
  digitalWrite(MODEM_DTR, HIGH); // DTR HIGH = modem enters ~1mA hardware sleep
  Serial.println("[MODEM] Modem in low-power sleep (DTR HIGH). LED will dim.");
  Serial.flush();


  // Enter ESP32 Deep Sleep
  esp_deep_sleep_start();
}


// ==============================================================
//              SENSOR READING FUNCTIONS
// ==============================================================


// Read JSN-SR04T ultrasonic sensor — returns distance in cm
float readUltrasonicDistance() {
  // Send trigger pulse
  digitalWrite(ULTRASONIC_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRASONIC_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRASONIC_TRIG, LOW);


  // Read echo with timeout (30ms ≈ 5m max range)
  long duration = pulseIn(ULTRASONIC_ECHO, HIGH, 30000);


  if (duration == 0) {
    Serial.println("Ultrasonic: No echo received");
    return -1.0; // Error / out of range
  }


  // Speed of sound: 343 m/s at 20°C → 0.0343 cm/µs → distance = duration *
  // 0.0343 / 2
  float distance = (duration * 0.0343) / 2.0;


  // JSN-SR04T range: 25-450cm — validate
  if (distance < 25.0 || distance > 450.0) {
    return -1.0;
  }


  return distance;
}


// Calculate water level from ultrasonic distance
float calculateWaterLevel() {
  // Take 3 readings and use median for reliability
  float readings[3];
  int validCount = 0;


  for (int i = 0; i < 3; i++) {
    float d = readUltrasonicDistance();
    if (d > 0) {
      readings[validCount++] = d;
    }
    delay(60); // JSN-SR04T needs ~60ms between readings
  }


  if (validCount == 0)
    return -1.0;


  // Sort for median
  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (readings[j] < readings[i]) {
        float tmp = readings[i];
        readings[i] = readings[j];
        readings[j] = tmp;
      }
    }
  }


  float medianDistance = readings[validCount / 2];


  // Water level = sensor height - distance to water surface + Admin Offset
  float waterLevel = (sensorHeightCm - medianDistance) + waterOffset;
  if (waterLevel < 0)
    waterLevel = 0;


  return waterLevel;
}


// Calculate dew point using Magnus formula
float calculateDewPoint(float temp, float humidity) {
  if (humidity <= 0)
    return 0;
  float a = 17.27;
  float b = 237.7;
  float gamma = (a * temp) / (b + temp) + log(humidity / 100.0);
  return (b * gamma) / (a - gamma);
}


// Calculate heat index (Steadman approximation)
float calculateHeatIndex(float temp, float humidity) {
  if (temp < 27.0)
    return temp; // Only meaningful above 27°C


  // Rothfusz regression
  float T = temp * 9.0 / 5.0 + 32.0; // Convert to Fahrenheit
  float R = humidity;


  float HI = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
             6.83783e-3 * T * T - 5.481717e-2 * R * R + 1.22874e-3 * T * T * R +
             8.5282e-4 * T * R * R - 1.99e-6 * T * T * R * R;


  return (HI - 32.0) * 5.0 / 9.0; // Back to Celsius
}


// Estimate cloud cover from light level
float estimateCloudCover(float lux) {
  if (lux < 0)
    return -1.0;


  // At night, cloud cover is not estimable from light
  if (lux < 10)
    return -1.0; // Nighttime


  // Cloud cover ≈ 100 - (current_lux / max_expected_lux * 100)
  float clearSkyRatio = lux / maxClearSkyLux;
  if (clearSkyRatio > 1.0)
    clearSkyRatio = 1.0;


  float cloudCover = (1.0 - clearSkyRatio) * 100.0;
  return max(0.0f, min(100.0f, cloudCover));
}


// Classify rain intensity per WMO standards
String classifyRainIntensity(float rateMMH) {
  if (rateMMH <= 0)
    return "None";
  if (rateMMH < 2.5)
    return "Light";
  if (rateMMH < 7.5)
    return "Moderate";
  if (rateMMH < 50.0)
    return "Heavy";
  return "Violent";
}


// Record pressure for trend calculation
void recordPressure(float pressure) {
  time_t now;
  time(&now);
  if (now < 1600000000) return;


  unsigned long nowSec = (unsigned long)now;
  // Record every 5 minutes (300 seconds)
  if (nowSec - lastPressureRecord >= 300 || lastPressureRecord == 0) {
    pressureHistory[pressureHistoryIndex] = pressure;
    pressureHistoryIndex = (pressureHistoryIndex + 1) % PRESSURE_HISTORY_SIZE;
    if (pressureHistoryCount < PRESSURE_HISTORY_SIZE)
      pressureHistoryCount++;
    lastPressureRecord = nowSec;
  }
}


// Calculate 3-hour pressure trend (hPa change)
float calculatePressureTrend() {
  if (pressureHistoryCount < 2)
    return 0.0;


  // Get oldest and newest valid readings
  int oldestIdx =
          (pressureHistoryIndex - pressureHistoryCount + PRESSURE_HISTORY_SIZE) %
          PRESSURE_HISTORY_SIZE;
  int newestIdx = (pressureHistoryIndex - 1 + PRESSURE_HISTORY_SIZE) %
                  PRESSURE_HISTORY_SIZE;


  return pressureHistory[newestIdx] - pressureHistory[oldestIdx];
}


// Calculate water rise rate in cm/h
float calculateWaterRiseRate(float currentLevel) {
  time_t now;
  time(&now);
  if (now < 1600000000 || currentLevel < 0 || lastWaterLevel < 0) {
    lastWaterLevel = currentLevel;
    lastWaterLevelTime = (unsigned long)now;
    return 0.0;
  }


  unsigned long nowSec = (unsigned long)now;
  unsigned long elapsed = nowSec - lastWaterLevelTime;
  if (elapsed < 60)
    return waterRiseRateCMH; // Don't recalculate too frequently (1 min min)


  float deltaLevel = currentLevel - lastWaterLevel;
  float hoursElapsed = (float)elapsed / 3600.0;


  if (hoursElapsed > 0) {
    waterRiseRateCMH = deltaLevel / hoursElapsed;
  }


  lastWaterLevel = currentLevel;
  lastWaterLevelTime = nowSec;
  return waterRiseRateCMH;
}


// Read Battery Voltage
float readBatteryVoltage() {
  // Assuming a 1:1 voltage divider (100k/100k) on IO35
  int raw = analogRead(BATTERY_PIN);
  float voltage = (raw / 4095.0) * 3.3 *
                  2.1; // 2.1 is typical calibration factor for 1:1 divider
  return voltage;
}


// ==============================================================
//              CONNECTIVITY FUNCTIONS
// ==============================================================


void connectWiFi() {
  if (wifiSsid.length() == 0)
    return;
  Serial.print("Connecting to WiFi: ");
  Serial.println(wifiSsid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());


  // Try for 10 seconds (fail fast if AP is offline to give priority to SIM cellular)
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
    delay(500);
    feedWDT();
    Serial.print(".");
  }


  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" associated!");
    // Verify WiFi actually has internet by testing a quick TLS handshake
    WiFiClientSecure testClient;
    testClient.setInsecure();
    testClient.setTimeout(3); // 3-second quick timeout test
    feedWDT();
    if (testClient.connect(server, port)) {
      testClient.stop();
      wifiHasInternet = true;
      Serial.println("[WiFi] Internet verified — WiFi will be used for Firebase.");
      syncTime();
      return;
    } else {
      wifiHasInternet = false;
      Serial.println("[WiFi] AP connected but NO INTERNET — falling back to cellular.");
    }
  } else {
    wifiHasInternet = false;
    Serial.println(" failed.");
  }


  // Turn WiFi radio completely OFF if WiFi failed/has no internet
  // This prevents background WiFi retries from locking ESP32 sockets during GSM operations
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}


void connectGPRS() {
  feedWDT();
  int csq = modem.getSignalQuality();


  if (csq == 99 || csq <= 0 || csq > 31) {
    Serial.printf("[CELLULAR] Signal Strength (CSQ): %d / 31 (NO SIGNAL / NOT DETECTED)\n", csq);
    if (wifiHasInternet) {
      Serial.println("[GPRS] Skipping cellular data setup — WiFi is active with verified internet.");
      return;
    }
  } else {
    Serial.printf("[CELLULAR] Signal Strength (CSQ): %d / 31 ", csq);
    if (csq < 10) {
      Serial.println("(WEAK SIGNAL)");
    } else if (csq < 15) {
      Serial.println("(FAIR SIGNAL)");
    } else {
      Serial.println("(GOOD SIGNAL)");
    }
  }


  // Always establish GPRS — needed for cellular Firebase AND SMS fallback,
  // even when WiFi is connected (WiFi may lose internet at any time)
  if (modem.isGprsConnected()) {
    Serial.println("[GPRS] Already connected.");
    // Ensure socket layer is open on A7670G
    SerialAT.println("AT+NETOPEN");
    delay(150);
    while (SerialAT.available()) SerialAT.read();
    return;
  }


  // If CSQ is 99 (no cellular tower connection), skip blocking gprsConnect calls
  if (csq == 99 || csq <= 0 || csq > 31) {
    Serial.println("[GPRS] Skipping GPRS attachment: No cellular signal detected.");
    return;
  }


  Serial.print("Connecting to GPRS (");
  Serial.print(apn);
  Serial.print(")...");
  for (int attempt = 0; attempt < 2; attempt++) {
    feedWDT();
    if (modem.gprsConnect(apn)) {
      Serial.println(" success!");
      // Open modem network socket layer
      SerialAT.println("AT+NETOPEN");
      delay(150);
      while (SerialAT.available()) SerialAT.read();
      if (!wifiHasInternet) {
        syncTime(); // Only sync from modem if WiFi didn't already sync
      }
      return;
    }
    feedWDT();
    Serial.print(" retry...");
    delay(1000);
  }


  // Globe APN fallback attempt if primary internet APN fails
  if (!wifiHasInternet) {
    feedWDT();
    Serial.print(" Primary APN failed. Trying fallback APN (http.globe.com.ph)...");
    if (modem.gprsConnect("http.globe.com.ph")) {
      Serial.println(" success!");
      SerialAT.println("AT+NETOPEN");
      delay(150);
      while (SerialAT.available()) SerialAT.read();
      syncTime();
      return;
    }
  }


  Serial.println(" GPRS failed after attempts.");
}


bool waitForNetworkCustom(unsigned long timeoutMs) {
  Serial.print("Waiting for network (2G/4G)...");
  unsigned long start = millis();


  while (millis() - start < timeoutMs) {
    feedWDT();


    // 1. Check standard TinyGSM connection
    if (modem.isNetworkConnected()) {
      Serial.println(" Connected (TinyGSM)!");
      return true;
    }


    // 2. Direct check for 2G CREG + 4G LTE CEREG / CGREG
    SerialAT.println("AT+CREG?");
    delay(250);
    String cregResp = "";
    while (SerialAT.available()) cregResp += (char)SerialAT.read();


    if (cregResp.indexOf("+CREG: 0,1") != -1 || cregResp.indexOf("+CREG: 0,5") != -1 ||
        cregResp.indexOf("+CREG: 1,1") != -1 || cregResp.indexOf("+CREG: 1,5") != -1 ||
        cregResp.indexOf("+CREG: 2,1") != -1 || cregResp.indexOf("+CREG: 2,5") != -1) {
      Serial.println(" Connected (2G/3G CREG)!");
      return true;
    }


    SerialAT.println("AT+CEREG?");
    delay(250);
    String ceregResp = "";
    while (SerialAT.available()) ceregResp += (char)SerialAT.read();


    if (ceregResp.indexOf("+CEREG: 0,1") != -1 || ceregResp.indexOf("+CEREG: 0,5") != -1 ||
        ceregResp.indexOf("+CEREG: 1,1") != -1 || ceregResp.indexOf("+CEREG: 1,5") != -1 ||
        ceregResp.indexOf("+CEREG: 2,1") != -1 || ceregResp.indexOf("+CEREG: 2,5") != -1) {
      Serial.println(" Connected (4G LTE CEREG)!");
      return true;
    }


    SerialAT.println("AT+CGREG?");
    delay(250);
    String cgregResp = "";
    while (SerialAT.available()) cgregResp += (char)SerialAT.read();


    if (cgregResp.indexOf("+CGREG: 0,1") != -1 || cgregResp.indexOf("+CGREG: 0,5") != -1 ||
        cgregResp.indexOf("+CGREG: 1,1") != -1 || cgregResp.indexOf("+CGREG: 1,5") != -1 ||
        cgregResp.indexOf("+CGREG: 2,1") != -1 || cgregResp.indexOf("+CGREG: 2,5") != -1) {
      Serial.println(" Connected (4G Data CGREG)!");
      return true;
    }


    Serial.print(".");
    delay(1000);
  }


  Serial.println(" TIMEOUT");
  return false;
}


void ensureConnection() {
  feedWDT();
  // Wake modem from DTR hardware sleep: pull DTR LOW then disable CSCLK sleep mode
  digitalWrite(MODEM_DTR, LOW);
  delay(200); // Wait for modem to fully wake from hardware sleep
  modem.sleepEnable(false);


  // 1. Try WiFi first (cheaper/no cellular data usage)
  if (wifiSsid.length() > 0 && WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }


  // 2. Re-verify WiFi internet if already connected but was previously good
  if (WiFi.status() == WL_CONNECTED && wifiHasInternet) {
    WiFiClientSecure testClient;
    testClient.setInsecure();
    testClient.setTimeout(3); // 3-second quick timeout test
    feedWDT();
    if (!testClient.connect(server, port)) {
      wifiHasInternet = false;
      Serial.println("[WiFi] Lost internet access — switching to cellular.");
    } else {
      testClient.stop();
    }
  }


  // 3. Always ensure GPRS is up (needed for SMS + cellular Firebase fallback)
  if (!modem.isGprsConnected()) {
    Serial.println("[GPRS] Not connected, establishing cellular data...");
    connectGPRS();
  }
}


void updateGPS() {
  // GPS modules need time to acquire satellite locks after waking from deep
  // sleep. Cold start: 30-60s, Warm start: 5-15s, Hot start: 1-5s.
  // We wait up to 30 seconds, feeding data continuously until a valid fix.


  Serial.print("GPS: Acquiring satellites");


  unsigned long gpsStart = millis();
  const unsigned long GPS_TIMEOUT_MS = 30000; // 30 second max wait
  bool gotFix = false;


  while (millis() - gpsStart < GPS_TIMEOUT_MS) {
    // Feed all available NMEA sentences to TinyGPS++
    while (SerialGPS.available()) {
      gps.encode(SerialGPS.read());
    }


    // Check if we have a valid location fix
    if (gps.location.isValid() && gps.location.isUpdated()) {
      latitude = gps.location.lat();
      longitude = gps.location.lng();
      gpsHasValidFix = true;
      gotFix = true;
      break;
    }


    // Feed watchdog while waiting
    feedWDT();


    // Print progress dot every 2 seconds
    static unsigned long lastDot = 0;
    if (millis() - lastDot > 2000) {
      Serial.print(".");
      lastDot = millis();
    }


    delay(10); // Small yield to prevent tight loop
  }


  if (gotFix) {
    Serial.printf(
            " LOCKED! (%.6f, %.6f) Sats: %d [%lums]\n", latitude, longitude,
            gps.satellites.isValid() ? gps.satellites.value() : 0,
            millis() - gpsStart);
  } else {
    // No fix this cycle — keep previous valid coordinates (RTC_DATA_ATTR
    // survives deep sleep)
    if (gpsHasValidFix) {
      Serial.printf(" NO FIX after %lus. Using last known: (%.6f, %.6f)\n",
                    GPS_TIMEOUT_MS / 1000, latitude, longitude);
    } else {
      Serial.printf(" NO FIX after %lus. No previous valid fix available.\n",
                    GPS_TIMEOUT_MS / 1000);
    }
  }
}


// Unified Firestore HTTP helper (WiFiClientSecure on WiFi / A7670G Hardware SSL engine on Cellular)
int sendFirestoreRequest(String method, String path, String payload, String &responseBody) {
  responseBody = "";


  // 1. WiFi Mode (if connected and internet verified)
  if (WiFi.status() == WL_CONNECTED && wifiHasInternet) {
    wifiHttp.stop();
    if (method == "GET") {
      wifiHttp.get(path);
    } else if (method == "POST") {
      wifiHttp.post(path, "application/json", payload);
    } else if (method == "PATCH") {
      wifiHttp.patch(path, "application/json", payload);
    }
    int status = wifiHttp.responseStatusCode();
    if (status > 0) {
      responseBody = wifiHttp.responseBody();
    }
    wifiHttp.stop();
    return status;
  }


  // 2. Cellular Mode: A7670G Hardware HTTPS Engine
  ensureConnection();


  // Flush any lingering bytes from previous operations
  while (SerialAT.available()) SerialAT.read();


  // Terminate previous HTTP session
  SerialAT.println("AT+HTTPTERM");
  delay(150);
  while (SerialAT.available()) SerialAT.read();


  // Initialize HTTP session
  SerialAT.println("AT+HTTPINIT");
  delay(150);
  while (SerialAT.available()) SerialAT.read();


  // Set bearer profile CID = 1
  SerialAT.println("AT+HTTPPARA=\"CID\",1");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  // Set SSL profile SSLCFG = 0
  SerialAT.println("AT+HTTPPARA=\"SSLCFG\",0");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  // Set URL
  String fullUrl = "https://" + String(server) + path;
  SerialAT.printf("AT+HTTPPARA=\"URL\",\"%s\"\r\n", fullUrl.c_str());
  delay(150);
  while (SerialAT.available()) SerialAT.read();


  // Send payload if present
  if (payload.length() > 0) {
    // Content-Type: application/json (NO \r\n in parameter string!)
    SerialAT.println("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
    delay(100);
    while (SerialAT.available()) SerialAT.read();


    if (method == "PATCH") {
      // Custom HTTP header for PATCH override
      SerialAT.println("AT+HTTPPARA=\"USERDATA\",\"X-HTTP-Method-Override: PATCH\"");
      delay(100);
      while (SerialAT.available()) SerialAT.read();
    }


    // Command modem to receive payload
    SerialAT.printf("AT+HTTPDATA=%d,10000\r\n", payload.length());

    // Wait for "DOWNLOAD" prompt from modem
    unsigned long dataStart = millis();
    bool gotDownload = false;
    String promptBuf = "";
    while (millis() - dataStart < 5000) {
      while (SerialAT.available()) {
        char c = SerialAT.read();
        promptBuf += c;
        if (promptBuf.indexOf("DOWNLOAD") != -1) {
          gotDownload = true;
          break;
        }
      }
      if (gotDownload) break;
      delay(10);
    }


    if (gotDownload) {
      SerialAT.print(payload);
      delay(300); // Allow modem time to consume buffer
      while (SerialAT.available()) SerialAT.read();
    } else {
      Serial.println("[HTTP] ERROR: Modem failed to send DOWNLOAD prompt.");
      SerialAT.println("AT+HTTPTERM");
      return -1;
    }
  }


  // Trigger HTTPACTION: 0 = GET, 1 = POST / PATCH
  int action = (method == "POST" || method == "PATCH") ? 1 : 0;
  SerialAT.printf("AT+HTTPACTION=%d\r\n", action);


  // Wait for +HTTPACTION: <action>,<statusCode>,<dataLen>
  unsigned long start = millis();
  int statusCode = -1;
  int dataLen = 0;
  while (millis() - start < 20000) { // 20s timeout for network/SSL handshake
    if (SerialAT.available()) {
      String line = SerialAT.readStringUntil('\n');
      line.trim();
      if (line.startsWith("+HTTPACTION:")) {
        int firstComma = line.indexOf(',');
        int secondComma = line.indexOf(',', firstComma + 1);
        if (firstComma != -1 && secondComma != -1) {
          statusCode = line.substring(firstComma + 1, secondComma).toInt();
          dataLen = line.substring(secondComma + 1).toInt();
        }
        break;
      }
    }
    feedWDT();
    delay(20);
  }


  // Read response body if request succeeded and response has data
  if (statusCode >= 200 && statusCode < 300 && dataLen > 0) {
    // Wait for modem to stabilize
    delay(150);
    while (SerialAT.available()) SerialAT.read();


    // Read full response data from modem
    SerialAT.printf("AT+HTTPREAD=0,%d\r\n", dataLen);


    String rawResponse = "";
    rawResponse.reserve(dataLen + 512);
    unsigned long readStart = millis();
    unsigned long totalStart = millis();


    // Patient reading loop: wait for full body + final "OK"
    while (millis() - totalStart < 30000) {
      while (SerialAT.available()) {
        rawResponse += (char)SerialAT.read();
        readStart = millis(); // Reset silence timeout
      }


      // Exit condition: We have the "OK" marker and at least the expected data length
      if (rawResponse.indexOf("OK") != -1 && rawResponse.length() > dataLen) {
        break;
      }


      // If we haven't seen a byte in 5 seconds and we already have some data, assume it's finished
      if (rawResponse.length() > 0 && (millis() - readStart > 5000)) {
        break;
      }


      feedWDT();
      delay(20);
    }


    // Extract clean JSON string bounded by outer curly braces { ... }
    int jsonStart = rawResponse.indexOf('{');
    int jsonEnd = rawResponse.lastIndexOf('}');
    if (jsonStart != -1 && jsonEnd != -1 && jsonEnd > jsonStart) {
      responseBody = rawResponse.substring(jsonStart, jsonEnd + 1);
    } else {
      responseBody = "";
    }
  }


  // Terminate HTTP session
  SerialAT.println("AT+HTTPTERM");
  delay(100);
  while (SerialAT.available()) SerialAT.read();


  return statusCode;
}


// Read all sensors once per cycle and cache values
void readAllSensors() {
  if (sensorsCachedThisCycle) return; // Already read this cycle


  // BME280: Temperature, Humidity, Pressure
  cachedTemp = 0.0;
  cachedHum = 0.0;
  cachedPres = 0.0;
  if (bmeAvailable) {
    float t = bme.readTemperature();
    float h = bme.readHumidity();
    float p = bme.readPressure() / 100.0F; // hPa
    if (!isnan(t))
      cachedTemp = t + tempOffset;
    if (!isnan(h))
      cachedHum = h;
    if (!isnan(p)) {
      cachedPres = p;
      recordPressure(p);
    }
  }


  // BH1750: Light Level
  cachedLux = -1.0;
  if (bh1750Available) {
    float lux = lightMeter.readLightLevel();
    if (lux >= 0)
      cachedLux = lux;
  }


  // JSN-SR04T: Water Level (single read, avoids 6x redundant ultrasonic pings)
  cachedWaterLevel = calculateWaterLevel();
  cachedRiseRate = calculateWaterRiseRate(cachedWaterLevel);


  // Battery
  cachedBattVolt = readBatteryVoltage();


  // Derived metrics
  cachedDewPoint = calculateDewPoint(cachedTemp, cachedHum);
  cachedHeatIndex = calculateHeatIndex(cachedTemp, cachedHum);
  cachedCloudCover = estimateCloudCover(cachedLux);
  cachedPresTrend = calculatePressureTrend();
  cachedRainIntensity = classifyRainIntensity(getRainRate_mmh());


  sensorsCachedThisCycle = true;
}


void uploadToFirestore() {
  // Use simple document path WITHOUT updateMask to keep URL short.
  // The A7670G modem has a ~700 char URL limit in AT+HTTPPARA="URL".
  // With 18 updateMask.fieldPaths params, the URL exceeds this limit → HTTP 713.
  // Without updateMask, PATCH replaces the entire document (fine since we write all fields).
  String path = "/v1/projects/" + firebaseProjectId +
                "/databases/(default)/documents/weather/current?key=" +
                firebaseApiKey;


  // Use cached sensor readings
  readAllSensors(); // No-op if already read this cycle


  // Build JSON payload
  JsonDocument doc;
  JsonObject flds = doc["fields"].to<JsonObject>();
  flds["rainfall"]["doubleValue"] = totalRainfall;
  flds["dailyRainfall"]["doubleValue"] = getRainToday_mm();
  flds["lat"]["doubleValue"] = latitude;
  flds["lng"]["doubleValue"] = longitude;
  flds["lastSeen"]["stringValue"] = getISOTime();
  flds["temperature"]["doubleValue"] = cachedTemp;
  flds["humidity"]["doubleValue"] = cachedHum;
  flds["pressure"]["doubleValue"] = cachedPres;
  flds["lightLevel"]["doubleValue"] = cachedLux;
  flds["waterLevel"]["doubleValue"] = cachedWaterLevel;
  flds["dewPoint"]["doubleValue"] = cachedDewPoint;
  flds["heatIndex"]["doubleValue"] = cachedHeatIndex;
  flds["rainRate"]["doubleValue"] = getRainRate_mmh();
  flds["rainIntensity"]["stringValue"] = cachedRainIntensity;
  flds["cloudCover"]["doubleValue"] = cachedCloudCover;
  flds["pressureTrend"]["doubleValue"] = cachedPresTrend;
  flds["waterRiseRate"]["doubleValue"] = cachedRiseRate;
  flds["battery"]["doubleValue"] = cachedBattVolt;


  String payload;
  serializeJson(doc, payload);


  Serial.println("\n==========================================");
  Serial.println(">>> UPLOADING CURRENT DATA TO FIREBASE <<<");
  Serial.printf("  [GPS] Lat: %.6f | Lng: %.6f%s\n", latitude, longitude,
                gpsHasValidFix ? "" : " (NO VALID FIX)");
  Serial.printf("  [DATA] Temp:%.1f°C | Hum:%.0f%% | Pres:%.1fhPa | Lux:%.0f | Rain:%.2fmm | Daily:%.2fmm | Water:%.1fcm\n",
                cachedTemp, cachedHum, cachedPres, cachedLux, totalRainfall, getRainToday_mm(), cachedWaterLevel);
  Serial.printf("  [TIME] Timestamp: %s\n", getISOTime().c_str());


  String resp;
  int statusCode = sendFirestoreRequest("PATCH", path, payload, resp);
  if (statusCode == 200) {
    Serial.println(
            ">>> ✅ FIREBASE CURRENT STATUS UPLOAD SUCCESS (HTTP 200) <<<");
    Serial.println("==========================================\n");
  } else {
    Serial.printf(">>> ❌ FIREBASE UPLOAD FAILED (HTTP %d) - Saved to Offline "
                  "Queue <<<\n",
                  statusCode);
    Serial.println("==========================================\n");
    saveOfflineReading(payload);
  }
}


void uploadToHistory() {
  time_t now;
  time(&now);
  if (now < 1600000000) {
    Serial.println("Skipping history: Time not synced.");
    return;
  }


  String path =
          "/v1/projects/" + firebaseProjectId +
          "/databases/(default)/documents/weather_history?key=" + firebaseApiKey;


  // Use cached sensor readings (no redundant sensor reads or ultrasonic pings)
  readAllSensors(); // No-op if already read this cycle


  JsonDocument doc;
  JsonObject flds = doc["fields"].to<JsonObject>();
  flds["rainfall"]["doubleValue"] = totalRainfall;
  flds["temperature"]["doubleValue"] = cachedTemp;
  flds["humidity"]["doubleValue"] = cachedHum;
  flds["pressure"]["doubleValue"] = cachedPres;
  flds["lightLevel"]["doubleValue"] = cachedLux;
  flds["waterLevel"]["doubleValue"] = cachedWaterLevel;
  flds["dewPoint"]["doubleValue"] = cachedDewPoint;
  flds["heatIndex"]["doubleValue"] = cachedHeatIndex;
  flds["rainRate"]["doubleValue"] = getRainRate_mmh();
  flds["cloudCover"]["doubleValue"] = cachedCloudCover;
  flds["pressureTrend"]["doubleValue"] = cachedPresTrend;
  flds["waterRiseRate"]["doubleValue"] = cachedRiseRate;
  flds["timestamp"]["timestampValue"] = getISOTime();


  String payload;
  serializeJson(doc, payload);


  Serial.println(">>> UPLOADING TO WEATHER_HISTORY COLLECTION <<<");
  String resp;
  int statusCode = sendFirestoreRequest("POST", path, payload, resp);
  if (statusCode == 200 || statusCode == 201) {
    Serial.println(">>> ✅ FIREBASE HISTORY LOG CREATED (HTTP 200) <<<");
    Serial.println("==========================================\n");
  } else {
    Serial.printf(">>> ❌ HISTORY LOG FAILED (HTTP %d) <<<\n", statusCode);
    Serial.println("==========================================\n");
  }
}


// ==============================================================
//              CONFIG & ALERTS
// ==============================================================


void fetchConfig() {
  Serial.println("Fetching config from Admin...");
  String path =
          "/v1/projects/" + firebaseProjectId +
          "/databases/(default)/documents/weather/config?key=" + firebaseApiKey;


  String response;
  int statusCode = sendFirestoreRequest("GET", path, "", response);
  if (statusCode == 200) {
    // Ensure response looks like valid JSON before parsing
    response.trim();
    if (response.length() == 0 || response[0] != '{') {
      Serial.println(F("Config response is not valid JSON. Skipping."));
      return;
    }


    // Increased buffer to 4096 bytes for large Firestore responses
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, response);
    if (error) {
      Serial.print(F("deserializeJson() failed: "));
      Serial.println(error.f_str());
      return;
    }


    if (doc.containsKey("fields")) {
      JsonObject fields = doc["fields"];


      // Helper to parse double or integer values from Firestore
      auto getDouble = [&](const char* key, float defaultValue) -> float {
          if (!fields.containsKey(key)) return defaultValue;
          JsonObject field = fields[key];
          if (field.containsKey("doubleValue")) return field["doubleValue"].as<float>();
          if (field.containsKey("integerValue")) return field["integerValue"].as<String>().toFloat();
          return defaultValue;
      };


      auto getInt = [&](const char* key, int defaultValue) -> int {
          if (!fields.containsKey(key)) return defaultValue;
          JsonObject field = fields[key];
          if (field.containsKey("integerValue")) return field["integerValue"].as<String>().toInt();
          if (field.containsKey("doubleValue")) return field["doubleValue"].as<int>();
          return defaultValue;
      };


      // Basic Thresholds
      alertThreshold = getDouble("alertThreshold", alertThreshold);


      if (fields.containsKey("alertMessage")) {
        alertMessage = fields["alertMessage"]["stringValue"].as<String>();
      }


      // WiFi Configuration
      if (fields.containsKey("wifiSSID")) {
        String newSsid = fields["wifiSSID"]["stringValue"].as<String>();
        if (newSsid != wifiSsid) {
          wifiSsid = newSsid;
          preferences.putString("wifi_ssid", wifiSsid);
          wifiHasInternet = false;
        }
      }
      if (fields.containsKey("wifiPass")) {
        String newPass = fields["wifiPass"]["stringValue"].as<String>();
        if (newPass != wifiPass) {
          wifiPass = newPass;
          preferences.putString("wifi_pass", wifiPass);
          wifiHasInternet = false;
        }
      }


      // Advanced Timing & Modes
      alertCooldownHours = getDouble("alertCooldown", alertCooldownHours);
      normalIntervalMin = getInt("normalInterval", normalIntervalMin);
      emergencyIntervalMin = getInt("emergencyInterval", emergencyIntervalMin);


      if (fields.containsKey("maintenanceMode")) {
        maintenanceMode = fields["maintenanceMode"]["booleanValue"];
      }


      // Calibration
      tempOffset = getDouble("tempOffset", tempOffset);
      waterOffset = getDouble("waterOffset", waterOffset);
      sensorHeightCm = getDouble("mountHeight", sensorHeightCm);


      if (fields.containsKey("manualSmsTrigger")) {
        bool trigger = fields["manualSmsTrigger"]["booleanValue"];
        if (trigger) {
          Serial.println("MANUAL SMS TRIGGER DETECTED!");
          fetchUsersAndSendSMS();
          resetManualTrigger();
          return;
        }
      }


      maxClearSkyLux = getDouble("maxClearLux", maxClearSkyLux);
      basePressure = getDouble("basePressure", basePressure);


      Serial.printf("Config Sync: Thr:%.1f CD:%.1fhr Norm:%dm Emerg:%dm Maint:%s\n",
                    alertThreshold, alertCooldownHours, normalIntervalMin,
                    emergencyIntervalMin, maintenanceMode ? "ON" : "OFF");
    }
  } else {
    Serial.print("Config fetch failed, HTTP: ");
    Serial.println(statusCode);
    logErrorToFirestore("Board",
                        "Failed to fetch config. HTTP: " + String(statusCode));
  }
}


void checkDailyRainReset() {
  time_t now;
  time(&now);
  if (now < 1600000000)
    return; // Time not synced yet


  struct tm timeinfo;
  localtime_r(&now, &timeinfo);


  // On very first boot (lastRainResetDay == -1), just record today's day
  // without resetting
  if (lastRainResetDay == -1) {
    lastRainResetDay = timeinfo.tm_mday;
    Serial.printf("[RAIN RESET] First boot: Recording today (%04d-%02d-%02d) "
                  "as baseline. No reset needed.\n",
                  timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                  timeinfo.tm_mday);
    return;
  }


  // Only reset at actual midnight (hour == 0) when the calendar day has changed
  if (timeinfo.tm_mday != lastRainResetDay && timeinfo.tm_hour == 0) {
    rtc_todayTips = 0;
    dailyRainfall = 0.0;
    lastRainResetDay = timeinfo.tm_mday;
    preferences.begin("weather", false);
    preferences.putFloat("dailyRainfall", 0.0);
    Serial.printf("[RAIN RESET] Midnight reached (%04d-%02d-%02d): Daily rain "
                  "counter reset to 0.0 mm\n",
                  timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                  timeinfo.tm_mday);
  }
}


void saveOfflineReading(String payload) {
  File file = LittleFS.open("/offline_queue.jsonl", "a");
  if (file) {
    file.println(payload);
    file.close();
    Serial.println("[OFFLINE QUEUE] Connection down. Payload cached to "
                   "internal LittleFS Flash.");
  } else {
    Serial.println("[OFFLINE QUEUE] Error opening LittleFS file for writing!");
  }
}


void flushOfflineQueue() {
  if (!(WiFi.status() == WL_CONNECTED && wifiHasInternet) && !modem.isGprsConnected())
    return;
  if (!LittleFS.exists("/offline_queue.jsonl"))
    return;


  File file = LittleFS.open("/offline_queue.jsonl", "r");
  if (!file)
    return;


  Serial.println(
          "[OFFLINE QUEUE] Reconnected! Flushing cached readings to Firestore...");
  String path =
          "/v1/projects/" + firebaseProjectId +
          "/databases/(default)/documents/weather_history?key=" + firebaseApiKey;


  int count = 0;
  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      String resp;
      sendFirestoreRequest("POST", path, line, resp);
      count++;
      delay(200);
    }
  }
  file.close();
  LittleFS.remove("/offline_queue.jsonl");
  Serial.printf("[OFFLINE QUEUE] Successfully uploaded %d offline records to "
                "Firestore.\n",
                count);
}


void checkSimStatusIfNeeded() {
  time_t now;
  time(&now);
  if (now < 1600000000)
    return; // Time not synced yet


  struct tm timeinfo;
  localtime_r(&now, &timeinfo);


  // Check once per calendar day after 12:00 AM (midnight)
  if (timeinfo.tm_mday != lastSimCheckDay) {
    Serial.printf(
            "New day detected (%04d-%02d-%02d %02d:%02d), checking SIM status...\n",
            timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
            timeinfo.tm_hour, timeinfo.tm_min);
    ensureConnection();
    checkSimStatus();
    lastSimCheckDay = timeinfo.tm_mday;
  }
}


void checkSimStatus() {
  Serial.println("Checking SIM Status via SMS (DATA BAL to 8080)...");


  // 1. Send the request SMS
  if (!modem.sendSMS("8080", "DATA BAL")) {
    Serial.println("❌ Failed to send SMS request to 8080");
    logErrorToFirestore("SIM", "Failed to send DATA BAL request to 8080.");
    return;
  }
  Serial.println("✅ Request sent. Waiting 20 seconds for network reply...");


  // 2. Wait for the reply (8080 usually responds within 5-15 seconds)
  // We loop and feed the watchdog while waiting
  for (int i = 0; i < 10; i++) {
    delay(2000);
    feedWDT();
  }


  // 3. Look for the reply from 8080
  // We'll use a direct AT command to list unread messages
  SerialAT.println("AT+CMGL=\"REC UNREAD\"");


  String response = "";
  unsigned long timeout = millis() + 5000;
  while (millis() < timeout) {
    if (SerialAT.available()) {
      response += SerialAT.readString();
    }
    feedWDT();
  }


  // 4. Parse the response if it contains "8080"
  if (response.indexOf("8080") != -1) {
    int cmglPos = response.indexOf("+CMGL:");
    if (cmglPos != -1) {
      int firstComma = response.indexOf(',', cmglPos);
      String indexStr = response.substring(cmglPos + 7, firstComma);
      int smsIndex = indexStr.toInt();


      // Read the specific message content
      SerialAT.printf("AT+CMGR=%d\r\n", smsIndex);
      delay(1000);
      String fullContent = SerialAT.readString();


      // Basic cleaning to get the text between the header and the "OK"
      int headerEnd = fullContent.indexOf('\n', fullContent.indexOf("+CMGR:"));
      int footerStart = fullContent.lastIndexOf("OK");
      String cleanMsg = "No text found";


      if (headerEnd != -1 && footerStart > headerEnd) {
        cleanMsg = fullContent.substring(headerEnd + 1, footerStart);
        cleanMsg.trim();
        cleanMsg.replace("\"", ""); // Remove extra quotes
      }


      Serial.println("Fetched SMS Balance: " + cleanMsg);


      // 5. Upload the clean SMS text to Firebase
      String path = "/v1/projects/" + firebaseProjectId +
                    "/databases/(default)/documents/weather/sim?key=" +
                    firebaseApiKey;
      JsonDocument doc;
      JsonObject fields = doc["fields"].to<JsonObject>();
      fields["status"]["stringValue"] = cleanMsg;
      fields["lastCheck"]["stringValue"] = getISOTime();


      String payload;
      serializeJson(doc, payload);
      String resp;
      sendFirestoreRequest("PATCH", path, payload, resp);


      // 6. Delete the SMS from the SIM card to keep memory free
      SerialAT.printf("AT+CMGD=%d\r\n", smsIndex);
      Serial.println("SIM Status updated and SMS memory cleared.");
    }
  } else {
    Serial.println("No reply from 8080 found in memory yet.");
    logErrorToFirestore("SIM", "DATA BAL request sent. Check back next cycle for response.");
  }
}


void logErrorToFirestore(String type, String message) {
  String path = "/v1/projects/" + firebaseProjectId +
                "/databases/(default)/documents/logs?key=" + firebaseApiKey;
  JsonDocument doc;
  JsonObject fields = doc["fields"].to<JsonObject>();
  fields["type"]["stringValue"] = type;
  fields["message"]["stringValue"] = message;
  fields["timestamp"]["stringValue"] = getISOTime();


  String payload;
  serializeJson(doc, payload);
  String resp;
  sendFirestoreRequest("POST", path, payload, resp);
}


void resetManualTrigger() {
  String path = "/v1/projects/" + firebaseProjectId +
                "/databases/(default)/documents/weather/"
                "config?updateMask.fieldPaths=manualSmsTrigger&key=" +
                firebaseApiKey;
  JsonDocument doc;
  JsonObject flds = doc["fields"].to<JsonObject>();
  flds["manualSmsTrigger"]["booleanValue"] = false;
  String payload;
  serializeJson(doc, payload);
  String resp;
  sendFirestoreRequest("PATCH", path, payload, resp);
  Serial.println("Manual trigger reset.");
}


void fetchUsersAndSendSMS() {
  // Update GPS coordinates to get latest position
  updateGPS();


  // High Priority: Ensure cellular network registration before sending SMS
  if (!modem.isNetworkConnected()) {
    Serial.println("Cellular disconnected! Attempting high-priority network "
                   "registration for SMS...");
    waitForNetworkCustom(15000L);
  }


  String path = "/v1/projects/" + firebaseProjectId +
                "/databases/(default)/documents/users?key=" + firebaseApiKey;
  String response;
  int statusCode = sendFirestoreRequest("GET", path, "", response);
  if (statusCode == 200) {


    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, response);
    if (err || !doc.containsKey("documents")) {
      Serial.println("No users found or JSON parse error.");
      return;
    }


    JsonArray documents = doc["documents"];
    int totalUsers = documents.size();
    int sentCount = 0;
    Serial.printf(
            "Found %d user accounts. Starting robust bulk SMS dispatch...\n",
            totalUsers);


    for (int i = 0; i < totalUsers; i++) {
      // 1. Feed Hardware Watchdog Timer to prevent WDT resets on large contact
      // lists
      feedWDT();


      JsonObject userDoc = documents[i];
      if (!userDoc.containsKey("fields"))
        continue;
      JsonObject fields = userDoc["fields"];
      if (!fields.containsKey("phoneNumber") ||
          !fields["phoneNumber"].containsKey("stringValue"))
        continue;


      String phone = fields["phoneNumber"]["stringValue"].as<String>();
      phone.trim();
      if (phone.length() == 0)
        continue;


      // 2. Format custom message + Rain info + Google Maps URL
      String msg = alertMessage;
      if (msg.indexOf("mm") == -1 && msg.indexOf("Rain") == -1) {
        msg += " Daily Rain: " + String(getRainToday_mm(), 1) + "mm.";
      }
      if (msg.indexOf("maps.google.com") == -1 && latitude != 0.0 &&
          longitude != 0.0) {
        msg +=
                " Location: https://maps.google.com/maps?q=" + String(latitude, 6) +
                "," + String(longitude, 6);
      }


      // 3. Robust Retry Logic (up to 2 attempts per number)
      bool sentSuccess = false;
      for (int attempt = 1; attempt <= 2; attempt++) {
        // Verify cellular network connection mid-loop before sending
        if (!modem.isNetworkConnected()) {
          Serial.printf(
                  "Network dropped before SMS to %s. Re-registering cellular...\n",
                  phone.c_str());
          waitForNetworkCustom(10000L);
        }


        if (modem.sendSMS(phone, msg)) {
          sentSuccess = true;
          sentCount++;
          Serial.printf("[SMS %d/%d] Sent to %s (SUCCESS)\n", i + 1, totalUsers,
                        phone.c_str());
          break;
        } else {
          Serial.printf("[SMS %d/%d] Attempt %d failed for %s\n", i + 1,
                        totalUsers, attempt, phone.c_str());
          delay(1000); // Brief pause before retry
        }
      }


      if (!sentSuccess) {
        logErrorToFirestore("SMS", "Failed to send SMS to " + phone +
                                   " after 2 attempts.");
      }


      // 4. Inter-SMS delay (2 seconds) to let SIM card SMSC process cleanly
      delay(2000);
    }


    Serial.printf("Bulk SMS Summary: Successfully sent %d / %d messages.\n",
                  sentCount, totalUsers);
  } else {
    Serial.print("Fetch users failed, HTTP: ");
    Serial.println(statusCode);
    logErrorToFirestore("Board",
                        "Failed to fetch users. HTTP: " + String(statusCode));
  }
}


// ==============================================================
//              TIME UTILITIES
// ==============================================================


void syncTime() {
  Serial.println("Syncing time from network...");
  int year, month, day, hour, min, sec;
  float timezone;
  if (modem.getNetworkTime(&year, &month, &day, &hour, &min, &sec, &timezone)) {
    struct tm tm;
    tm.tm_year = year - 1900;
    tm.tm_mon = month - 1;
    tm.tm_mday = day;
    tm.tm_hour = hour;
    tm.tm_min = min;
    tm.tm_sec = sec;
    tm.tm_isdst = 0;
    time_t t = mktime(&tm);
    // Modem returns local time; adjust to UTC using timezone (in quarter-hours)
    t -= (long)(timezone * 15 * 60);
    struct timeval now = {.tv_sec = t, .tv_usec = 0};
    settimeofday(&now, NULL);
    Serial.println("Time synced from network!");
  } else {
    Serial.println("Network time failed, trying GPS...");
    // Feed GPS data briefly
    unsigned long start = millis();
    while (millis() - start < 2000) {
      while (SerialGPS.available())
        gps.encode(SerialGPS.read());
    }
    if (gps.date.isValid() && gps.time.isValid()) {
      struct tm tm;
      tm.tm_year = gps.date.year() - 1900;
      tm.tm_mon = gps.date.month() - 1;
      tm.tm_mday = gps.date.day();
      tm.tm_hour = gps.time.hour();
      tm.tm_min = gps.time.minute();
      tm.tm_sec = gps.time.second();
      tm.tm_isdst = 0;
      time_t t = mktime(&tm); // GPS time is already UTC
      struct timeval now = {.tv_sec = t, .tv_usec = 0};
      settimeofday(&now, NULL);
      Serial.println("Time synced from GPS!");
    } else {
      Serial.println("GPS time also unavailable.");
    }
  }
}


String getISOTime() {
  time_t now;
  time(&now);
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buffer);
}



