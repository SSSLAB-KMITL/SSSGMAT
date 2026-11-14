# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
#
# GNSS Studio: server (FastAPI) + หน้าเว็บ (web/dist) + NASA GMAT R2026a Linux x86_64 ทางการ (ทางเลือก ก)
# build จากโฟลเดอร์ api-interop/gnss-predict:
#   docker build --platform linux/amd64 -t gnss-studio:dev .
# หรือ docker compose build (docker-compose.yml) รายละเอียดใน README หัวข้อ 10 และ docs/2026-11-15-gnss-studio-docker-decisions.md
#
# ภายใน image จัดโครงเหมือน repo เพื่อให้โค้ดหา GMAT ได้เองแม้ไม่ตั้ง GMAT_BIN (REPO_ROOT = /opt/sssgmat):
#   /opt/sssgmat/application/                GMAT R2026a (ตัด GUI/เอกสารออก)
#   /opt/sssgmat/api-interop/gnss-predict/   gnss_predict, templates, server, web/dist

ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

# ---------------------------------------------------------------------------------------------------------------------
# 1) หน้าเว็บ: build บนสถาปัตยกรรมของเครื่องที่ build (ผลเป็นไฟล์ static ไม่ขึ้นกับ CPU) npm ci ใช้ package-lock.json ที่ commit ไว้เท่านั้น
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
WORKDIR /src/gnss-predict/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
# vite.config.ts คัดลอก catalog.json + glb ที่ catalog ระบุจาก ../models ไป dist/models
COPY models/ ../models/
RUN npm run build && test -f dist/index.html && test -d dist/cesium/Workers && test -f dist/models/catalog.json

# ---------------------------------------------------------------------------------------------------------------------
# 2) GMAT: ดาวน์โหลด tarball ทางการจาก SourceForge ตรวจ checksum แล้วแตกไฟล์ (ไม่รันอะไรจาก tarball ใน stage นี้)
#    MD5 ทางการ: SourceForge RSS ของโฟลเดอร์ (media:hash algo="md5") https://sourceforge.net/projects/gmat/rss?path=/GMAT/GMAT-R2026a
#    SHA-256 คำนวณจากไฟล์ที่ผ่าน MD5 ทางการแล้ว (SourceForge ไม่เผยแพร่ SHA-256) ใช้กันการชนของ MD5
#    ขนาดไฟล์ 401664992 ไบต์ตรงกับ filesize ใน RSS เดียวกัน
#    อัปเดต GMAT: เปลี่ยน 4 ค่าข้างล่าง (ดู README หัวข้อ 10.6)
FROM --platform=$BUILDPLATFORM ${UBUNTU_IMAGE} AS gmat
ARG GMAT_VERSION=R2026a
ARG GMAT_URL=https://downloads.sourceforge.net/project/gmat/GMAT/GMAT-R2026a/gmat-ubuntu-x64-R2026a.tar.gz
ARG GMAT_MD5=ec496a0319657fa2c079d7e996b9b1ed
ARG GMAT_SHA256=fe124b4a606b2e3b704a6fbb1c37b87598d5df0d18cb661c304b5f60074a7754
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 3 --proto '=https' --proto-redir '=https' -o /tmp/gmat.tar.gz "${GMAT_URL}" \
 && echo "${GMAT_MD5}  /tmp/gmat.tar.gz" | md5sum -c - \
 && echo "${GMAT_SHA256}  /tmp/gmat.tar.gz" | sha256sum -c - \
 && mkdir -p /tmp/gmat /opt/sssgmat \
 && tar -xzf /tmp/gmat.tar.gz -C /tmp/gmat --no-same-owner --no-same-permissions \
 && mv "/tmp/gmat/GMAT/${GMAT_VERSION}" /opt/sssgmat/application \
 && rm -rf /tmp/gmat /tmp/gmat.tar.gz
COPY docker/gmat-headless.sh /usr/local/bin/gmat-headless.sh
RUN sh /usr/local/bin/gmat-headless.sh /opt/sssgmat/application

# ---------------------------------------------------------------------------------------------------------------------
# 3) runtime: linux/amd64 เท่านั้น (GMAT ทางการมีแต่ x86_64) Ubuntu 24.04: GMAT R2026a ทดสอบบนรุ่นนี้ และมี Python 3.12 (server ต้อง ≥ 3.11)
FROM --platform=linux/amd64 ${UBUNTU_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    GNSS_STUDIO_DATA=/data \
    GNSS_STUDIO_HOST=0.0.0.0 \
    GNSS_STUDIO_PORT=8000 \
    GMAT_BIN=/opt/sssgmat/application/bin/GmatConsole \
    PYTHONPATH=/opt/sssgmat/api-interop/gnss-predict/server:/opt/sssgmat/api-interop/gnss-predict

# python3-venv: server ติดตั้งใน venv (Ubuntu 24.04 ห้าม pip ลง system) / curl + ca-certificates: fetch และ validate ดึง FTPS
# (ใช้เมื่อผู้ใช้เปิดงานประจำวันหรือสั่งเองเท่านั้น) / tini: PID 1 ที่ส่งสัญญาณต่อและเก็บ process ลูกของ GMAT
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates tini libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

COPY --from=gmat /opt/sssgmat/application /opt/sssgmat/application

ARG APP=/opt/sssgmat/api-interop/gnss-predict
COPY gnss_predict ${APP}/gnss_predict
COPY templates ${APP}/templates
COPY server/requirements.txt ${APP}/server/requirements.txt
COPY server/gnss_studio_server ${APP}/server/gnss_studio_server
COPY --from=web /src/gnss-predict/web/dist ${APP}/web/dist
COPY docker/entrypoint.sh /usr/local/bin/gnss-studio-entrypoint
COPY docker/settings.first-run.json ${APP}/docker/settings.first-run.json

# ผู้ใช้ไม่ใช่ root: เขียนได้เฉพาะ /data และ output/ ของ GMAT (OUTPUT_PATH ใน startup file)
# ตรวจตอน build ว่า GmatConsole และ plugin ทุกตัวหาไลบรารีครบ และ GmatConsole เปิดได้จริงแบบไม่มี DISPLAY
# (plugin ไม่มี RPATH ไปหา libGmatBase/libGmatUtil เพราะ GmatConsole โหลดไว้ก่อนแล้วตอน dlopen จึงตรวจด้วย LD_LIBRARY_PATH ของ bin/ และ plugins/)
RUN groupadd --gid 10001 gnss \
 && useradd --uid 10001 --gid gnss --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin gnss \
 && mkdir -p /data /opt/sssgmat/application/output \
 && chown gnss:gnss /data /opt/sssgmat/application/output \
 && chmod 0755 /usr/local/bin/gnss-studio-entrypoint \
 && missing="$(for f in /opt/sssgmat/application/bin/GmatConsole-* /opt/sssgmat/application/bin/*.so* \
                         /opt/sssgmat/application/plugins/*.so.* /opt/sssgmat/application/plugins/*/*.so.*; do \
                 LD_LIBRARY_PATH=/opt/sssgmat/application/bin:/opt/sssgmat/application/plugins ldd "$f" | grep 'not found' | sed "s@^@$f: @"; done)" \
 && if [ -n "$missing" ]; then echo "$missing"; exit 1; fi \
 && cd /opt/sssgmat/application/bin && ./GmatConsole --version | grep -q 'Build Date' \
 && python -c "import fastapi, uvicorn, gnss_predict.studio, gnss_studio_server.app"

USER gnss
WORKDIR /opt/sssgmat/api-interop/gnss-predict/server
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('GNSS_STUDIO_PORT', '8000'), timeout=8)"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/gnss-studio-entrypoint"]
