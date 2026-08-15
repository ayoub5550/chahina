# 🚚 شاحنتي — Truckly

منصة نقل بالشاحنات على غرار Uber / inDrive: الشاحن ينشر بضاعته، أصحاب الشاحنات القريبون يرون الطلب ويقدّمون أسعارهم، والشاحن يختار الأنسب حسب السعر والتقييم — كل ذلك على خريطة مباشرة.

المشروع مبني على أساس [adrianhajdin/uber](https://github.com/adrianhajdin/uber) (تطبيق Expo/React Native)، وأُعيد تكييفه لنقل البضائع مع **واجهة ويب عربية (PWA) وخادم ذاتي الاستضافة** لا يحتاج أي خدمة مدفوعة.

## ما الذي تغيّر عن المشروع الأصلي؟
| الأصل | شاحنتي |
| --- | --- |
| ركّاب وسائقو تاكسي | شاحنون (بضاعة) وأصحاب شاحنات |
| Clerk (تسجيل مدفوع) | تسجيل ذاتي برقم الهاتف + JWT |
| Neon (Postgres سحابي) | SQLite محلي على خادمك |
| Stripe (دفع إجباري) | اتفاق مباشر على السعر (نقداً) + نظام عروض أسعار |
| Google Maps (مفتاح مدفوع) | OpenStreetMap + Leaflet (مجاني) |
| سعر ثابت | مزايدة/تفاوض على السعر مثل inDrive |
| — | تقييمات نجوم متبادلة، أنواع شاحنات وحمولات، دورة حياة الشحنة |

## المكونات
- `web/` — الخادم والواجهة القابلة للنشر (Node + Express + SQLite + Leaflet، عربية RTL، تعمل كتطبيق PWA على الهاتف).
- بقية المجلدات — تطبيق Expo الأصلي (أساس مستقبلي لتطبيق أندرويد/iOS أصلي).

## التشغيل محلياً
```bash
cd web && npm install && npm start   # http://localhost:4000
```

## النشر على خادم
انظر `deploy/README.md` (سكربت واحد: Node + systemd + Nginx).

## واجهة الـ API
`POST /api/auth/register|login` · `GET /api/me` · `PUT /api/truck` · `POST /api/truck/location|availability` ·
`GET /api/trucks/nearby?lat&lng&radius` · `POST /api/shipments` · `GET /api/shipments/open|mine|:id` ·
`POST /api/shipments/:id/offers` · `POST /api/offers/:id/accept` · `POST /api/shipments/:id/status|rate` · `GET /api/users/:id`

## خارطة الطريق المقترحة
1. إشعارات فورية (WebSocket / Web Push) عند وصول طلب أو عرض.
2. تتبّع حيّ للشاحنة أثناء الرحلة.
3. توثيق أصحاب الشاحنات (رفع البطاقة الرمادية ورخصة السياقة) ولوحة إدارة.
4. تسعير تلقائي مقترح حسب المسافة والحمولة.
5. تطبيق أندرويد أصلي انطلاقاً من مجلد Expo.
