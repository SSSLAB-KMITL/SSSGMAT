#!/bin/sh
# build image ทั้งสามแบบ linux/amd64 จาก commit ใน git (ไม่ใช้ไฟล์ที่ยังไม่ commit ใน working tree)
#
#   ./build.sh                       build ทั้งสาม แล้วติด tag :<commit> และ :prod
#   ./build.sh gnss-studio           build เฉพาะตัวที่ระบุ (gnss-studio, gpredict-web, eo-studio)
#   GNSS_REF=<branch|commit> ./build.sh gnss-studio      เลือก commit เอง
#
# ค่าตั้งต้นของ ref (branch ที่มี Dockerfile ของแต่ละแอป):
#   GNSS_REF=feature/production-docker       api-interop/gnss-predict/Dockerfile
#   GPREDICT_REF=feature/gpredict-web-docker api-interop/gpredict-web/Dockerfile (context = ราก repo)
#   EO_REF=feature/production-docker         api-interop/earth-observation-demo/Dockerfile
#
# ย้าย image ไปเครื่อง production (ไม่ต้องมี registry):
#   docker save gnss-studio:prod gpredict-web:prod eo-studio:prod | gzip > sss-apps-images.tar.gz
#   scp sss-apps-images.tar.gz server: && ssh server 'gunzip -c sss-apps-images.tar.gz | docker load'
set -eu

GNSS_REF="${GNSS_REF:-feature/production-docker}"
GPREDICT_REF="${GPREDICT_REF:-feature/gpredict-web-docker}"
EO_REF="${EO_REF:-feature/production-docker}"
cd "$(git rev-parse --show-toplevel)"

# build <image> <ref> <dockerfile ใน context> <tree-ish หรือ ref> [path ...]
build() {
  image="$1"; ref="$2"; dockerfile="$3"; tree="$4"; shift 4
  commit="$(git rev-parse --verify "$ref^{commit}")"
  short="$(git rev-parse --short=12 "$commit")"
  echo "== $image จาก $ref ($short)"
  git archive --format=tar "$tree" "$@" \
    | docker build --platform linux/amd64 -f "$dockerfile" \
        --label "org.opencontainers.image.revision=$commit" \
        --label "org.opencontainers.image.source=$ref" \
        -t "$image:$short" -t "$image:prod" -
}

targets="${*:-gnss-studio gpredict-web eo-studio}"
for t in $targets; do
  case "$t" in
    gnss-studio)
      c="$(git rev-parse --verify "$GNSS_REF^{commit}")"
      build gnss-studio "$GNSS_REF" Dockerfile "$c:api-interop/gnss-predict" ;;
    gpredict-web)
      c="$(git rev-parse --verify "$GPREDICT_REF^{commit}")"
      build gpredict-web "$GPREDICT_REF" api-interop/gpredict-web/Dockerfile "$c" \
        License.txt api-interop/gnss-predict/gnss_predict api-interop/gnss-predict/templates api-interop/gpredict-web ;;
    eo-studio)
      c="$(git rev-parse --verify "$EO_REF^{commit}")"
      build eo-studio "$EO_REF" Dockerfile "$c:api-interop/earth-observation-demo" ;;
    *) echo "build.sh: ไม่รู้จัก $t (ใช้ gnss-studio, gpredict-web, eo-studio)" >&2; exit 2 ;;
  esac
done
docker image ls --filter "reference=gnss-studio" --filter "reference=gpredict-web" --filter "reference=eo-studio"
