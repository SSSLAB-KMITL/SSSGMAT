# Production: GNSS Studio + Gpredict Web + Earth Observation Studio บน Docker

โฟลเดอร์นี้รวมสามแอปไว้หลัง [Caddy](https://caddyserver.com/) ตัวเดียว ซึ่งขอใบรับรอง HTTPS จาก Let's Encrypt เองและถาม
username/password (basic auth) ก่อนเข้าแอปใดก็ได้ แต่ละแอปมีโดเมนย่อยของตัวเอง

| แอป | image | port ใน container | ข้อมูล (volume) | ที่มาของโค้ด |
|---|---|---|---|---|
| GNSS Studio | `gnss-studio` | 8000 | `gnss_data` → `/data` | `api-interop/gnss-predict/` บน `feature/production-docker` |
| Gpredict Web | `gpredict-web` | 8740 | `gpredict_data` → `/data` | `api-interop/gpredict-web/` บน `feature/gpredict-web-docker` |
| Earth Observation Studio | `eo-studio` | 8018 | `eo_data` → `/data` | `api-interop/earth-observation-demo/` บน `feature/production-docker` |
| (ใช้ร่วม) cache ของ CelesTrak | — | — | `celestrak_cache` | GNSS Studio `/data/orbits/_cache`, Gpredict Web `/engine-data/orbits/_cache` |

```text
Internet ──443/80──▶ caddy ─┬─▶ gnss-studio:8000   (GMAT R2026a)
           basic auth       ├─▶ gpredict-web:8740  (GMAT R2026a, WebSocket)
           HTTPS            └─▶ eo-studio:8018     (SAR worker + YOLO CPU)
```

## 1. สิ่งที่เครื่อง production ต้องมี

- Linux **x86_64** (GMAT ทางการมีเฉพาะ x86_64) Docker Engine 26 ขึ้นไป + Compose v2
- RAM อย่างน้อย 8 GB (EO จำกัดไว้ 8 GB ตั้งได้ที่ `EO_STUDIO_MEM_LIMIT`) ดิสก์ว่างราว 25 GB (image ~4 GB, data EO ~12 GB)
- DNS ของสามโดเมนชี้มาที่เครื่อง และ firewall เปิด 80/tcp, 443/tcp, 443/udp
- ออกอินเทอร์เน็ตได้: Let's Encrypt, CelesTrak/CDDIS (GNSS Studio, Gpredict Web), Umbra S3 / Earth Search (EO), NASA GIBS (ถ้าเปิดภาพออนไลน์)

## 2. build image

ทำบนเครื่องที่มี repo นี้ (build จาก commit ไม่ใช้ไฟล์ที่ยังไม่ commit):

```bash
cd api-interop/deploy
./build.sh                    # ทั้งสาม: ติด tag :<commit 12 หลัก> และ :prod
./build.sh eo-studio          # เฉพาะตัวเดียว
```

บน Mac (Apple silicon) build ได้แต่ช้ากว่าเพราะ runtime เป็น `linux/amd64` (emulation) ส่ง image ไปเครื่อง production โดยไม่ต้องมี registry:

```bash
docker save gnss-studio:prod gpredict-web:prod eo-studio:prod | gzip > sss-apps-images.tar.gz
scp sss-apps-images.tar.gz server:
ssh server 'gunzip -c sss-apps-images.tar.gz | docker load'
```

หรือ clone repo บนเครื่อง production แล้วรัน `./build.sh` ที่นั่น (ต้อง push branch `feature/production-docker` และ
`feature/gpredict-web-docker` ขึ้น remote ก่อน: build.sh ใช้ `origin/<branch>` เองถ้ายังไม่ได้ checkout หรือกำหนด `GNSS_REF`, `GPREDICT_REF`, `EO_REF`)

## 3. ตั้งค่าและเปิด

**ถ้าจะย้ายข้อมูลเดิมขึ้น ให้ทำหัวข้อ 4 ก่อน `docker compose up` ครั้งแรก** (เปิดก่อนแล้ว volume จะมีไฟล์ตั้งต้นและ `seed-volume.sh` จะไม่คัดลอกทับ)

```bash
cd api-interop/deploy            # บนเครื่อง production ต้องมี compose.yaml, Caddyfile, .env, seed-volume.sh
cp .env.example .env
docker run --rm caddy:2.11.9 caddy hash-password --plaintext 'รหัสผ่านยาว ๆ'   # นำผลไปใส่ BASIC_AUTH_HASH
vi .env                          # โดเมน 3 ตัว, ACME_EMAIL, BASIC_AUTH_USER, BASIC_AUTH_HASH (ครอบด้วย ' ')
docker compose up -d
docker compose ps                # gnss-studio, gpredict-web, eo-studio ต้องเป็น healthy
docker compose logs -f caddy     # ดูการขอใบรับรอง
```

เปิด `https://<GNSS_STUDIO_DOMAIN>/`, `https://<GPREDICT_WEB_DOMAIN>/`, `https://<EO_STUDIO_DOMAIN>/` แล้วใส่ username/password

`init-volumes` เป็น container ที่รันครั้งเดียวแล้วจบ (สถานะ `exited (0)` เป็นปกติ) ให้รากของทุก volume เป็นของ uid 10001
และสร้าง `orbits/_cache` ใน `gnss_data` ก่อน mount cache ร่วม

## 4. ย้ายข้อมูลเดิมขึ้น (ไม่บังคับ)

volume ว่าง: GNSS Studio เปิดได้แต่ยังไม่มีพยากรณ์ (งานประจำวันปิดไว้ก่อน ดูหัวข้อ 6) Gpredict Web ดึงกลุ่ม amateur จาก CelesTrak
1 ครั้งตอนเปิดครั้งแรกเพื่อสร้าง module `Amateur` และ EO ต้องเตรียมภาพใหม่จาก Umbra S3 การย้ายข้อมูลจากเครื่องพัฒนาทำครั้งเดียวก่อน `up`:

```bash
# บนเครื่องพัฒนา: ส่งโฟลเดอร์ข้อมูลขึ้นเครื่อง production (rsync ต่อได้ถ้าขาด)
rsync -a --info=progress2 api-interop/gnss-predict/data/             server:/srv/import/gnss-predict-data/
rsync -a --info=progress2 api-interop/gpredict-web/data/             server:/srv/import/gpredict-web-data/
rsync -a --info=progress2 api-interop/earth-observation-demo/data/   server:/srv/import/eo-data/
#   EO: data/raw-csi (~11 GB) เป็น cache ภาพ CSI ที่สร้างใหม่ได้ ข้ามได้ด้วย --exclude raw-csi/ (เปิดภาพ CSI ครั้งแรกจะดาวน์โหลดใหม่ 1–2.5 GB)

# บนเครื่อง production
# ทำก่อน `docker compose up` ครั้งแรก (volume ยังว่าง)
./seed-volume.sh celestrak_cache /srv/import/gnss-predict-data/orbits/_cache
./seed-volume.sh gnss_data       /srv/import/gnss-predict-data ./orbits/_cache
./seed-volume.sh gpredict_data   /srv/import/gpredict-web-data
./seed-volume.sh eo_data         /srv/import/eo-data
docker compose up -d
```

`seed-volume.sh` ไม่ทับ volume ที่มีข้อมูลแล้ว และให้ไฟล์ทั้งหมดเป็นของ uid 10001 ถ้าเผลอ `up` ไปก่อน ให้ `docker compose down` แล้วใช้
`FORCE=1` กับ `gnss_data`, `gpredict_data`, `eo_data` ได้ แต่ **อย่า FORCE `celestrak_cache`** หลังเครื่อง production เคยดึง CelesTrak แล้ว:
`celestrak_state.json` ของเครื่องพัฒนาจะทับประวัติคำขอของเครื่องนี้ (กติกา 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมงนับจาก IP นี้)
`settings.json` ของ GNSS Studio ที่ย้ายขึ้นมาใช้ค่าเดิมของเครื่องพัฒนา รวม `cesium_ion_token` ถ้ามี — ตรวจก่อนย้าย

## 5. ความปลอดภัยที่ตั้งไว้

- เฉพาะ `caddy` ที่ publish port แอปทั้งสามไม่มี port บนเครื่อง เข้าได้ทาง proxy เท่านั้น
- basic auth ทุกคำขอ (รวม API, SSE, WebSocket) รหัสผ่านเก็บเป็น bcrypt hash ใน `.env`
- แอปทั้งสามกันคำขอข้ามเว็บไซต์ด้วย Host/Origin ของตัวเอง (`127.0.0.1:<port>`) proxy เขียน Host และเขียน Origin
  เฉพาะเมื่อ Origin เป็นหน้าเว็บของ proxy เอง Origin อื่นทุกค่าถูกเขียนเป็น `null` ก่อนถึงแอป (รวม `http://localhost:…` ของหน้าเว็บที่รันบนเครื่องผู้ใช้
  ซึ่งแอปเชื่อเป็นของตัวเอง) เว็บไซต์อื่นที่ส่งคำสั่งมา (แม้ browser แนบรหัส basic auth) จึงได้ 403 ทั้ง HTTP และ WebSocket
- Location ของ redirect จากแอป (`http://127.0.0.1:<port>/…`) ถูกเขียนกลับเป็นโดเมนของ proxy
- `POST /api/quit` ของ Gpredict Web ถูกปิดที่ proxy (403)
- ทุก container: `cap_drop: ALL`, `no-new-privileges` แอปรันเป็น uid 10001 (caddy ได้เพิ่มเฉพาะ `NET_BIND_SERVICE`)
- HSTS, `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`
- log ของ container หมุนไฟล์ที่ 20 MB × 5

basic auth เป็นบัญชีเดียวใช้ร่วมกัน ไม่มีสิทธิ์แยกผู้ใช้ ใครที่มีรหัสผ่านแก้ข้อมูลได้ทุกอย่างในแอป (scenario, module, สั่งวิทยุ/rotator, งานประมวลผล EO)
เพิ่มผู้ใช้ได้โดยเพิ่มบรรทัด `<user> <hash>` ใน `basic_auth` ของ `Caddyfile` แล้ว `docker compose restart caddy`

## 6. ค่าตั้งของแต่ละแอปหลังเปิด

- **GNSS Studio**: เปิดครั้งแรกเขียน `settings.json` ที่ **ปิดงานประจำวันและภาพออนไลน์ทุกแหล่ง** (ไม่ดึง CelesTrak/CDDIS เอง)
  เปิดใน Settings ของหน้าเว็บเมื่อพร้อม CelesTrak จำกัด 1 ครั้งต่อกลุ่มต่อ 2 ชั่วโมงต่อ IP และ cache ใช้ร่วมกับ Gpredict Web
  จึงนับรวมกัน รายละเอียด image ใน `api-interop/gnss-predict/README.md` หัวข้อ 10
- **Gpredict Web**: rigctld/rotctld ไม่อยู่ใน container ถ้ารันบนเครื่อง host ให้ตั้ง Host ใน Preferences → Interfaces เป็น
  `host.docker.internal` (rigctld ต้องฟังที่อินเทอร์เฟซที่ container เข้าถึงได้ เช่น `-T 0.0.0.0` และกันด้วย firewall) ถ้าอยู่เครื่องอื่นใช้ IP ของเครื่องนั้น
- **Earth Observation Studio**: worker YOLO ใช้ CPU (torch แบบ CPU) โมเดลอยู่ใน `eo_data/models` (ย้ายขึ้นตามหัวข้อ 4
  หรือรัน `docker compose exec eo-studio /app/.venv-detection/bin/python bootstrap_detector.py`)

## 7. งานประจำ

```bash
docker compose ps                         # สถานะ + healthcheck
docker compose logs -f --tail 200 gnss-studio
./build.sh && docker compose up -d        # อัปเดต: build ใหม่แล้ว recreate เฉพาะ container ที่ image เปลี่ยน
GNSS_STUDIO_IMAGE=gnss-studio:<commit> docker compose up -d gnss-studio   # rollback ด้วย tag เดิม

# สำรองข้อมูล (หยุดแอปก่อนเพื่อให้ไฟล์ไม่เปลี่ยนระหว่างคัดลอก)
docker compose stop gnss-studio gpredict-web eo-studio
for v in gnss_data gpredict_data eo_data celestrak_cache caddy_data; do
  # --user 0:0: caddy_data เป็นของ root (key 0600) และโฟลเดอร์ปลายทางอาจไม่ใช่ของ uid 10001
  docker run --rm --network none --user 0:0 -v sss-apps_$v:/v:ro -v "$PWD":/backup --entrypoint tar eo-studio:prod \
    -C /v -czf /backup/$v.tgz . || echo "สำรอง $v ไม่สำเร็จ" >&2
done
docker compose start gnss-studio gpredict-web eo-studio
```

`caddy_data` เก็บใบรับรองและ key ของ Let's Encrypt สำรองไว้ด้วยเพื่อไม่ต้องขอใหม่ (Let's Encrypt จำกัดจำนวนครั้ง)
ไฟล์ `.tgz` มี private key และ `settings.json` (อาจมี Cesium ion token) เก็บในที่ปลอดภัย (`.gitignore` กันไม่ให้ commit แล้ว)

## 8. ทดสอบบนเครื่องตัวเองก่อนขึ้นจริง

ใช้โดเมน `*.localhost` (Caddy ออกใบรับรองจาก CA ภายในของตัวเอง ไม่ใช้ Let's Encrypt) และ port อื่นถ้า 80/443 ไม่ว่าง:

```bash
cat > .env.local <<'X'
GNSS_STUDIO_DOMAIN=gnss.localhost
GPREDICT_WEB_DOMAIN=gpredict.localhost
EO_STUDIO_DOMAIN=eo.localhost
ACME_EMAIL=admin@example.com
BASIC_AUTH_USER=admin
BASIC_AUTH_HASH='<ผลของ caddy hash-password>'
HTTP_PORT=8080
HTTPS_PORT=8443
X
docker compose --env-file .env.local -p sss-apps-local up -d
curl -k -u admin:<รหัส> https://gnss.localhost:8443/api/health
```

browser จะเตือนใบรับรอง (CA ภายในของ Caddy) กดยอมรับเพื่อทดสอบ ปิดด้วย `docker compose -p sss-apps-local down`
(เพิ่ม `-v` เพื่อลบ volume ทดสอบ)

ข้อสังเกตตอนทดสอบ: redirect จาก `http://…:8080` ไป HTTPS ของ Caddy ไม่ใส่ port 8443 ให้ (ไปที่ `https://<host>/`) ให้เปิด
`https://<host>:8443/` ตรง ๆ บน production ใช้ 80/443 จึงไม่มีปัญหานี้ Chrome/Firefox แปลง `*.localhost` เป็น 127.0.0.1 เอง
ส่วน Safari อาจต้องเพิ่มใน `/etc/hosts`

## 9. ผลทดสอบ (2026-11-17)

ทดสอบบน Mac (Apple M-series, OrbStack, image `linux/amd64` ผ่าน emulation) ด้วย image ที่ `build.sh` สร้างจาก commit:
`gnss-studio:5ffd78faca7a`, `gpredict-web:a18f8f9ee39d`, `eo-studio:a3088c363001` (ขนาดบีบอัด 296 / 276 / 872 MB)
ระหว่างทดสอบ network ของแอปตั้งเป็น `internal` (ออกอินเทอร์เน็ตไม่ได้) จึงไม่มีคำขอไป CelesTrak, Umbra หรือแหล่งอื่น
volume ทดสอบ seed ด้วย `seed-volume.sh` จากสำเนาข้อมูลบนเครื่อง (EO ไม่รวม `raw-csi/`)

| รายการ | ผล |
|---|---|
| `docker compose up -d` (volume มีข้อมูล, และ volume ว่างใน project แยก) | `init-volumes` exit 0, ทั้งสามแอป `healthy`; volume ว่าง: GNSS Studio เขียน settings ที่ปิดงานประจำวัน, Gpredict Web เปิดได้โดยไม่มี module (ดึง amateur ไม่ได้เพราะ offline ไม่ล้ม) |
| ไม่ใส่รหัส / รหัสผิด | 401 ทั้งคู่ |
| หน้าแรกและ API (`/api/health`, `/api/qth`, `/api/eo/catalog`) ผ่าน proxy | 200 |
| คำสั่งแก้ข้อมูลที่ Origin เป็นหน้าเว็บของ proxy เอง | ผ่านตัวกันของแอป (ได้ 404/422 ตามเนื้อหา ไม่ใช่ 403) ทั้งสามแอป ทั้งจาก curl และจาก `fetch` ในหน้าเว็บจริง (Chromium) |
| Origin ของเว็บอื่น และ Origin ของอีกแอปใน stack เดียวกัน | 403 (`FORBIDDEN_ORIGIN` / `Origin is not this local app`) |
| Origin แบบ loopback (`http://127.0.0.1:8000`, `http://localhost:8000`, `http://localhost:5173`, `http://127.0.0.1:5178`, `http://127.0.0.1:8018`) | 403 ทั้งสามแอป (proxy เขียนเป็น `null`) |
| redirect ของแอป (`/api/qth/` ของ Gpredict Web) | `Location: https://gpredict.localhost:8443/api/qth` ไม่ใช่ 127.0.0.1 |
| `POST /api/quit` ของ Gpredict Web | 403 ที่ proxy |
| SSE `/api/events` ของ GNSS Studio | ได้ `event: ping` ทันที (ไม่ถูก buffer) |
| WebSocket `/ws/app` ของ Gpredict Web | 101 เมื่อ Origin เป็นของ proxy, 403 เมื่อ Origin อื่นหรือ `http://localhost:8740` |
| บีบอัด | ไฟล์ static ได้ `zstd`, `/api/*` ไม่บีบอัด |
| header | HSTS, nosniff, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin` |
| หน้าเว็บใน Chromium (headless) | GNSS Studio แสดง Welcome พร้อม scenario ที่ย้ายขึ้น, Gpredict Web แสดง module `tt` พร้อมดาวสด, EO แสดง 146 acquisitions |
| GMAT ใน GNSS Studio | propagate scenario `acc_20261111` ใหม่ใน container (37 วินาที) เทียบกับ ephemeris ที่ GMAT บน Mac สร้างไว้: 345,720 ตำแหน่ง ต่างกันสูงสุด 1 mm (ความละเอียดของ SP3) |
| GMAT ใน Gpredict Web | pass ถัดไปของ GRBBETA (60237) 4.8 วินาที |
| YOLO ใน EO | ตรวจจับ `vegas-wv3` (detail) แบบไม่ใช้ cache ด้วย torch CPU 13.1 วินาที พบ 2 วัตถุ |
| pytest ของ EO ใน image | 39/40 ข้อที่ล้มเกิดเฉพาะ emulation (ดู `earth-observation-demo/USAGE.md` หัวข้อ Docker) |
| `docker compose down` แล้ว `up -d` | ข้อมูลอยู่ครบ ผลทดสอบข้างบนซ้ำได้เหมือนเดิม |

ข้อจำกัดที่ทราบ (โค้ด engine เดิม ไม่ได้แก้ในรอบนี้): `celestrak_state.json` ใน cache ร่วมเขียนแบบอ่าน-แก้-เขียนโดยไม่มี lock ข้าม process
(`gnss_predict/omm.py`) ถ้า GNSS Studio และ Gpredict Web ดึง CelesTrak กลุ่มเดียวกันในเสี้ยววินาทีเดียวกัน ประวัติคำขอหนึ่งอาจหาย
ทำให้ขอซ้ำภายใน 2 ชั่วโมงได้ โอกาสต่ำ (งานประจำวันของ GNSS Studio ปิดไว้ตั้งต้น Gpredict Web ดึงเมื่อผู้ใช้สั่ง) แก้ถาวรด้วย `flock` ใน engine

ยังไม่ได้ทดสอบ: การขอใบรับรองจริงจาก Let's Encrypt (ต้องมีโดเมนจริง) และการรันบนเครื่อง x86_64 จริง (ความเร็ว GMAT/YOLO บนเครื่องจริงควรเร็วกว่าตัวเลขข้างบนที่ผ่าน emulation)

## 10. เปิดผ่าน Cloudflare Tunnel (แทน Let's Encrypt + basic auth)

ใช้ `compose.tunnel.yaml` + `Caddyfile.tunnel` แทน `compose.yaml` + `Caddyfile` เมื่อเครื่องไม่มี IP สาธารณะหรือไม่อยากเปิด port:
ไม่ publish port ใดบนเครื่อง `cloudflared` ต่อออกไปหา Cloudflare เอง HTTPS อยู่ที่ Cloudflare **ไม่มี basic auth** (ใครมีลิงก์เข้าได้)
caddy ยังเขียน Host/Origin ตามหัวข้อ 5 โดยเทียบ Origin กับ `*_PUBLIC_HOST`

```text
Internet ──HTTPS──▶ Cloudflare ══tunnel══▶ cloudflared ─▶ caddy ─┬─:18000─▶ gnss-studio:8000
                                                                  ├─:18740─▶ gpredict-web:8740
                                                                  └─:18018─▶ eo-studio:8018
```

1. สร้าง tunnel แบบ remotely-managed (Zero Trust → Networks → Tunnels หรือ API ด้วย token ที่มีสิทธิ์
   `Account · Cloudflare Tunnel · Edit` และ `Zone · DNS · Edit`) แล้วตั้ง public hostname:
   `<GNSS_PUBLIC_HOST>` → `http://caddy:18000`, `<GPREDICT_PUBLIC_HOST>` → `http://caddy:18740`, `<EO_PUBLIC_HOST>` → `http://caddy:18018`
   DNS เป็น CNAME (proxied) ไปที่ `<tunnel-id>.cfargotunnel.com` ใช้ชื่อชั้นเดียวใต้โดเมน (Universal SSL ครอบแค่ `*.<โดเมน>`)
2. ใส่ `GNSS_PUBLIC_HOST`, `GPREDICT_PUBLIC_HOST`, `EO_PUBLIC_HOST`, `CLOUDFLARE_TUNNEL_TOKEN` ใน `.env` (ดู `.env.example`)
3. `docker compose -f compose.tunnel.yaml up -d` แล้ว `docker compose -f compose.tunnel.yaml ps` ต้องเห็นแอปเป็น healthy

## 11. deploy โค้ดใหม่โดยเว็บไม่ล่ม

push ขึ้น GitHub แล้วรันบนเครื่อง production (ใช้กับ `compose.tunnel.yaml`):

```bash
cd api-interop/deploy
./deploy.sh                  # ทั้งสามแอป
./deploy.sh gpredict-web     # เฉพาะตัวที่ระบุ
```

1. `git fetch` แล้ว build image ใหม่ด้วย `build.sh` ระหว่างที่ตัวเดิมยังให้บริการ แอปที่ไฟล์ไม่เปลี่ยนได้ image เดิมและไม่ถูก restart
2. สลับทีละแอป (`docker compose up --no-deps --wait`) ช่วงสลับไม่กี่วินาที caddy พักคำขอไว้แล้วส่งต่อเมื่อตัวใหม่พร้อม
   (`lb_try_duration 60s`) ผู้ใช้ไม่เห็นหน้า error WebSocket / SSE ที่เปิดค้างหลุดแล้วหน้าเว็บต่อใหม่
3. ตัวใหม่ไม่ healthy ใน 5 นาที (`DEPLOY_WAIT`): กลับไปใช้ image เดิมเอง แล้วจบด้วย exit 1

| แอป | branch ที่ใช้ (ตั้งเองด้วย `GNSS_REF`, `GPREDICT_REF`, `EO_REF`) |
|---|---|
| GNSS Studio, Earth Observation Studio | `origin/feature/production-docker` |
| Gpredict Web | `origin/feature/gpredict-web-docker` |

- ไม่ deploy `compose*.yaml` / `Caddyfile.tunnel` ให้: `git pull` แล้ว
  `docker compose -f compose.tunnel.yaml exec caddy caddy reload --config /etc/caddy/Caddyfile` (แก้ Caddyfile, ไม่ล่ม)
  หรือ `docker compose -f compose.tunnel.yaml up -d` (แก้ compose, container ที่ค่าเปลี่ยนถูกสร้างใหม่)
- rollback ด้วยมือ: `docker tag <แอป>:<commit เดิม> <แอป>:prod && docker compose -f compose.tunnel.yaml up -d --no-deps --wait <แอป>`
