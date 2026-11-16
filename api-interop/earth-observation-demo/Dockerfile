# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
#
# Earth Observation Studio: FastAPI server + web/dist + worker สองชุด
#   - .venv            ประมวลผล SAR/Sentinel-2 (rasterio, sarpy, scipy ...) ตาม requirements-lock.txt
#   - .venv-detection  ตรวจจับ optical ด้วย YOLO (ultralytics + torch แบบ CPU) ตาม requirements-detection.lock
# build จากโฟลเดอร์นี้:  docker build --platform linux/amd64 -t eo-studio:dev .
# รายละเอียดการ deploy: ../../deploy/README.md
#
# โครงใน image เหมือนโฟลเดอร์โปรเจกต์ (/app = api-interop/earth-observation-demo) เพราะ server.py หา
# .venv/bin/python, .venv-detection/bin/python, research/ และ web/dist จากตำแหน่งของตัวเอง ไม่ต้องแก้โค้ด
# ข้อมูลทั้งหมด (scenes, jobs, models, raw-csi ...) อยู่ที่ EO_DATA=/data (volume) ไม่อยู่ใน image

ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df
ARG NODE_IMAGE=node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

# ---------------------------------------------------------------------------------------------------------------------
# 1) หน้าเว็บ: build บนสถาปัตยกรรมของเครื่องที่ build (ไฟล์ static) ใช้ package-lock.json ที่ commit ไว้เท่านั้น
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build && test -f dist/index.html && test -d dist/cesium/Workers

# ---------------------------------------------------------------------------------------------------------------------
# 2) runtime: linux/amd64 (เหมือนอีกสองแอป เครื่อง production เป็น x86_64)
FROM --platform=linux/amd64 ${PYTHON_IMAGE} AS runtime
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    EO_DATA=/data \
    EO_PORT=8018 \
    MPLCONFIGDIR=/tmp/matplotlib

# ffmpeg: Sequence (GIF/MP4) / libgl1 + libglib2.0-0: opencv ของ ultralytics / tini: PID 1 ส่งสัญญาณยกเลิกถึง process group ของ worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# venv หลัก: requirements-lock.txt คือชุดที่ทดสอบแล้ว (รวม pytest/httpx สำหรับรัน test ใน container)
COPY requirements-lock.txt ./
RUN python -m venv /app/.venv \
 && /app/.venv/bin/pip install --no-cache-dir -r requirements-lock.txt

# venv ตรวจจับ: torch/torchvision จาก index แบบ CPU ของ PyTorch (wheel บน PyPI ของ Linux ดึง CUDA หลาย GB)
# PEP 440: torch==2.15.0 ใน lock รับ 2.15.0+cpu ได้ และ +cpu มาก่อนเพราะ local version สูงกว่า
COPY requirements-detection.lock ./
RUN python -m venv /app/.venv-detection \
 && /app/.venv-detection/bin/pip install --no-cache-dir \
      --extra-index-url https://download.pytorch.org/whl/cpu \
      -r requirements-detection.lock \
 && /app/.venv-detection/bin/python -c "import torch, ultralytics; assert not torch.cuda.is_available(); print('torch', torch.__version__)"

COPY eo_engine/ eo_engine/
COPY research/ research/
COPY server.py worker_entry.py optical_worker_entry.py bootstrap.py bootstrap_detector.py bootstrap_highres.py ./
COPY tests/ tests/
COPY --from=web /src/web/dist web/dist
COPY docker/entrypoint.sh /usr/local/bin/eo-entrypoint

RUN groupadd --gid 10001 eo \
 && useradd --uid 10001 --gid eo --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin eo \
 && mkdir -p /data \
 && chown eo:eo /data \
 && chmod 0755 /usr/local/bin/eo-entrypoint \
 && /app/.venv/bin/python -c "import rasterio, sarpy, scipy, pyproj, fastapi, uvicorn; import server"

USER eo
VOLUME ["/data"]
EXPOSE 8018
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD /app/.venv/bin/python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/eo/catalog' % os.environ.get('EO_PORT', '8018'), timeout=8)"
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/eo-entrypoint"]
