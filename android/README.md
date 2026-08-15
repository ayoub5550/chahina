# تطبيق أندرويد — شاحنتي

غلاف أندرويد أصلي (WebView) يفتح تطبيق شاحنتي مع دعم كامل لتحديد الموقع GPS، رفع الصور من الكاميرا أو المعرض، شاشة انطلاق، وشاشة «لا يوجد اتصال».

## البناء
```bash
export ANDROID_HOME=/path/to/android-sdk
gradle assembleRelease   # ملف APK للتجربة والتوزيع المباشر
gradle bundleRelease     # ملف AAB لمتجر Google Play
```
المخرجات في `app/build/outputs/`.

## قبل النشر على المتجر
1. غيّر `APP_URL` في `app/src/main/java/dz/chahina/app/MainActivity.java` إلى نطاقك مع **https**.
2. أنشئ مفتاح توقيع خاصاً بك واحفظه في مكان آمن:
   ```bash
   keytool -genkeypair -keystore chahina.jks -alias chahina -keyalg RSA -keysize 2048 -validity 10000
   ```
   ثم مرّر `CHAHINA_KEYSTORE` و`CHAHINA_STORE_PASS` و`CHAHINA_KEY_ALIAS` و`CHAHINA_KEY_PASS` كمتغيّرات بيئة.
3. ارفع `versionCode` و`versionName` عند كل تحديث.
