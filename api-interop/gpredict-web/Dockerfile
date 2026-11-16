# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
#
# Gpredict Web: server (FastAPI + WebSocket) + web/dist + engine gnss_predict + NASA GMAT R2026a Linux x86_64 ทางการ
# build context คือราก repo (ต้องใช้ License.txt, api-interop/gnss-predict และ api-interop/gpredict-web):
#   docker build --platform linux/amd64 -f api-interop/gpredict-web/Dockerfile -t gpredict-web:dev .
# Dockerfile.dockerignore ข้างไฟล์นี้กำหนดว่าส่งอะไรเข้า context (allowlist) รายละเอียดใน README หัวข้อ "Docker"
#
# โครงใน image เหมือน repo เพื่อให้โค้ดหาไฟล์จากตำแหน่งของตัวเองได้ (REPO_ROOT = /opt/sssgmat):
#   /opt/sssgmat/License.txt                        Help → License
#   /opt/sssgmat/application/                       GMAT R2026a (ตัด GUI/เอกสารออก) run_gmat หาเองจาก REPO_ROOT
#   /opt/sssgmat/api-interop/gnss-predict/          engine gnss_predict + templates (gpredict_web ใส่ sys.path เอง)
#   /opt/sssgmat/api-interop/gpredict-web/          server, web/dist, README.md (Help → Online help)

ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:2198e4c65076e9cb0b3d695219df667c0e3b0072da64ca3c2648aca17dcecaf5
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

# ---------------------------------------------------------------------------------------------------------------------
# 1) หน้าเว็บ: build บนสถาปัตยกรรมของเครื่องที่ build (ไฟล์ static) npm ci ใช้ package-lock.json ที่ commit ไว้เท่านั้น
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY api-interop/gpredict-web/web/package.json api-interop/gpredict-web/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY api-interop/gpredict-web/web/ ./
RUN npm run build && test -f dist/index.html

# ---------------------------------------------------------------------------------------------------------------------
# 2) GMAT: tarball ทางการจาก SourceForge ตรวจ MD5 (จาก RSS ของ SourceForge) + SHA-256 แล้วแตกไฟล์ ค่าเดียวกับ image GNSS Studio
#    (api-interop/gnss-predict/Dockerfile และ README หัวข้อ 10.5 บน branch ของ GNSS Studio)
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
COPY api-interop/gpredict-web/docker/gmat-headless.sh /usr/local/bin/gmat-headless.sh
RUN sh /usr/local/bin/gmat-headless.sh /opt/sssgmat/application

# ---------------------------------------------------------------------------------------------------------------------
# 3) runtime: linux/amd64 เท่านั้น (GMAT ทางการมีแต่ x86_64) Ubuntu 24.04 + Python 3.12
FROM --platform=linux/amd64 ${UBUNTU_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    GPREDICT_WEB_DATA=/data \
    GNSS_STUDIO_DATA=/engine-data \
    GPREDICT_WEB_PORT=8740 \
    GMAT_BIN=/opt/sssgmat/application/bin/GmatConsole

# tini: PID 1 ที่ส่งสัญญาณต่อและเก็บ process ลูกของ GMAT / ca-certificates: ดึง TLE (CelesTrak) และ transponder (SatNOGS) เมื่อผู้ใช้สั่ง
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl tini libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY api-interop/gpredict-web/docker/constraints.txt /tmp/pyreq/constraints.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir "fastapi==0.162.4" "uvicorn==0.54.0" "websockets==17.3" -c /tmp/pyreq/constraints.txt \
 && rm -rf /tmp/pyreq

COPY --from=gmat /opt/sssgmat/application /opt/sssgmat/application

COPY License.txt /opt/sssgmat/License.txt
COPY api-interop/gnss-predict/gnss_predict /opt/sssgmat/api-interop/gnss-predict/gnss_predict
COPY api-interop/gnss-predict/templates /opt/sssgmat/api-interop/gnss-predict/templates
ARG APP=/opt/sssgmat/api-interop/gpredict-web
COPY api-interop/gpredict-web/README.md ${APP}/README.md
COPY api-interop/gpredict-web/server/requirements.txt ${APP}/server/requirements.txt
COPY api-interop/gpredict-web/server/gpredict_web ${APP}/server/gpredict_web
COPY --from=web /src/web/dist ${APP}/web/dist
COPY api-interop/gpredict-web/docker/entrypoint.sh /usr/local/bin/gpredict-web-entrypoint
COPY api-interop/gpredict-web/docker/gmat-check-libs.sh /usr/local/bin/gmat-check-libs.sh

# ผู้ใช้ไม่ใช่ root (uid 10001 เหมือน image GNSS Studio จึงใช้ volume cache ของ CelesTrak ร่วมกันได้)
# /engine-data/orbits/_cache สร้างไว้ใน image ให้เป็นของ uid 10001: volume ที่ mount ทับตรงนี้ครั้งแรกได้เจ้าของเดียวกัน
# ตรวจตอน build ว่า GmatConsole และ plugin ทุกตัวหาไลบรารีครบ (อย่างน้อย 23 ไฟล์) และ GmatConsole เปิดได้จริงแบบไม่มี DISPLAY
RUN groupadd --gid 10001 gpredict \
 && useradd --uid 10001 --gid gpredict --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin gpredict \
 && mkdir -p /data /engine-data/orbits/_cache /opt/sssgmat/application/output \
 && chmod 0755 /usr/local/bin/gpredict-web-entrypoint /usr/local/bin/gmat-check-libs.sh \
 && /usr/local/bin/gmat-check-libs.sh /opt/sssgmat/application 23 \
 && (cd /opt/sssgmat/application/bin && ./GmatConsole --version | grep -q 'Build Date') \
 && chown gpredict:gpredict /data \
 && chown -R gpredict:gpredict /engine-data /opt/sssgmat/application/output \
 && cd ${APP}/server && python -c "import fastapi, uvicorn, websockets, gpredict_web.app, gpredict_web.__main__"

USER gpredict
WORKDIR /opt/sssgmat/api-interop/gpredict-web/server
# /engine-data ไม่ใช่ volume: engine เขียนเฉพาะ OMM cache ที่ /engine-data/orbits/_cache ซึ่ง deploy mount volume ร่วมกับ GNSS Studio ทับไว้
VOLUME ["/data"]
EXPOSE 8740
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/qth' % os.environ.get('GPREDICT_WEB_PORT', '8740'), timeout=8)"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/gpredict-web-entrypoint"]
