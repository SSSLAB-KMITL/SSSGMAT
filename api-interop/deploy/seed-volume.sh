#!/bin/sh
# คัดลอกข้อมูลเดิมจากโฟลเดอร์บนเครื่องเข้า named volume ของ compose (ครั้งแรกเท่านั้น) และให้เป็นของ uid 10001
#
#   ./seed-volume.sh <volume> <โฟลเดอร์ต้นทาง> [path ที่ไม่เอา ...]
#   volume: gnss_data, gpredict_data, eo_data, celestrak_cache
#
# ตัวอย่าง (README หัวข้อ "ย้ายข้อมูลเดิมขึ้น"):
#   ./seed-volume.sh celestrak_cache /srv/import/gnss-predict-data/orbits/_cache
#   ./seed-volume.sh gnss_data       /srv/import/gnss-predict-data ./orbits/_cache
#   ./seed-volume.sh gpredict_data   /srv/import/gpredict-web-data
#   ./seed-volume.sh eo_data         /srv/import/eo-data
#
# ไม่เขียนทับ volume ที่มีข้อมูลแล้ว (ตั้ง FORCE=1 เพื่อคัดลอกทับ) หยุด stack ก่อน: docker compose down
set -eu

[ "$#" -ge 2 ] || { sed -n '2,13p' "$0"; exit 2; }
name="$1"; src="$2"; shift 2
case "$name" in gnss_data|gpredict_data|eo_data|celestrak_cache) ;; *) echo "seed-volume: ไม่รู้จัก volume $name" >&2; exit 2 ;; esac
[ -d "$src" ] || { echo "seed-volume: ไม่พบโฟลเดอร์ $src" >&2; exit 1; }
src="$(cd "$src" && pwd)"
project="${COMPOSE_PROJECT_NAME:-sss-apps}"
vol="${project}_${name}"
image="${SEED_IMAGE:-${EO_STUDIO_IMAGE:-eo-studio:prod}}"

# ติด label ของ compose: compose จะใช้ volume นี้โดยไม่เตือนว่าไม่ได้สร้างเอง
docker volume inspect "$vol" >/dev/null 2>&1 || docker volume create \
  --label "com.docker.compose.project=$project" --label "com.docker.compose.volume=$name" "$vol" >/dev/null

excludes=""
for e in "$@"; do excludes="$excludes --exclude=$e"; done

docker run --rm --network none --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  -e FORCE="${FORCE:-0}" -e EXCLUDES="$excludes" \
  -v "$vol:/dst" -v "$src:/src:ro" --entrypoint /bin/sh "$image" -c '
    set -eu
    if [ "$FORCE" != 1 ] && [ -n "$(ls -A /dst)" ]; then
      echo "seed-volume: volume มีข้อมูลแล้ว ไม่คัดลอก (FORCE=1 เพื่อทับ)" >&2; exit 1
    fi
    # shellcheck disable=SC2086
    tar -C /src $EXCLUDES -cf - . | tar -C /dst -xpf - --no-same-owner
    chown -R 10001:10001 /dst
    echo "seed-volume: $(du -sh /dst | cut -f1) ใน volume"'
echo "seed-volume: คัดลอก $src -> $vol แล้ว"
