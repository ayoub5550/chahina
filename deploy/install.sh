#!/usr/bin/env bash
# نشر "شاحنتي" على خادم Ubuntu: Node + systemd + Nginx (منفذ 8090 افتراضياً)
set -euo pipefail
APP_DIR=${APP_DIR:-/opt/truckly}
PORT=${PORT:-4000}
PUBLIC_PORT=${PUBLIC_PORT:-8090}

command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs; }
command -v nginx >/dev/null || apt-get install -y nginx

NODE_BIN=$(command -v node)
cd "$APP_DIR/web"
npm install --omit=dev
JWT=$( [ -f "$APP_DIR/web/.env" ] && grep -oP '(?<=JWT_SECRET=).*' "$APP_DIR/web/.env" || openssl rand -hex 32 )
CHARGILY=$( [ -f "$APP_DIR/web/.env" ] && grep -oP '(?<=CHARGILY_SECRET_KEY=).*' "$APP_DIR/web/.env" || echo "${CHARGILY_SECRET_KEY:-}" )
{
  printf 'JWT_SECRET=%s\nPORT=%s\n' "$JWT" "$PORT"
  printf 'PUBLIC_URL=%s\n' "${PUBLIC_URL_APP:-http://185.114.48.164:$PUBLIC_PORT}"
  printf 'CHARGILY_MODE=%s\n' "${CHARGILY_MODE:-test}"
  [ -n "$CHARGILY" ] && printf 'CHARGILY_SECRET_KEY=%s\n' "$CHARGILY"
} > "$APP_DIR/web/.env"

cat > /etc/systemd/system/truckly.service <<UNIT
[Unit]
Description=Truckly (شاحنتي) API + Web
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR/web
EnvironmentFile=$APP_DIR/web/.env
Environment=DATA_DIR=$APP_DIR/web/data
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/nginx/sites-available/truckly <<NGINX
server {
    listen $PUBLIC_PORT;
    listen [::]:$PUBLIC_PORT;
    server_name _;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/truckly /etc/nginx/sites-enabled/truckly
nginx -t && systemctl reload nginx
systemctl daemon-reload && systemctl enable --now truckly && systemctl restart truckly
sleep 2
curl -fsS "http://127.0.0.1:$PUBLIC_PORT/api/health" && echo " ✅ Truckly يعمل على المنفذ $PUBLIC_PORT"
