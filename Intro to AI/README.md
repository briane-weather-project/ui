# Weather-based Flood Alert System with GPS

A comprehensive IoT solution for real-time environmental monitoring and early flood detection. This project leverages the **LilyGO TTGO T-SIM A7670G** (ESP32-based) to collect data from various sensors, synchronize it with a **Firebase Cloud** backend, and provide a professional **Web UI** for data visualization and system management.

---

## 🚀 Features

- **Real-time Environmental Monitoring:** Tracks temperature, humidity, pressure, rainfall, and light intensity.
- **Flood Detection:** Uses an ultrasonic sensor (JSN-SR04T) to monitor water levels and calculate rise rates.
- **GPS Tracking:** Real-time location monitoring and movement tracking for the device.
- **Automated Alerts:** Sends SMS notifications via GSM/LTE when water levels exceed safety thresholds.
- **Cloud Synchronization:** Full integration with Firebase Firestore for live data streaming and historical logging.
- **Remote Configuration:** Dynamically update alert thresholds, sensor calibration, and sampling intervals via the Admin Dashboard.
- **Offline Reliability:** Includes local storage and retry logic to ensure no data is lost during network outages.

---

## 🛠 Hardware Architecture

### Core Controller
- **LilyGO TTGO T-SIM A7670G:** ESP32-based development board with integrated LTE/GSM and GPS modules.

### Sensor Array
- **BME280:** Temperature, Humidity, and Barometric Pressure.
- **BH1750:** Light intensity (Lux) for cloud cover estimation.
- **Tipping Bucket:** Rainfall measurement (0.2794mm per tip).
- **JSN-SR04T:** Waterproof ultrasonic sensor for precision water level monitoring.

### Pin Configuration
| Component | SDA/TX | SCL/RX | Other Pins |
| :--- | :--- | :--- | :--- |
| **I2C Sensors** | GPIO 32 | GPIO 33 | — |
| **Ultrasonic** | GPIO 14 (Trig) | GPIO 36 (Echo) | — |
| **GPS** | GPIO 21 | GPIO 22 | GPIO 23 (PPS) |
| **Rain Gauge** | — | — | GPIO 34 (Interrupt) |
| **Modem** | GPIO 26 | GPIO 27 | GPIO 4 (PwrKey) |

---

## 💻 Software Stack

### Firmware (Arduino/C++)
- **Architecture:** Event-driven polling with deep sleep optimization.
- **Key Libraries:** 
  - `TinyGSM`: For LTE/GSM and GPS communication.
  - `ArduinoJson`: For cloud data formatting.
  - `Adafruit BME280`: For environmental sensing.
  - `Firebase REST API`: For secure data transmission.

### Web Dashboard (JavaScript/HTML/CSS)
- **Frontend:** Responsive vanilla JavaScript, HTML5, and CSS3.
- **Backend-as-a-Service:** Firebase (Authentication, Firestore, Hosting).
- **Features:** 
  - Real-time gauge charts for weather metrics.
  - Interactive maps for device location.
  - Historical data trends and logs.
  - Secure Admin panel for remote device management.

---

## 🔧 Setup & Installation

### Firmware Setup
1. Install **Arduino IDE**.
2. Install the following libraries via Library Manager:
   - `ArduinoJson` (v7.0+)
   - `Adafruit BME280`
   - `BH1750`
   - `TinyGSM` (Use the [lewisxhe fork](https://github.com/lewisxhe/TinyGSM))
3. Configure your Firebase Project ID and API Key in `code.ino`.
4. Select board **ESP32 Dev Module** and upload.

### Web UI Setup
1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/).
2. Enable **Firestore Database** and **Firebase Auth**.
3. Update `Web UI/firebase-config.js` with your project credentials.
4. Deploy to Firebase Hosting or run locally using a simple web server.

---

## 📊 Data Logic & Alerts

- **Sampling Interval:** Defaults to 10 minutes (Normal) and 1 minute (Emergency).
- **Flood Logic:** If `Water Level > Alert Threshold`, the system enters "Emergency Mode," increases upload frequency, and sends an SMS alert.
- **Calibration:** Sensor offsets and heights can be adjusted via the cloud to match specific deployment environments without reflashing the firmware.

---

## 📝 Project Structure
```text
├── LilyGO TTGO T-SIM A7670G/
│   └── code.ino            # Main firmware logic
├── Web UI/
│   ├── admin/              # Management dashboard
│   ├── dashboard/          # Public data visualization
│   ├── auth/               # Firebase login/registration
│   ├── firebase-config.js  # Cloud credentials
│   └── index.html          # Landing page
└── README.md               # This file
```
