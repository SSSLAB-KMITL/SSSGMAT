#!/bin/sh
# deploy โค้ดล่าสุดจาก GitHub โดยเว็บไม่ล่ม (ใช้กับ compose.tunnel.yaml — README หัวข้อ 11) รันเองหลัง push:
#
#   ./deploy.sh                 ทั้งสามแอป
#   ./deploy.sh gnss-studio     เฉพาะตัวที่ระบุ (gnss-studio, gpredict-web, eo-studio)
#
# ทีละแอป:
#   1. git fetch แล้ว build image จาก branch บน origin (build.sh) ระหว่างที่ตัวเดิมยังให้บริการ
#      ไฟล์ของแอปไม่เปลี่ยน = image เดิม = ไม่แตะแอปนั้น
#   2. docker compose up --no-deps --wait สลับเป็นตัวใหม่และรอจน healthy
#      ช่วงสลับไม่กี่วินาที caddy พักคำขอไว้แล้วส่งต่อเมื่อตัวใหม่พร้อม (lb_try_duration ใน Caddyfile.tunnel) ผู้ใช้ไม่เห็นหน้า error
#      WebSocket / SSE ที่เปิดค้างอยู่หลุดแล้วหน้าเว็บต่อใหม่
#   3. ตัวใหม่ไม่ healthy ภายใน DEPLOY_WAIT วินาที: กลับไปใช้ image เดิม
#   แอปใดล้ม (build หรือ health) ทำแอปถัดไปต่อ แล้วจบด้วย exit 1
#
# ไม่ deploy compose / Caddyfile ให้ (caddy / cloudflared ต้อง restart) ดู README หัวข้อ 11
#
#   GNSS_REF, GPREDICT_REF, EO_REF   branch ที่ใช้ (ค่าตั้งต้นด้านล่าง)
#   DEPLOY_WAIT                      วินาทีที่รอให้ตัวใหม่ healthy (300)
set -eu

cd "$(dirname "$0")"
WAIT="${DEPLOY_WAIT:-300}"
GNSS_REF="${GNSS_REF:-origin/feature/production-docker}"
GPREDICT_REF="${GPREDICT_REF:-origin/feature/gpredict-web-docker}"
EO_REF="${EO_REF:-origin/feature/production-docker}"
export GNSS_REF GPREDICT_REF EO_REF

compose() { docker compose -f compose.tunnel.yaml "$@"; }
image_id() { docker image inspect -f '{{.Id}}' "$1:prod" 2>/dev/null || true; }

git fetch --quiet origin
status=0

# deploy <service>
deploy() {
  app="$1"
  old="$(image_id "$app")"
  if ! nice -n 10 ./build.sh "$app"; then
    echo "== $app: build ล้ม ใช้ตัวเดิมต่อ" >&2; status=1; return
  fi
  if [ "$(image_id "$app")" = "$old" ]; then
    echo "== $app: ไฟล์ของแอปไม่เปลี่ยน ไม่ restart"; return
  fi
  if compose up -d --no-deps --wait --wait-timeout "$WAIT" "$app"; then
    echo "== $app: ใช้ตัวใหม่แล้ว"; return
  fi
  status=1
  if [ -z "$old" ]; then
    echo "== $app: ตัวใหม่ไม่ healthy และไม่มี image เดิมให้ย้อนกลับ ต้องดูเอง" >&2; return
  fi
  echo "== $app: ตัวใหม่ไม่ healthy ย้อนกลับไปใช้ image เดิม" >&2
  docker tag "$old" "$app:prod"
  compose up -d --no-deps --wait --wait-timeout "$WAIT" "$app" || echo "== $app: ย้อนกลับแล้วยังไม่ healthy ต้องดูเอง" >&2
}

for app in ${*:-gnss-studio gpredict-web eo-studio}; do
  case "$app" in
    gnss-studio|gpredict-web|eo-studio) deploy "$app" ;;
    *) echo "deploy.sh: ไม่รู้จัก $app (ใช้ gnss-studio, gpredict-web, eo-studio)" >&2; exit 2 ;;
  esac
done
exit "$status"
