/*
 * Utility Tool: Reset Preferences & Flash Storage for Weather System
 * Device: LilyGO TTGO T-SIM A7670G / ESP32
 * 
 * Instructions:
 * 1. Upload this sketch to your ESP32 board.
 * 2. Open Serial Monitor at 115200 baud.
 * 3. It will clear all saved WiFi credentials, rainfall counters, preferences,
 *    and format the LittleFS offline queue storage.
 * 4. Re-upload code.ino afterwards to start fresh.
 */

#include <Arduino.h>
#include <Preferences.h>
#include <LittleFS.h>

Preferences preferences;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n==============================================");
  Serial.println("   ESP32 PREFERENCES & STORAGE RESET TOOL   ");
  Serial.println("==============================================\n");

  // 1. Clear Preferences ("weather" namespace)
  Serial.print("[1/2] Opening Preferences ('weather' namespace)... ");
  if (preferences.begin("weather", false)) {
    Serial.println("OK.");
    Serial.print("      Clearing all stored keys (wifi_ssid, wifi_pass, rainfall)... ");
    preferences.clear();
    preferences.end();
    Serial.println("SUCCESS!");
  } else {
    Serial.println("FAILED to open Preferences namespace.");
  }

  // 2. Format LittleFS Internal Flash Storage
  Serial.print("[2/2] Mounting LittleFS Internal Flash... ");
  if (LittleFS.begin(true)) {
    Serial.println("OK.");
    Serial.print("      Formatting LittleFS (clearing offline_queue.jsonl)... ");
    if (LittleFS.format()) {
      Serial.println("SUCCESS!");
    } else {
      Serial.println("Formatting FAILED.");
    }
  } else {
    Serial.println("LittleFS Mount/Format FAILED.");
  }

  Serial.println("\n==============================================");
  Serial.println(" ✅ RESET COMPLETE! All settings cleared.");
  Serial.println(" You can now upload code.ino back to the board.");
  Serial.println("==============================================\n");
}

void loop() {
  // Idle after reset
  delay(1000);
}
