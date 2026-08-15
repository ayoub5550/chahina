# النشر

```bash
# على الخادم (Ubuntu 22/24/26)
git clone <repo> /opt/truckly   # أو ارفع الملفات إلى /opt/truckly
cd /opt/truckly/deploy && PUBLIC_PORT=8090 ./install.sh
```
- الخدمة: `systemctl status|restart truckly` — السجلات: `journalctl -u truckly -f`
- قاعدة البيانات: `/opt/truckly/web/data/truckly.db` (نسخ احتياطي = نسخ هذا الملف)
- المنفذ العام يُضبط بـ `PUBLIC_PORT` حتى لا يتعارض مع مواقع أخرى على المنفذ 80.
- **ملاحظة أمنية:** الموقع يعمل حالياً عبر HTTP. متصفحات الهاتف تمنع تحديد الموقع (GPS) على HTTP، لذا يُنصح بربط اسم نطاق وتفعيل شهادة مجانية:
  `apt install certbot python3-certbot-nginx && certbot --nginx -d example.com`
