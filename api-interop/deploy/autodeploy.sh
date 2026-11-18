#!/bin/sh
# deploy อัตโนมัติเมื่อ branch ที่ใช้ deploy มี commit ใหม่บน GitHub โดยเว็บไม่ล่ม (cron ทุก 2 นาที — README หัวข้อ 11)
#
# ทีละแอป:
#   1. build image ใหม่ (build.sh) ระหว่างที่ตัวเดิมยังให้บริการ ไฟล์ของแอปไม่เปลี่ยน = image เดิม = ไม่แตะแอปนั้น
#   2. docker compose up --no-deps --wait สลับเป็นตัวใหม่และรอจน healthy
#      ช่วงสลับไม่กี่วินาที caddy พักคำขอไว้แล้วส่งต่อเมื่อตัวใหม่พร้อม (lb_try_duration ใน Caddyfile.tunnel) ผู้ใช้ไม่เห็นหน้า error
#      WebSocket / SSE ที่เปิดค้างอยู่หลุดแล้วหน้าเว็บต่อใหม่
#   3. ตัวใหม่ไม่ healthy ภายใน DEPLOY_WAIT วินาที: กลับไปใช้ image เดิม
#   build หรือ deploy ล้ม: ไม่ลอง commit นั้นซ้ำ (ไม่ build ซ้ำทุก 2 นาที) รอ commit ใหม่ หรือลบไฟล์ <แอป>.seen ใน DEPLOY_STATE
#
# ไม่ deploy compose / Caddyfile ให้ (เปลี่ยนไม่บ่อย และ caddy / cloudflared ต้อง restart) ดู README หัวข้อ 11
#
#   GNSS_REF, GPREDICT_REF, EO_REF   branch ที่ติดตาม (ค่าตั้งต้นด้านล่าง)
#   DEPLOY_STATE                     ที่เก็บ lock และ commit ล่าสุดที่ deploy (~/.local/state/sss-apps)
#   DEPLOY_WAIT                      วินาทีที่รอให้ตัวใหม่ healthy (300)
set -eu

cd "$(dirname "$0")"
STATE="${DEPLOY_STATE:-$HOME/.local/state/sss-apps}"
WAIT="${DEPLOY_WAIT:-300}"
GNSS_REF="${GNSS_REF:-origin/feature/production-docker}"
GPREDICT_REF="${GPREDICT_REF:-origin/feature/gpredict-web-docker}"
EO_REF="${EO_REF:-origin/feature/production-docker}"
export GNSS_REF GPREDICT_REF EO_REF

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0 # รอบก่อนยัง build อยู่

log() { echo "$(date -Iseconds) $*"; }
compose() { docker compose -f compose.tunnel.yaml "$@"; }
image_id() { docker image inspect -f '{{.Id}}' "$1:prod" 2>/dev/null || true; }

git fetch --quiet origin || { log "git fetch ล้ม: ลองรอบหน้า"; exit 0; }

# deploy <service> <ref>
deploy() {
  app="$1"
  commit="$(git rev-parse --verify "$2^{commit}")"
  [ "$commit" = "$(cat "$STATE/$app.seen" 2>/dev/null || true)" ] && return 0
  log "$app: $2 → $(git rev-parse --short=12 "$commit")"

  old="$(image_id "$app")"
  if ! nice -n 10 ./build.sh "$app"; then
    log "$app: build ล้ม ใช้ตัวเดิมต่อ"
  elif [ "$(image_id "$app")" = "$old" ]; then
    log "$app: ไฟล์ของแอปไม่เปลี่ยน ไม่ restart"
  elif compose up -d --no-deps --wait --wait-timeout "$WAIT" "$app"; then
    log "$app: ใช้ตัวใหม่แล้ว"
  elif [ -n "$old" ]; then
    log "$app: ตัวใหม่ไม่ healthy ย้อนกลับไปใช้ image เดิม"
    docker tag "$old" "$app:prod"
    compose up -d --no-deps --wait --wait-timeout "$WAIT" "$app" || log "$app: ย้อนกลับแล้วยังไม่ healthy ต้องดูเอง"
  else
    log "$app: ตัวใหม่ไม่ healthy และไม่มี image เดิมให้ย้อนกลับ ต้องดูเอง"
  fi
  echo "$commit" > "$STATE/$app.seen"
}

deploy gnss-studio "$GNSS_REF"
deploy gpredict-web "$GPREDICT_REF"
deploy eo-studio "$EO_REF"
