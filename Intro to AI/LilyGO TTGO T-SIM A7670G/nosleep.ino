/*
* Project: Simple Continuous Weather-based Flood Alert System
* Device: LilyGO TTGO T-SIM A7670G
* Features: Continuous monitoring, Real-time GPS, Immediate Firebase Updates,
*           Offline Queuing, SMS Alerts, Derived Metrics.
* Timing: 10m normal / 1m emergency (Dynamic)
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

// --- Firebase Configuration ---
const char server[] = "firestore.googleapis.com";
const int port = 443;
const String firebaseProjectId = "weather-project-a5fb5";
const String firebaseApiKey = "AIzaSyCBrJFnwz7zl4NdJHxh__a43E-76HLmvLY";
const char apn[] = "internet.globe.com.ph";

// --- Pin Definitions for T-SIM A7670G (Synced with code.ino) ---
#define MODEM_RX 27
#define MODEM_TX 26
#define MODEM_PWRKEY 4
#define MODEM_DTR 25
#define BOARD_POWERON_PIN 12
#define BATTERY_PIN 35
#define RAIN_PIN 34
#define I2C_SDA 32
#define I2C_SCL 33
#define TRIG_PIN 14
#define ECHO_PIN 36
#define GPS_RX 22
#define GPS_TX 21
#define BOARD_RST_PIN 5

// --- Constants ---
const float BUCKET_SIZE = 0.2794;
const float CLEAR_SKY_MAX_LUX = 65000.0;
float mountHeightCm = 200.0;

// --- Thresholds & Intervals ---
float alertThreshold = 50.0;
String alertMessage = "FLOOD ALERT!";
int normalIntervalMin = 10;
int emergencyIntervalMin = 1;
float alertCooldownHours = 5.0;

// --- Global State ---
unsigned long lastUploadMillis = 0;
unsigned long lastConfigMillis = 0;
unsigned long lastSmsMillis = 0;
unsigned long lastWaterLevelMillis = 0;
unsigned long lastSimCheckMillis = 0;
unsigned long lastSerialPrintMillis = 0;

// --- Rain Tracking (10-Minute Moving Window) ---
volatile unsigned long todayTips = 0;
volatile unsigned long lastTipTimeMs = 0;
volatile bool newTipDetected = false;

const int RAIN_BUFFER_SIZE = 10;       // 10 slots (1 per minute)
unsigned int minuteTips[RAIN_BUFFER_SIZE] = {0};
int currentMinuteIndex = 0;
unsigned long lastMinuteTickMs = 0;

float dailyRainfall = 0.0;
float latitude = 0.0, longitude = 0.0;
bool gpsHasValidFix = false;
float lastWaterLevel = -1.0;
float waterRiseRateCMH = 0.0;

// Hardware
HardwareSerial SerialAT(1);
TinyGsm modem(SerialAT);
WiFiClientSecure wifiClient;
HttpClient wifiHttp(wifiClient, server, port);
Adafruit_BME280 bme;
BH1750 lightMeter;
#define SerialGPS Serial2
TinyGPSPlus gps;
Preferences preferences;

bool bmeOnline = false;
bool bh1750Online = false;
bool wifiHasInternet = false;

// --- Interrupt Service Routine ---
void IRAM_ATTR countTip() {
    unsigned long now = millis();
    if (now - lastTipTimeMs > 250) { // 250ms debounce
        todayTips++;
        lastTipTimeMs = now;
        newTipDetected = true;
    }
}

// ==========================================
// METRICS & CALCULATIONS
// ==========================================

float getRainToday_mm() {
    return (float)todayTips * BUCKET_SIZE;
}

float getRainRate_mmh() {
    unsigned int tipsInLast10Min = 0;
    for (int i = 0; i < RAIN_BUFFER_SIZE; i++) {
        tipsInLast10Min += minuteTips[i];
    }
    // (Rain in 10 mins * 6) = Rain per hour
    return ((float)tipsInLast10Min * BUCKET_SIZE) * 6.0;
}

float calculateDewPoint(float t, float h) {
    if (isnan(t) || isnan(h) || h <= 0) return NAN;
    float alpha = ((17.27 * t) / (237.7 + t)) + log(h / 100.0);
    return (237.7 * alpha) / (17.27 - alpha);
}

float calculateFeelsLike(float t, float h) {
    if (t < 26.7 || h < 40.0) return t;
    float T = (t * 1.8) + 32.0;
    float HI = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (h * 0.094));
    if (HI >= 80.0) {
        HI = -42.379 + 2.04901523 * T + 10.14333127 * h - 0.22475541 * T * h
             - 0.00683783 * T * T - 0.05481717 * h * h + 0.00122874 * T * T * h
             + 0.00085282 * T * h * h - 0.00000199 * T * T * h * h;
    }
    return (HI - 32.0) / 1.8;
}

float estimateCloudCover(float lux) {
    if (lux < 50.0) return -1.0;
    float cover = (1.0 - (lux / CLEAR_SKY_MAX_LUX)) * 100.0;
    return max(0.0f, min(100.0f, cover));
}

float getWaterLevel() {
    digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);
    if (duration == 0) return -1.0;
    float airGap = (duration * 0.0343) / 2.0;
    if (airGap < 20 || airGap > 450) return -1.0;
    float depth = mountHeightCm - airGap;
    return max(0.0f, depth);
}

float getAirGap() {
    digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long duration = pulseIn(ECHO_PIN, HIGH, 30000);
    if (duration == 0) return -1.0;
    return (duration * 0.0343) / 2.0;
}

float calculateRiseRate(float current) {
    unsigned long now = millis();
    if (lastWaterLevel < 0 || current < 0) {
        lastWaterLevel = current; lastWaterLevelMillis = now;
        return 0.0;
    }
    unsigned long elapsed = now - lastWaterLevelMillis;
    if (elapsed < 60000) return waterRiseRateCMH;
    waterRiseRateCMH = (current - lastWaterLevel) / ((float)elapsed / 3600000.0);
    lastWaterLevel = current; lastWaterLevelMillis = now;
    return waterRiseRateCMH;
}

// ==========================================
// CONNECTIVITY & CONFIG
// ==========================================

void ensureConnection() {
    // 1. Try WiFi
    if (WiFi.status() != WL_CONNECTED) {
        preferences.begin("weather", true);
        String ssid = preferences.getString("wifi_ssid", "");
        String pass = preferences.getString("wifi_pass", "");
        preferences.end();
        if (ssid.length() > 0) {
            WiFi.begin(ssid.c_str(), pass.c_str());
            unsigned long start = millis();
            while (WiFi.status() != WL_CONNECTED && millis() - start < 5000) {
                delay(100);
                esp_task_wdt_reset();
            }
        }
    }

    if (WiFi.status() == WL_CONNECTED) {
        // Quick verification of internet access
        WiFiClientSecure testClient;
        testClient.setInsecure();
        testClient.setTimeout(3);
        if (testClient.connect(server, port)) {
            testClient.stop();
            wifiHasInternet = true;
        } else {
            wifiHasInternet = false;
        }
    } else {
        wifiHasInternet = false;
    }

    // 2. Try SIM if WiFi fails
    if (!wifiHasInternet) {
        if (!modem.isNetworkConnected()) {
            Serial.println("[MODEM] Searching for network...");
            unsigned long start = millis();
            while (!modem.waitForNetwork(1000) && millis() - start < 30000) {
                Serial.print(".");
                esp_task_wdt_reset();
            }
        }

        if (modem.isNetworkConnected() && !modem.isGprsConnected()) {
            Serial.println("[MODEM] Network found. Connecting GPRS...");
            if (modem.gprsConnect(apn)) {
                SerialAT.println("AT+NETOPEN");
                Serial.println("✅ GPRS Connected.");
            } else {
                Serial.println("❌ GPRS Failed.");
            }
        }
    }
}

int sendFirestoreRequest(String method, String path, String payload, String &responseBody) {
    responseBody = "";

    // 1. WiFi Mode
    if (WiFi.status() == WL_CONNECTED && wifiHasInternet) {
        wifiHttp.stop();
        if (method == "GET") wifiHttp.get(path);
        else if (method == "POST") wifiHttp.post(path, "application/json", payload);
        else if (method == "PATCH") wifiHttp.patch(path, "application/json", payload);
        int status = wifiHttp.responseStatusCode();
        responseBody = wifiHttp.responseBody();
        wifiHttp.stop();
        return status;
    }

    // 2. Cellular Mode: A7670G Hardware HTTPS Engine
    ensureConnection();
    while (SerialAT.available()) SerialAT.read(); // Flush

    SerialAT.println("AT+HTTPTERM");
    delay(150);
    SerialAT.println("AT+HTTPINIT");
    delay(150);
    SerialAT.println("AT+HTTPPARA=\"CID\",1");
    delay(100);
    SerialAT.println("AT+HTTPPARA=\"SSLCFG\",0");
    delay(100);
    String fullUrl = "https://" + String(server) + path;
    SerialAT.printf("AT+HTTPPARA=\"URL\",\"%s\"\r\n", fullUrl.c_str());
    delay(150);

    if (payload.length() > 0) {
        SerialAT.println("AT+HTTPPARA=\"CONTENT\",\"application/json\"");
        delay(100);
        if (method == "PATCH") {
            SerialAT.println("AT+HTTPPARA=\"USERDATA\",\"X-HTTP-Method-Override: PATCH\"");
            delay(100);
        }
        SerialAT.printf("AT+HTTPDATA=%d,10000\r\n", payload.length());

        // Wait for DOWNLOAD prompt
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
            esp_task_wdt_reset();
        }

        if (gotDownload) {
            SerialAT.print(payload);
            delay(500);
        } else {
            Serial.println("❌ Failed to get DOWNLOAD prompt from modem.");
            return -1;
        }
    }

    int action = (method == "POST" || method == "PATCH") ? 1 : 0;
    SerialAT.printf("AT+HTTPACTION=%d\r\n", action);

    unsigned long start = millis();
    int statusCode = -1;
    while (millis() - start < 20000) {
        if (SerialAT.available()) {
            String line = SerialAT.readStringUntil('\n');
            if (line.indexOf("+HTTPACTION:") != -1) {
                int first = line.indexOf(','), second = line.indexOf(',', first + 1);
                statusCode = line.substring(first + 1, second).toInt();
                break;
            }
        }
        esp_task_wdt_reset();
    }

    SerialAT.println("AT+HTTPTERM");
    return statusCode;
}

void fetchConfig() {
    String path = "/v1/projects/" + firebaseProjectId + "/databases/(default)/documents/weather/config?key=" + firebaseApiKey;
    String response = "";
    int status = sendFirestoreRequest("GET", path, "", response);

    if (status >= 200 && status < 300 && response.length() > 0) {
        JsonDocument doc;
        deserializeJson(doc, response);
        if (doc.containsKey("fields")) {
            JsonObject f = doc["fields"];
            if (f.containsKey("alertThreshold")) alertThreshold = f["alertThreshold"]["doubleValue"];
            if (f.containsKey("normalInterval")) normalIntervalMin = f["normalInterval"]["integerValue"].as<String>().toInt();
            if (f.containsKey("emergencyInterval")) emergencyIntervalMin = f["emergencyInterval"]["integerValue"].as<String>().toInt();
            if (f.containsKey("mountHeight")) mountHeightCm = f["mountHeight"]["doubleValue"];
        }
    }
}

void checkSimStatus() {
    Serial.println("[SIM] Checking Balance via SMS (DATA BAL to 8080)...");
    if (!modem.isNetworkConnected()) modem.waitForNetwork(15000);

    if (!modem.isNetworkConnected()) {
        Serial.println("❌ No operator signal. Skipping balance check.");
        return;
    }

    if (!modem.sendSMS("8080", "DATA BAL")) {
        Serial.println("❌ Failed to send SMS request to 8080");
        return;
    }
    Serial.println("✅ Request sent. Waiting 20 seconds for carrier reply...");
    for (int i = 0; i < 10; i++) {
        delay(2000);
        esp_task_wdt_reset();
    }
    SerialAT.println("AT+CMGL=\"REC UNREAD\"");
    String response = "";
    unsigned long timeout = millis() + 5000;
    while (millis() < timeout) {
        if (SerialAT.available()) response += SerialAT.readString();
        esp_task_wdt_reset();
    }
    if (response.indexOf("8080") != -1) {
        Serial.println("--- Carrier Reply Received ---");
        int lastMsgIdx = response.lastIndexOf("+CMGL:");
        if (lastMsgIdx != -1) Serial.println(response.substring(lastMsgIdx));
        else Serial.println(response);
        SerialAT.println("AT+CMGD=1,4");
        Serial.println("------------------------------");
    } else {
        Serial.println("⚠️ No carrier reply found in SMS memory.");
    }
}

void sendAlertSMS() {
    String path = "/v1/projects/" + firebaseProjectId + "/databases/(default)/documents/users?key=" + firebaseApiKey;
    String response = "";
    int status = sendFirestoreRequest("GET", path, "", response);

    if (status >= 200 && status < 300 && response.length() > 0) {
        JsonDocument doc;
        deserializeJson(doc, response);
        if (doc.containsKey("documents")) {
            JsonArray docs = doc["documents"];
            for (JsonObject u : docs) {
                String phone = u["fields"]["phoneNumber"]["stringValue"].as<String>();
                String msg = alertMessage + " Rain: " + String(getRainToday_mm(), 1) + "mm. GPS: " + String(latitude, 5) + "," + String(longitude, 5);
                modem.sendSMS(phone, msg);
                delay(2000);
            }
        }
    }
}

String getISOTime() {
    time_t now; time(&now);
    char timeBuf[25];
    strftime(timeBuf, sizeof(timeBuf), "%Y-%m-%dT%H:%M:%SZ", gmtime(&now));
    return String(timeBuf);
}

void uploadData() {
    float temp = bmeOnline ? bme.readTemperature() : 0.0;
    float hum = bmeOnline ? bme.readHumidity() : 0.0;
    float pres = bmeOnline ? bme.readPressure() / 100.0 : 0.0;
    float lux = bh1750Online ? lightMeter.readLightLevel() : -1.0;
    float water = getWaterLevel();
    float rise = calculateRiseRate(water);

    dailyRainfall = getRainToday_mm();
    float rainRate = getRainRate_mmh();

    JsonDocument doc;
    JsonObject f = doc["fields"].to<JsonObject>();
    f["temperature"]["doubleValue"] = temp;
    f["humidity"]["doubleValue"] = hum;
    f["pressure"]["doubleValue"] = pres;
    f["lightLevel"]["doubleValue"] = lux;
    f["waterLevel"]["doubleValue"] = water;
    f["waterRiseRate"]["doubleValue"] = rise;
    f["dailyRainfall"]["doubleValue"] = dailyRainfall;
    f["rainRate"]["doubleValue"] = rainRate;
    f["lat"]["doubleValue"] = latitude;
    f["lng"]["doubleValue"] = longitude;
    f["dewPoint"]["doubleValue"] = calculateDewPoint(temp, hum);
    f["heatIndex"]["doubleValue"] = calculateFeelsLike(temp, hum);
    f["cloudCover"]["doubleValue"] = estimateCloudCover(lux);

    String intensity = "None";
    if (rainRate > 0) {
        if (rainRate < 2.5) intensity = "Light";
        else if (rainRate < 7.5) intensity = "Moderate";
        else if (rainRate < 50.0) intensity = "Heavy";
        else intensity = "Violent";
    }
    f["rainIntensity"]["stringValue"] = intensity;
    f["lastSeen"]["stringValue"] = getISOTime();

    String payload; serializeJson(doc, payload);

    Serial.println("\n>>> UPLOADING CURRENT DATA TO FIREBASE <<<");
    Serial.printf("  [GPS] Lat: %.6f | Lng: %.6f\n", latitude, longitude);
    Serial.printf("  [DATA] Temp:%.1fC | Hum:%.0f%% | Water:%.1fcm | Rain:%.2fmm | Daily:%.2fmm\n",
                  temp, hum, water, (float)0.0, dailyRainfall);

    String path = "/v1/projects/" + firebaseProjectId + "/databases/(default)/documents/weather/current?key=" + firebaseApiKey;
    String dummy;
    int status = sendFirestoreRequest("PATCH", path, payload, dummy);

    if (status == 200) {
        Serial.println(">>> ✅ FIREBASE CURRENT STATUS UPLOAD SUCCESS <<<");
    } else {
        Serial.printf(">>> ❌ FIREBASE UPLOAD FAILED (HTTP %d) <<<\n", status);
    }
}

// ==========================================
// CORE
// ==========================================

void setup() {
    pinMode(BOARD_POWERON_PIN, OUTPUT); digitalWrite(BOARD_POWERON_PIN, HIGH);
    pinMode(TRIG_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT);
    pinMode(RAIN_PIN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(RAIN_PIN), countTip, FALLING);

    Serial.begin(115200);
    delay(100);
    Serial.println("\n--- Initializing Sensors ---");

    Wire.begin(I2C_SDA, I2C_SCL);
    if(bme.begin(0x76)) {
        bmeOnline = true;
        Serial.println("✅ BME280 sensor found.");
    } else {
        Serial.println("⚠️ BME280 not found!");
    }

    if(lightMeter.begin()) {
        bh1750Online = true;
        Serial.println("✅ BH1750 light sensor found.");
    } else {
        Serial.println("⚠️ BH1750 not found!");
    }

    pinMode(MODEM_PWRKEY, OUTPUT);
    pinMode(MODEM_DTR, OUTPUT); digitalWrite(MODEM_DTR, LOW);

    SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
    SerialGPS.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

    Serial.println("--- Powering ON Modem ---");
    pinMode(BOARD_RST_PIN, OUTPUT); digitalWrite(BOARD_RST_PIN, LOW);

    if (!modem.testAT(1000)) {
        digitalWrite(MODEM_PWRKEY, LOW); delay(100);
        digitalWrite(MODEM_PWRKEY, HIGH); delay(1000);
        digitalWrite(MODEM_PWRKEY, LOW); delay(3000);
    }

    modem.init();
    SerialAT.println("AT+CFUN=1");

#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    esp_task_wdt_config_t wdt_config = {.timeout_ms = 120000, .idle_core_mask = 0, .trigger_panic = true};
    if (esp_task_wdt_reconfigure(&wdt_config) != ESP_OK) esp_task_wdt_init(&wdt_config);
#else
    esp_task_wdt_init(120, true);
#endif
    esp_task_wdt_add(NULL);
    esp_task_wdt_reset();

    Serial.println("Waiting for initial connection...");
    ensureConnection();

    preferences.begin("weather", false);
    dailyRainfall = preferences.getFloat("dailyRainfall", 0.0);
    todayTips = dailyRainfall / BUCKET_SIZE;

    lastMinuteTickMs = millis();
    Serial.println("System Online (Continuous)");
}

void loop() {
    esp_task_wdt_reset();
    while (SerialGPS.available()) gps.encode(SerialGPS.read());
    if (gps.location.isValid()) {
        latitude = gps.location.lat(); longitude = gps.location.lng();
        gpsHasValidFix = true;
    }

    unsigned long now = millis();

    // 1. Manage the 10-minute rolling rate buffer
    if (now - lastMinuteTickMs >= 60000UL) {
        lastMinuteTickMs = now;
        currentMinuteIndex = (currentMinuteIndex + 1) % RAIN_BUFFER_SIZE;
        minuteTips[currentMinuteIndex] = 0; // Clear slot for incoming minute
    }

    // 2. Push detected tips to current minute slot
    if (newTipDetected) {
        noInterrupts();
        newTipDetected = false;
        minuteTips[currentMinuteIndex]++;
        interrupts();
    }

    // 3. Dynamic Interval Timing for Upload
    dailyRainfall = getRainToday_mm();
    bool emergency = (dailyRainfall >= alertThreshold) || (waterRiseRateCMH >= 15.0);
    unsigned long uploadInterval = (emergency ? emergencyIntervalMin : normalIntervalMin) * 60000;

    if (now - lastUploadMillis >= uploadInterval || lastUploadMillis == 0) {
        uploadData();
        lastUploadMillis = now;
        preferences.begin("weather", false);
        preferences.putFloat("dailyRainfall", dailyRainfall);
        preferences.end();
    }

    if (now - lastConfigMillis >= 300000 || lastConfigMillis == 0) {
        fetchConfig();
        lastConfigMillis = now;
    }

    if (lastUploadMillis > 0 && (now - lastSimCheckMillis >= 86400000 || lastSimCheckMillis == 0)) {
        checkSimStatus();
        lastSimCheckMillis = now;
    }

    // 4. Real-time sensor print (Every 5 seconds)
    if (now - lastSerialPrintMillis >= 5000) {
        float temp = bmeOnline ? bme.readTemperature() : NAN;
        float hum = bmeOnline ? bme.readHumidity() : NAN;
        float pres = bmeOnline ? bme.readPressure() / 100.0 : NAN;
        float lux = bh1750Online ? lightMeter.readLightLevel() : -1.0;
        float airGap = getAirGap();
        float waterDepth = (airGap > 0) ? (mountHeightCm - airGap) : -1.0;
        float rainRate = getRainRate_mmh();

        String intensity = "None";
        if (rainRate > 0) {
            if (rainRate < 2.5) intensity = "Light";
            else if (rainRate < 7.5) intensity = "Moderate";
            else if (rainRate < 50.0) intensity = "Heavy";
            else intensity = "Violent";
        }

        Serial.println(F("========================================"));
        Serial.print(F("Temperature : ")); Serial.print(temp, 1); Serial.println(F(" °C"));
        Serial.print(F("Feels Like  : ")); Serial.print(calculateFeelsLike(temp, hum), 1); Serial.println(F(" °C"));
        Serial.print(F("Dew Point   : ")); Serial.print(calculateDewPoint(temp, hum), 1); Serial.println(F(" °C"));
        Serial.print(F("Humidity    : ")); Serial.print(hum, 1); Serial.println(F(" %"));
        Serial.print(F("Pressure    : ")); Serial.print(pres, 1); Serial.println(F(" hPa"));
        Serial.print(F("Illuminance : ")); Serial.print(lux, 1); Serial.println(F(" lx"));
        float cc = estimateCloudCover(lux);
        if (cc < 0) Serial.println(F("Cloud Cover : [Night / Low Light]"));
        else { Serial.print(F("Cloud Cover : ")); Serial.print(cc, 0); Serial.println(F(" %")); }
        Serial.print(F("Rainfall    : ")); Serial.print(dailyRainfall, 2); Serial.println(F(" mm"));
        Serial.print(F("Rain Rate   : ")); Serial.print(rainRate, 2); Serial.println(F(" mm/h"));
        Serial.print(F("Rain Status : ")); Serial.println(intensity);
        Serial.print(F("Bucket Tips : ")); Serial.println(todayTips);
        Serial.print(F("Air Gap     : ")); Serial.print(airGap, 1); Serial.println(F(" cm"));
        Serial.print(F("Water Depth : ")); Serial.print(waterDepth, 1); Serial.println(F(" cm"));
        Serial.println(F("========================================\n"));
        lastSerialPrintMillis = now;
    }
    delay(10);
}
