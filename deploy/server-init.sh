#!/usr/bin/env sh
set -eu

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  echo "已创建 .env.production，请填写密码和 API Key 后重新执行。"
  exit 1
fi

mkdir -p backups
chmod 700 backups
docker compose --env-file .env.production pull postgres redis nginx backup
docker compose --env-file .env.production build web api worker migrate
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps
