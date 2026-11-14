# GNSS Studio งานย่อยที่ 5 (Docker): บันทึกการตัดสินใจ

- วันที่: 2026-11-15
- Branch: `feature/gnss-studio-imagery`
- อ้างอิง: [2026-11-15-docker-research.md](2026-11-15-docker-research.md) (เลือกทางเลือก ก), README หัวข้อ 10
- ไฟล์: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `docker/entrypoint.sh`, `docker/gmat-headless.sh`, `docker/settings.first-run.json`

## สิ่งที่ต่างจากร่างในเอกสารวิจัย และเหตุผล

| # | ร่างในเอกสารวิจัย | สิ่งที่ทำจริง | เหตุผล |
|---|---|---|---|
| 1 | base `ubuntu:22.04` | `ubuntu:24.04` pin ด้วย digest | server ต้องใช้ Python ≥ 3.11 (README 8.1) แต่ 22.04 มี 3.10 ส่วน 24.04 มี 3.12 และ `README.txt` ของ GMAT R2026a ระบุว่า "tested on Ubuntu 24.04 LTS" ไม่ต้องเพิ่ม PPA |
| 2 | `pip3 install` ลง system | venv ที่ `/opt/venv` | Ubuntu 24.04 ห้าม pip ลง system (PEP 668) |
| 3 | build context = root ของ repo, `docker/Dockerfile.gmat` | context = `api-interop/gnss-predict`, `Dockerfile` อยู่ที่นั่น | ตามขอบเขตงาน (ไฟล์ Docker อยู่ในแอปเท่านั้น) และ context เล็ก (`.dockerignore` แบบ allowlist) |
| 4 | แอปที่ `/app` | โครงเหมือน repo: `/opt/sssgmat/application` (GMAT) และ `/opt/sssgmat/api-interop/gnss-predict` (แอป) | `gnss_predict/config.py` คำนวณ `REPO_ROOT = parents[3]` ของ `config.py` ถ้าวางที่ `/app/gnss_predict` จะได้ `IndexError` ตอน import; โครงนี้ทำให้หา GMAT ได้เองแม้ไม่ตั้ง `GMAT_BIN` |
| 5 | checksum SHA-1 จากไอคอน (i) | MD5 ทางการ + SHA-256 ที่คำนวณเอง | หน้า Files ของ SourceForge ติด Cloudflare challenge (HTTP 403) และ WebFetch ไม่เห็นค่า checksum; RSS ทางการของโฟลเดอร์ (`https://sourceforge.net/projects/gmat/rss?path=/GMAT/GMAT-R2026a`) มี `<media:hash algo="md5">ec496a0319657fa2c079d7e996b9b1ed</media:hash>` และ `filesize="401664992"` ซึ่งไฟล์ที่ดาวน์โหลดตรงทั้งสองค่า จึง pin MD5 นี้ และ pin SHA-256 ของไฟล์เดียวกันเพิ่มกันการชนของ MD5 |
| 6 | `sed` comment plugin ใน Dockerfile | `docker/gmat-headless.sh` | ตรวจว่าปิดครบ, plugin ที่เหลือมีไฟล์จริง, และตัดไฟล์ที่ไม่ใช้ในที่เดียว build ล้มถ้ารูปแบบ tarball เปลี่ยน |
| 7 | ไม่ได้ตัดอะไร (~1.0–1.3 GB) | ตัด GUI, เอกสาร, ตัวอย่าง, gmatpy, Java/MATLAB, plugin Python/MATLAB/OpenFrames, `libCSALT` | image เหลือ 296 MB (บีบอัด) / ~479 MB (แตกแล้ว) `libCSALT` ต้องการ `libsnopt7` ที่ไม่ได้แจกมา (`ldd` ฟ้อง not found) และไม่มี plugin ใน startup file ใช้ |
| 8 | seed `{"daily":{"enabled":false}}` | seed เอกสารเต็มตาม `settings.py` ปัจจุบัน (daily ปิด, `online_imagery` ปิดครบ 4 แหล่ง, token ว่าง) จาก `docker/settings.first-run.json` | ตรงรูปแบบที่ `PUT /api/settings` เขียน ผู้ใช้เห็นค่าทุกช่องในไฟล์; เขียนผ่านไฟล์ชั่วคราวแล้ว `mv` และไม่ทับไฟล์หรือ symlink ที่มีอยู่ |
| 9 | รันเป็น root, `exec python3` เป็น PID 1 | ผู้ใช้ `gnss` uid 10001 + `tini` เป็น PID 1 | ลดสิทธิ์; `tini` ส่งสัญญาณต่อและเก็บ zombie ของ GMAT ที่รันใน session ใหม่ (`start_new_session=True`) |
| 10 | port `127.0.0.1:8000:8000` คงที่ | `127.0.0.1:${GNSS_STUDIO_PORT:-8000}:${GNSS_STUDIO_PORT:-8000}` และส่ง `GNSS_STUDIO_PORT` เข้า container | `OriginGuard` รับ Origin `http://127.0.0.1:<Config.port>` เท่านั้น ถ้า port ของ host ต่างจาก container หน้าเว็บจะได้ 403 ทุกคำสั่งที่แก้ข้อมูล |
| 11 | stage GMAT อยู่ใน runtime (emulated) | stage `gmat` และ `web` รันบน `$BUILDPLATFORM` | ดาวน์โหลด ตรวจ checksum แตกไฟล์ และ build หน้าเว็บไม่ขึ้นกับ CPU จึงไม่ต้องผ่าน Rosetta/QEMU; เฉพาะ runtime เป็น `linux/amd64` (hardcode ใน `FROM` เพราะ GMAT มีแต่ x86_64) |
| 12 | ไม่มีการตรวจตอน build | `ldd` ทุก binary/plugin (ด้วย `LD_LIBRARY_PATH` ของ `bin/` และ `plugins/` เพราะ plugin ไม่มี RPATH ไปหา `libGmatBase`) + `GmatConsole --version` + import server | image ที่ GMAT เปิดไม่ได้ต้อง build ไม่ผ่าน ไม่ใช่ไปพังตอน job แรก |
| 13 | ไม่มี healthcheck | `HEALTHCHECK` เรียก `/api/health` ใน container | compose/`docker ps` แสดงสถานะได้ |

## สิ่งที่คงไว้ตามเอกสารวิจัย

- `GmatConsole` headless โดยไม่ต้องมี `DISPLAY`/X11/Xvfb (ยืนยันแล้ว: ไม่มีตัวแปร `DISPLAY` ใน container และ script ทดสอบจบด้วย
  `*** GMAT Integration test (Console version) successful! ***`)
- `GNSS_STUDIO_HOST=0.0.0.0` ใน container + map port ที่ `127.0.0.1` ของ host; คำเตือน `NOT_LOOPBACK_TEXT` ตอนเปิดเป็นเรื่องที่คาดไว้
- `curl` + `ca-certificates` อยู่ใน image สำหรับ `fetch`/`validate` เมื่อผู้ใช้สั่งเท่านั้น
- ไม่แก้โค้ดของ `gnss_predict` หรือ `server`

## ผลตรวจ (2026-11-15, Apple silicon + OrbStack/Rosetta)

- `docker build --platform linux/amd64 -t gnss-studio:dev .` ผ่าน, image 296 MB (CONTENT SIZE) / ~479 MB แตกแล้ว
- container บน volume ว่าง: `/api/health` 200 (`gmat_found: true`), `settings.json` ถูกเขียนตาม 8 ข้างบน, Host อื่น 400, PUT ที่ Origin อื่น 403,
  port ผูก `127.0.0.1` เท่านั้น
- propagate snapshot fixture 6 ดวง 24 ชม. step 30 วินาที: macOS 2.4 วินาที, container CLI 9.1 วินาที, container API job 5.7 วินาที
- parity: hash เดียวกัน (`8ce4ea1ede0d`), `|Δpos|` สูงสุด 0.001 m ทั้ง 17286 ตำแหน่ง (ความละเอียดของ SP3)

## ข้อจำกัดและงานต่อ

- image `linux/amd64` เท่านั้น บน Apple silicon ช้ากว่า native ราว 2–4 เท่าในงาน propagate ที่วัด; ถ้าต้องการ arm64 native ดูทางเลือก ข ในเอกสารวิจัย
- dependency ทางอ้อมของ `fastapi`/`uvicorn` (เช่น pydantic, starlette) ไม่ได้ pin เหมือนกับการติดตั้งบนเครื่อง (`server/requirements.txt` pin แค่สองตัว)
- build ใช้ไฟล์ใน working tree (รวมการแก้ที่ยังไม่ commit ใน `web/`) ไม่ใช่ commit ใด commit หนึ่ง ถ้าต้องการ image ที่ทำซ้ำได้ให้ build จาก checkout ที่สะอาด
- ถ้าเปิดงานประจำวันใน container แล้ว `daily` ใช้เวลาของ container (UTC) เหมือน server บนเครื่อง
