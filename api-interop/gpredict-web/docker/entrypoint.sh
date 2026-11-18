#!/bin/sh
# entrypoint ของ image Gpredict Web
# - ไม่มี argument: เปิด server ที่ 0.0.0.0:$GPREDICT_WEB_PORT (ตั้งต้น 8740)
#   server รับ Host/Origin เฉพาะชื่อ 127.0.0.1, localhost, ::1 และ 0.0.0.0 จึงต้องให้ reverse proxy เขียน Host เป็น 127.0.0.1:<port>
#   และเขียน Origin ของตัวเองเป็น http://127.0.0.1:<port> (deploy/Caddyfile) คำเตือนเรื่องไม่มี login ตอนเปิดคาดไว้แล้ว:
#   container ไม่ publish port เอง ทางเข้าเดียวคือ proxy ที่มี HTTPS + login
# - มี argument: รันคำสั่งนั้นแทน
#
# เปิดครั้งแรก (data ว่าง ไม่มี module) server ดึงกลุ่ม amateur จาก CelesTrak 1 ครั้งเพื่อสร้าง module Amateur แบบ Gpredict
# (bootstrap.py) ตามกติกา 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมง cache อยู่ที่ $GNSS_STUDIO_DATA/orbits/_cache ซึ่ง deploy ใช้ร่วมกับ GNSS Studio
set -eu

for d in "${GPREDICT_WEB_DATA:-/data}" "${GNSS_STUDIO_DATA:-/engine-data}"; do
  mkdir -p "$d"
  if [ ! -w "$d" ]; then
    echo "entrypoint: เขียน $d ไม่ได้ (uid $(id -u)) ให้ volume เป็นของ uid นี้ (chown -R 10001:10001) หรือใช้ named volume" >&2
    exit 1
  fi
done

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec python -m gpredict_web --host 0.0.0.0 --port "${GPREDICT_WEB_PORT:-8740}"
