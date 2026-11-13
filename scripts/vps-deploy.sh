#!/usr/bin/env bash
# FatMan Burgers — Hostinger VPS bootstrap (Ubuntu)
# Usage: sudo bash vps-deploy.sh
set -euo pipefail

APP_ROOT="${APP_ROOT:-/var/www/fatman}"
FRONTEND_REPO="${FRONTEND_REPO:-https://github.com/ayanhabib67/Fatman_Burgers_Frontend.git}"
BACKEND_REPO="${BACKEND_REPO:-https://github.com/ayanhabib67/Fatman_Burgers_Backend.git}"
PUBLIC_IP="$(curl -4 -fsSL ifconfig.me || hostname -I | awk '{print $1}')"

echo "==> FatMan deploy → ${APP_ROOT} (IP ${PUBLIC_IP})"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx ufw build-essential

# Node 20
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm i -g pm2

# MongoDB 7
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
  echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-7.0.list
  apt-get update -y
  apt-get install -y mongodb-org || apt-get install -y mongodb
  systemctl enable --now mongod || systemctl enable --now mongodb || true
fi

mkdir -p "$APP_ROOT"
cd "$APP_ROOT"

if [[ -d backend/.git ]]; then
  git -C backend pull --ff-only
else
  git clone "$BACKEND_REPO" backend
fi

if [[ -d frontend/.git ]]; then
  git -C frontend pull --ff-only
else
  git clone "$FRONTEND_REPO" frontend
fi

# Backend env
if [[ ! -f backend/.env ]]; then
  cp backend/.env.example backend/.env
  sed -i "s|ADMS_PUBLIC_URL=.*|ADMS_PUBLIC_URL=http://${PUBLIC_IP}:8088|" backend/.env
  sed -i "s|MONGODB_URI=.*|MONGODB_URI=mongodb://127.0.0.1:27017/fatman_burgers_pos|" backend/.env || true
  grep -q '^MONGODB_URI=' backend/.env || echo 'MONGODB_URI=mongodb://127.0.0.1:27017/fatman_burgers_pos' >> backend/.env
  grep -q '^PORT=' backend/.env || echo 'PORT=5000' >> backend/.env
  grep -q '^CORS_ORIGIN=' backend/.env || echo 'CORS_ORIGIN=*' >> backend/.env
  grep -q '^ADMS_EXTRA_PORTS=' backend/.env || echo 'ADMS_EXTRA_PORTS=8088,86' >> backend/.env
fi

cd "$APP_ROOT/backend"
npm ci --omit=dev || npm install --omit=dev
npm run seed-hr || true
npm run seed-menu || true
npm run seed-pos-user || true

pm2 delete fatman-api >/dev/null 2>&1 || true
pm2 start src/server.js --name fatman-api
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# Frontend build (API same origin via nginx /api)
cd "$APP_ROOT/frontend"
npm ci || npm install
VITE_API_BASE_URL=/api/v1 npm run build

# Nginx
cat >/etc/nginx/sites-available/fatman <<NGINX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;

  root ${APP_ROOT}/frontend/dist;
  index index.html;

  client_max_body_size 20m;

  location /api/ {
    proxy_pass http://127.0.0.1:5000/api/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /iclock/ {
    proxy_pass http://127.0.0.1:8088/iclock/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
  }

  location /till/ {
    try_files \$uri \$uri/ /till/index.html;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX

ln -sfn /etc/nginx/sites-available/fatman /etc/nginx/sites-enabled/fatman
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 5000/tcp || true
ufw allow 8088/tcp || true
ufw allow 86/tcp || true
ufw --force enable || true

echo ""
echo "==> DONE"
echo "Site:     http://${PUBLIC_IP}/"
echo "Till:     http://${PUBLIC_IP}/till/"
echo "API:      http://${PUBLIC_IP}/api/v1/health"
echo "ADMS:     http://${PUBLIC_IP}:8088/iclock/health"
echo "HR login: hr@fatman.local / admin123"
echo "POS login: pos@fatman.local / admin  (opens till)"
echo "Edit env: nano ${APP_ROOT}/backend/.env && pm2 restart fatman-api"
