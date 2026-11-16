#!/bin/sh
# entrypoint ของ image GNSS Studio (docs/2026-11-15-gnss-studio-docker-decisions.md)
#
# 1. เปิด container ครั้งแรก (ยังไม่มี $GNSS_STUDIO_DATA/settings.json): เขียน settings.json ที่ปิดงานประจำวันและภาพออนไลน์ทุกแหล่ง
#    ไม่งั้น server ใช้ค่าตั้งต้น daily.enabled = true แล้วดึง CelesTrak/CDDIS เองตั้งแต่เปิด container
#    ไฟล์ที่มีอยู่แล้ว (ผู้ใช้แก้ไว้) ไม่ถูกแตะ symlink ที่เสียก็ไม่ถูกทับ (server จะ fail safe เป็นปิดเอง)
# 2. ไม่มี argument: เปิด server (python -m gnss_studio_server)
#    มี argument: รันคำสั่งนั้นแทน เช่น `python -m gnss_predict.studio propagate --scenario /data/scenarios/x`
set -eu

DATA_DIR="${GNSS_STUDIO_DATA:-/data}"
FIRST_RUN_SETTINGS="${GNSS_STUDIO_FIRST_RUN_SETTINGS:-/opt/sssgmat/api-interop/gnss-predict/docker/settings.first-run.json}"

mkdir -p "$DATA_DIR"
if [ ! -w "$DATA_DIR" ]; then
  echo "entrypoint: เขียน $DATA_DIR ไม่ได้ (uid $(id -u)) ให้ volume เป็นของ uid นี้ หรือใช้ named volume ตาม docker-compose.yml" >&2
  exit 1
fi

SETTINGS="$DATA_DIR/settings.json"
if [ ! -e "$SETTINGS" ] && [ ! -L "$SETTINGS" ]; then
  # เขียนไฟล์ชั่วคราวให้ครบก่อน แล้ว hard link เป็นชื่อจริง: ln ไม่ทับไฟล์ที่มีอยู่ (no-clobber) และชื่อจริงปรากฏพร้อมเนื้อหาครบในครั้งเดียว
  # ไฟล์ชั่วคราวถูกลบเสมอ ทั้งตอนสำเร็จ ตอนล้ม และเมื่อมีอีก process เขียน settings.json ตัดหน้าไปก่อน
  tmp="$DATA_DIR/.settings.json.first-run.$$"
  trap 'rm -f "$tmp"' EXIT
  trap 'rm -f "$tmp"; exit 1' HUP INT TERM
  cp "$FIRST_RUN_SETTINGS" "$tmp"
  # ระบบไฟล์ที่ไม่รองรับ hard link (บาง bind mount): ใช้ mv -n (no-clobber, rename ในโฟลเดอร์เดียวกัน) แล้วดูว่าไฟล์ชั่วคราวถูกย้ายไปจริง
  if ln "$tmp" "$SETTINGS" 2>/dev/null \
     || { [ ! -e "$SETTINGS" ] && [ ! -L "$SETTINGS" ] && mv -n "$tmp" "$SETTINGS" 2>/dev/null; [ ! -e "$tmp" ]; }; then
    echo "entrypoint: เปิดครั้งแรก เขียน $SETTINGS (งานประจำวันปิด ภาพออนไลน์ปิดทุกแหล่ง)"
  elif [ -e "$SETTINGS" ] || [ -L "$SETTINGS" ]; then
    echo "entrypoint: มี $SETTINGS อยู่แล้ว ไม่เขียนทับ"
  else
    echo "entrypoint: เขียน $SETTINGS ไม่ได้" >&2
    exit 1
  fi
  rm -f "$tmp"
  trap - EXIT HUP INT TERM
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec python -m gnss_studio_server
