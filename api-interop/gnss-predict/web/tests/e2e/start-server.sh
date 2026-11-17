#!/usr/bin/env bash
# เปิด server สำหรับ e2e: สร้าง data fixture ใหม่ทุกครั้งแล้วเปิด server บน port 8766
# - data อยู่ที่ web/test-results/e2e-data (ถูก git ละเว้น) ห้ามชี้ไป data จริง
# - ไม่มี GMAT (GMAT_BIN ชี้ไปที่ไม่มี) และ build_fixture.py เขียน settings.json ที่ daily.enabled=false ก่อน server เริ่ม
#   งานประจำวันจึงไม่เชื่อมต่อ CelesTrak/CDDIS
set -euo pipefail

WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVER="$WEB/../server"
DATA="$WEB/test-results/e2e-data"

rm -rf "$DATA"
mkdir -p "$WEB/test-results"
"$SERVER/.venv/bin/python" -I "$WEB/tests/e2e/fixture/build_fixture.py" "$DATA"

cd "$SERVER"
# GNSS_STUDIO_HOST ตรึงที่ loopback: ค่าที่ค้างอยู่ใน environment ของผู้รัน (เช่น 0.0.0.0) ต้องไม่เปิด server ของ e2e ให้เครื่องอื่นในเครือข่าย
export GNSS_STUDIO_DATA="$DATA" GNSS_STUDIO_HOST=127.0.0.1 GNSS_STUDIO_PORT=8766 GMAT_BIN=/nonexistent
exec .venv/bin/python -m gnss_studio_server
