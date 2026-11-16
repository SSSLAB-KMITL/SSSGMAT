#!/bin/sh
# entrypoint ของ image Earth Observation Studio
# - ไม่มี argument: เปิด server ที่ 0.0.0.0:$EO_PORT (ตั้งต้น 8018)
#   server รับคำสั่งแก้ข้อมูลเฉพาะ Origin http://127.0.0.1:8018 / http://localhost:8018 (server.py) จึงต้องคง port 8018
#   และให้ reverse proxy เขียน Origin ของตัวเองเป็น http://127.0.0.1:8018 (deploy/Caddyfile)
# - มี argument: รันคำสั่งนั้นแทน เช่น `/app/.venv/bin/python bootstrap.py --per-site 4 --workers 2`
set -eu

DATA_DIR="${EO_DATA:-/data}"
mkdir -p "$DATA_DIR"
if [ ! -w "$DATA_DIR" ]; then
  echo "entrypoint: เขียน $DATA_DIR ไม่ได้ (uid $(id -u)) ให้ volume เป็นของ uid นี้ (chown -R 10001:10001) หรือใช้ named volume" >&2
  exit 1
fi
mkdir -p "$DATA_DIR/jobs" "$DATA_DIR/logs" "$DATA_DIR/scenes"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec /app/.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port "${EO_PORT:-8018}" \
  --proxy-headers --forwarded-allow-ips '*' --no-server-header
