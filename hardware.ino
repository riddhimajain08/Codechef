#include <Wire.h>
#include <U8g2lib.h>
#include <DHT.h>

// -------------------- OLED --------------------
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0);

// -------------------- DHT11 --------------------
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

// -------------------- Sensors & Buzzer --------------------
int alcoholSensor = A0;
int alcoholBuzzer = 8;
int heartSensor = A1;
int ALCOHOL_THRESHOLD = 350;

void setup() {
  Serial.begin(9600);
  dht.begin();

  pinMode(alcoholBuzzer, OUTPUT);

  // OLED init
  u8g2.begin();
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tf);
  u8g2.drawStr(0,20,"Smart Helmet Starting...");
  u8g2.sendBuffer();
  delay(1000);
}

void loop() {
  // ---------- Read Sensors ----------
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  int alcoholValue = analogRead(alcoholSensor);
  int heartValue = analogRead(heartSensor);

  // ---------- Alerts ----------
  bool alcoholAlert = (alcoholValue > ALCOHOL_THRESHOLD);
  digitalWrite(alcoholBuzzer, alcoholAlert ? HIGH : LOW);

  // ---------- OLED Display ----------
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_6x12_tf);

  u8g2.setCursor(0,10);
  u8g2.print("Temp: "); u8g2.print(temp); u8g2.print(" C");

  u8g2.setCursor(0,22);
  u8g2.print("Hum:  "); u8g2.print(hum); u8g2.print(" %");

  u8g2.setCursor(0,34);
  u8g2.print("Heart: "); u8g2.print(heartValue);

  u8g2.setCursor(0,46);
  u8g2.print("Alcohol: "); u8g2.print(alcoholValue);

  u8g2.setCursor(0,58);
  if(alcoholAlert) u8g2.print("ALCOHOL ALERT!");

  u8g2.sendBuffer();

  // ---------- Serial Monitor ----------
  Serial.print("Temp: "); Serial.print(temp);
  Serial.print(" C | Humidity: "); Serial.print(hum);
  Serial.print("% | Alcohol: "); Serial.print(alcoholValue);
  Serial.print(" | Heart: "); Serial.println(heartValue);

  delay(500);
}
