# GNSS Studio Imagery (แบบ ข) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sensor View gets a Camera display mode with zoom, and every 3D globe (3D windows + Sensor View) can show real NASA GIBS imagery fetched through the local server behind an off-by-default switch.

**Architecture:** Server adds `online_imagery.enabled` to `settings.json` and a `/api/imagery` router: a fixed layer catalog, strict path validation, a stdlib-`urllib` fetcher with concurrency/pause limits, magic-byte checks and an LRU disk cache under `<data>/imagery/tiles`. Web adds a pure time-token module, a globe-layer selection stored in the workbook, a layer manager that keeps each Cesium viewer's GIBS layers in sync with selection + animation time, a Globe Manager window with a Thai consent dialog, and Camera/zoom params for Sensor View.

**Tech Stack:** FastAPI + pydantic (strict), stdlib urllib; React/TS, zustand, CesiumJS 1.147 (`UrlTemplateImageryProvider`, `WebMercatorTilingScheme`), vitest (jsdom), Playwright.

**Spec:** `api-interop/gnss-predict/docs/2026-11-14-gnss-studio-imagery-design.md` (cited "spec §n"). App root below = `api-interop/gnss-predict` (abbrev. R). Server package S = `R/server/gnss_studio_server`, web W = `R/web`.

## Global Constraints

- Never merge into main, never push. Commit only on `feature/gnss-studio-imagery` in worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery`; run `git branch --show-current` before every commit. Never use bare `git stash`.
- Every commit message ends with exactly one trailer line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (no other co-author lines).
- **No test and no implementer may contact any external host** (gibs.earthdata.nasa.gov, celestrak.org, …). Server tests use an injected fake opener and the existing `no_network` fixture pattern (`server/tests/test_orbits.py:200-212`). No test calls the real `/api/orbits/fetch`, `/api/daily/run` or `/validate`.
- Any data dir a task creates for a manual run gets `settings.json` FIRST with daily disabled: `{"daily":{"enabled":false,"run_at_utc":"21:00","facility":"THBK","retention_days":30,"validation_retry_hours":3,"validation_give_up_days":14},"cesium_ion_token":"","online_imagery":{"enabled":false}}`
- Server adds no dependency (requirements.txt unchanged). Outbound HTTP = `urllib.request` with an injectable opener.
- UI wording: menu/window/page/field names in STK English (`stk(text, section)` only if verbatim in the STK reference doc, else `ours(text)`); all messages in Thai via `msg()`; every message contains a Thai character.
- GIBS upstream URL template (verbatim): `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Layer}/default/{Time}/{TileMatrixSet}/{z}/{y}/{x}.{ext}`
- Catalog (verbatim, one table in `S/imagery.py`; order = draw order, later on top):

  | id | title | period | tms | max_level | ext | credit |
  |---|---|---|---|---|---|---|
  | BlueMarble_NextGeneration | Blue Marble | static | GoogleMapsCompatible_Level8 | 8 | jpg | NASA GIBS / EOSDIS |
  | VIIRS_NOAA20_CorrectedReflectance_TrueColor | VIIRS NOAA-20 True Color | daily | GoogleMapsCompatible_Level9 | 9 | jpg | NASA GIBS / EOSDIS |
  | VIIRS_SNPP_CorrectedReflectance_TrueColor | VIIRS Suomi NPP True Color | daily | GoogleMapsCompatible_Level9 | 9 | jpg | NASA GIBS / EOSDIS |
  | MODIS_Terra_CorrectedReflectance_TrueColor | MODIS Terra True Color | daily | GoogleMapsCompatible_Level9 | 9 | jpg | NASA GIBS / EOSDIS |
  | Himawari_AHI_Band3_Red_Visible_1km | Himawari-9 Red Visible | 10min | GoogleMapsCompatible_Level7 | 7 | png | NASA GIBS / EOSDIS, JMA |
  | Himawari_AHI_Band13_Clean_Infrared | Himawari-9 Clean Infrared | 10min | GoogleMapsCompatible_Level6 | 6 | png | NASA GIBS / EOSDIS, JMA |
  | GOES-East_ABI_GeoColor | GOES-East GeoColor | 10min | GoogleMapsCompatible_Level7 | 7 | jpg | NASA GIBS / EOSDIS, NOAA |
  | GOES-West_ABI_GeoColor | GOES-West GeoColor | 10min | GoogleMapsCompatible_Level7 | 7 | jpg | NASA GIBS / EOSDIS, NOAA |

- Time token: static → `default`; daily → UTC `YYYY-MM-DD`; 10min → UTC floor to 10 min `YYYY-MM-DDTHH:MM:00Z`.
- Limits: fetch timeout 20 s; ≤ 4 concurrent fetches, queue wait > 15 s → 503 `IMAGERY_BUSY`; upstream 403/429 → pause 15 min; 20 consecutive network/5xx failures → pause 5 min; body ≤ 2 MB; cache ≤ 2 GB (2 × 1024³ bytes) → evict oldest mtime down to 90 %; not-available memo 1 h, ≤ 10,000 entries.
- Sensor View params: `display: "camera" | "sensor"` (default and fallback `"camera"`), `zoom ∈ {1,2,4,8,16,32,64,128}` (default/fallback 1).

## Review Focus

1. A `settings.json` written by older code (no `online_imagery`) or the Daily Forecast Settings window saving after this change must never turn imagery on and must not 422 — the Daily window must send back the `online_imagery` it loaded.
2. Switch off ⇒ zero upstream calls, including when the tile is already in cache, and zero tile requests from the browser (the layer manager adds no GIBS layer).
3. Path traversal / odd input on the tile route (`..`, `%2F`, negative or huge z/x/y, `time` with extra chars, layer ids differing only in case) never reaches the opener and never writes outside `<data>/imagery/tiles`.
4. Animation playing fast (multiplier 3600×) must not rebuild layers more than once per second per viewer, and two viewers never share one provider instance.
5. Camera mode hides overlays only in its own Sensor View window; the main 3D window and other Sensor Views keep their entities, and switching back to Sensor restores exactly the previous visibility (including objects the user had hidden).

---

### Task 1: `online_imagery` setting end to end

**Files:**
- Modify: `S/settings.py` (`OnlineImagery`, `OnlineImageryIn`, `Settings.online_imagery`, `SettingsIn`, `missing_field`)
- Modify: `W/src/stores/settings.ts` (`OnlineImagerySettings`, `Settings.online_imagery`)
- Modify: `W/src/windows/DailyForecastSettings/DailyForecastSettings.tsx` (`validate()` keeps the loaded `online_imagery`)
- Regenerate: `W/src/api/openapi.json`, `W/src/api/types.gen.ts` (`npm run gen:api`)
- Modify fixtures/tests that assert the exact settings document: `W/tests/unit/daily-window.test.tsx`, `W/tests/unit/settings-store.test.ts`, `W/tests/unit/app.test.tsx`, `W/tests/e2e/fixture/build_fixture.py`, `R/server/tests/test_validation_settings.py`, `R/server/tests/test_app.py`, `R/server/tests/test_integration_gmat.py`
- Modify: `R/README.md` (settings section: new field, default off)

**Interfaces:**
- Produces (server): `Settings.online_imagery.enabled: bool` (default `False`); `GET /api/settings` includes `"online_imagery":{"enabled":false}`.
- Produces (web): `interface OnlineImagerySettings { enabled: boolean }`; `Settings.online_imagery: OnlineImagerySettings`.

- [ ] **Step 1: Failing server tests** in `test_validation_settings.py`:
  - `test_settings_default_has_online_imagery_off`: `GET /api/settings` on an empty data dir → `body["online_imagery"] == {"enabled": False}`.
  - `test_old_settings_file_without_online_imagery_loads_off`: write the old two-key document (daily enabled false) → GET → `online_imagery.enabled is False`, `daily` unchanged, file bytes unchanged.
  - `test_put_requires_online_imagery`: PUT the old two-key document → 422, `field == "online_imagery"`.
  - `test_put_online_imagery_strict_bool`: PUT with `"enabled": "true"` → 422 `field == "online_imagery.enabled"`; with `true` → 200 and the file contains `"online_imagery": {"enabled": true}`.
- [ ] **Step 2:** `cd R/server && .venv/bin/python -m pytest tests/test_validation_settings.py -q` → the 4 new tests FAIL.
- [ ] **Step 3:** Implement in `settings.py` following the `Daily`/`DailyIn` pattern (strict model, `extra="ignore"` for load, `extra="forbid"` for PUT, `missing_field` reports `online_imagery` / `online_imagery.enabled`). Update every server test/fixture that asserts the full document.
- [ ] **Step 4:** Server suite green: `.venv/bin/python -W error -m pytest -q`.
- [ ] **Step 5: Failing web tests:** `settings-store.test.ts` asserts the PUT body includes `online_imagery`; `daily-window.test.tsx` `keeps online_imagery from the loaded settings on save` (loaded `{enabled:true}` → PUT body has `{enabled:true}`).
- [ ] **Step 6:** Implement web types + Daily window; `npm run gen:api` then `npm run gen:api:check`; `npm test` and `npm run typecheck` green. Update `build_fixture.py` settings to include `"online_imagery":{"enabled":false}`.
- [ ] **Step 7:** README settings section; commit `feat(gnss-studio): online_imagery switch in settings (default off)`.

---

### Task 2: Server imagery catalog, tile proxy, limits and cache

**Files:**
- Create: `S/imagery.py` (catalog, token validation, `TileFetcher`, `TileCache`)
- Create: `S/routes/imagery.py`; Modify: `S/app.py` (import + `include_router(prefix="/api")`, construct one `TileFetcher` on `app.state.imagery` with the default opener)
- Create: `R/server/tests/test_imagery.py`
- Modify: `R/README.md` (online imagery: what is sent, cache location/size, limits)

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Layer: id: str; title: str; period: Literal["static","daily","10min"]; tms: str; max_level: int; ext: Literal["jpg","png"]; credit: str`
  - `CATALOG: tuple[Layer, ...]` (exact table in Global Constraints) and `layer_by_id(id: str) -> Layer | None` (exact, case-sensitive)
  - `valid_time(layer: Layer, time: str) -> bool` (full-match regex per period: static `default`; daily `\d{4}-\d{2}-\d{2}` and a real date; 10min `\d{4}-\d{2}-\d{2}T\d{2}:[0-5]0:00Z` and a real datetime)
  - `upstream_url(layer, time, z, y, x) -> str` (Global Constraints template)
  - `class TileFetcher(data_dir: Path, opener=urllib.request.urlopen, now=time.monotonic, logger=None)` with `get(layer, time, z, y, x) -> tuple[bytes, str]` (bytes, media type) raising `ApiError` with codes `IMAGERY_NOT_AVAILABLE` (404), `IMAGERY_FETCH_FAILED` (502), `IMAGERY_BUSY` (503), `IMAGERY_PAUSED` (503, `detail` = ISO UTC time when fetching resumes)
  - Routes: `GET /api/imagery/layers` → `{"enabled": bool, "layers": [{"id","title","period","max_level","format","credit"}]}`; `GET /api/imagery/tiles/{layer}/{time}/{z}/{y}/{x}` → `Response(bytes, media_type, headers={"X-Content-Type-Options":"nosniff","Cache-Control":"private, max-age=86400"})`
- Consumes: `settings.load(data_dir, logger).online_imagery.enabled` (Task 1), `ApiError` (`S/errors.py`), `write_atomic` (`S/store.py`).

Check order in the tile route (spec §4.2): switch off → 403 `IMAGERY_DISABLED` "ภาพออนไลน์ปิดอยู่ เปิดได้ที่ View → Globe Manager"; unknown layer → 404 `IMAGERY_UNKNOWN_LAYER` "ไม่รู้จักชั้นภาพนี้"; bad time → 422 field `time`; z/x/y not decimal ints in range → 422 field `z`/`x`/`y` (declare them as `str` path params and parse with `^\d{1,3}$` so FastAPI's own int coercion cannot accept `+1` or ` 1`). Thai texts: `IMAGERY_NOT_AVAILABLE` "ไม่มีภาพของชั้นนี้ ณ เวลานี้", `IMAGERY_FETCH_FAILED` "ดึงภาพจาก NASA GIBS ไม่สำเร็จ", `IMAGERY_BUSY` "มีคำขอภาพค้างอยู่มาก ลองใหม่อีกครั้ง", `IMAGERY_PAUSED` "หยุดดึงภาพจาก NASA GIBS ชั่วคราว".

Fetch rules: upstream 400/404 → not-available memo; 403/429 → pause 15 min (log once); `URLError`/timeout/5xx → failure counter (20 → pause 5 min), success resets; redirects: use an opener built with a redirect handler that refuses any redirect (treat as fetch failure); read at most 2 MB + 1 byte (over → 502); magic bytes JPEG `FF D8 FF` / PNG `89 50 4E 47 0D 0A 1A 0A` must match the layer ext (else 502, nothing cached). Cache path `<data>/imagery/tiles/<id>/<time with ':' replaced by '-'>/<z>/<y>/<x>.<ext>`; resolve and assert it stays under `<data>/imagery/tiles`; write with `write_atomic`; hit → `os.utime` touch; size tracked in memory after one initial scan; over 2 GB → delete oldest-mtime files down to 90 %.

- [ ] **Step 1: Failing tests** in `test_imagery.py` (fake opener records calls; returns objects with `.status`, `.read(n)`, or raises `HTTPError`/`URLError`; `now` injectable):
  - `test_layers_lists_catalog_in_order_and_enabled_flag` (8 ids in table order; `enabled` mirrors settings)
  - `test_tile_disabled_returns_403_without_fetch` and `test_tile_disabled_even_when_cached`
  - `test_unknown_layer_404`, `test_layer_id_case_sensitive`
  - parametrized `test_bad_time_422` over `["2026-11-11T00:05:00Z" for 10min, "2026-11-11" for 10min, "2026-02-30" daily, "2026-11-11x", "default" for daily, "2026-11-11" for static]`
  - parametrized `test_bad_tile_coords_422` over z=`-1`, z=max+1, `+1`, `01x`, x=2**z, y=2**z, `%2e%2e`
  - `test_upstream_url_exact` (VIIRS NOAA-20, `2026-11-11`, 3/2/5 → exact string from the template with `GoogleMapsCompatible_Level9` and `.jpg`)
  - `test_fetch_then_cache_hit_no_second_fetch` (1 opener call; file exists under `imagery/tiles/...`; second GET identical bytes, same media type, headers `nosniff` + `private, max-age=86400`)
  - `test_upstream_404_memoized` (two GETs → one opener call → both 404 `IMAGERY_NOT_AVAILABLE`; after `now` + 3601 s → second call)
  - `test_upstream_403_pauses_15_min` (403 → next request 503 `IMAGERY_PAUSED` with no opener call; at +901 s → fetches again; cached tiles still served while paused)
  - `test_20_consecutive_failures_pause_5_min` and `test_success_resets_failure_count`
  - `test_html_body_rejected_not_cached`, `test_png_for_jpg_layer_rejected`, `test_body_over_2mb_rejected`
  - `test_redirect_refused`
  - `test_concurrency_limit_busy` (opener blocks on an Event; 4 in flight; 5th with queue wait patched to 0.05 s → 503 `IMAGERY_BUSY`)
  - `test_cache_eviction_to_90_percent` (cap patched small; oldest mtime removed first)
  - `test_no_real_network` module-level autouse fixture patching `urllib.request.urlopen` / `OpenerDirector.open` to raise, proving only the fake opener is used.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `.venv/bin/python -W error -m pytest -q` green; `npm run gen:api` in W (new routes appear in openapi) + `gen:api:check`.
- [ ] **Step 5:** README; commit `feat(gnss-studio): NASA GIBS tile proxy with cache and fetch limits`.

---

### Task 3: Web imagery core (tokens, selection, layer manager on 3D viewers)

**Files:**
- Create: `W/src/cesium/imageryTime.ts` (pure), `W/src/stores/imagery.ts`, `W/src/cesium/imageryLayers.ts`
- Modify: `W/src/layout/workbook.ts` (+ `globe` field, tolerant), `W/src/stores/layout.ts` (`toWorkbook`/`fromWorkbook`/default carry `globe`)
- Modify: `W/src/windows/Graphics3D/scene3d.ts` (attach the manager in `mount()` for both 3D windows and Sensor View; detach in `destroy`)
- Tests: `W/tests/unit/imagery-time.test.ts`, `imagery-store.test.ts`, `imagery-layers.test.ts`, `workbook.test.ts` (globe round trip / tolerance)

**Interfaces:**
- Produces:
  - `type ImageryPeriod = "static" | "daily" | "10min"`; `interface ImageryLayerInfo { id: string; title: string; period: ImageryPeriod; max_level: number; format: "jpg" | "png"; credit: string }`
  - `timeToken(period: ImageryPeriod, t: Date): string` and `tokenLabel(period, token): string` (HUD text: static → "", daily → token, 10min → `YYYY-MM-DD HH:MM UTC`)
  - `useImagery` zustand store: `{ enabled: boolean; layers: ImageryLayerInfo[]; loaded: boolean; load(): Promise<void>; setEnabled(on: boolean): Promise<void> }` — `load` = `GET /api/imagery/layers`; `setEnabled` = `GET /api/settings`, then `PUT /api/settings` with the whole document and `online_imagery.enabled = on`, then sets `enabled`. Loaded once at app start (App.tsx) after scenario-independent startup; failures report a Thai warning, keep `enabled=false`.
  - Workbook: `globe?: { layers: Record<string, { show: boolean; translucency: number }> }` (translucency 0–100 integer; invalid entries dropped, unknown ids kept but ignored); layout store `globe` state + `setGlobeLayer(id, patch)`. Default when nothing saved and switch first turned on: Blue Marble + VIIRS NOAA-20 shown, others hidden (`DEFAULT_GLOBE`).
  - `attachImageryLayers(viewer: Viewer): () => void` in `imageryLayers.ts`: subscribes to `useImagery`, layout `globe`, and `useTime`; keeps, per catalog layer that is shown and only while `enabled`, one `ImageryLayer` (own `UrlTemplateImageryProvider` per viewer: url `/api/imagery/tiles/{id}/{token}/{z}/{y}/{x}`, `tilingScheme: new WebMercatorTilingScheme()`, `maximumLevel: max_level`, `credit`), inserted above index 0 in catalog order and below the lat/lon grid layer; alpha = `1 - translucency/100`; token change → replace that layer at the same index, at most once per 1000 ms per viewer (trailing update guaranteed); calls `scene.requestRender()` after changes; provider `errorEvent` handled so 404 tiles never surface Cesium errors (set `error.retry = false`), and counts requested/failed tiles per (layer, token).
  - `imageryStatus(viewer): { topLayer: { id: string; title: string; label: string; missingRatio: number } | null }` for the HUD (top = last shown layer in catalog order).
- Consumes: Task 2 routes; `useTime` (`W/src/stores/time.ts`); viewer creation in `scene3d.ts` `mount()`; `imageryLayers.get(0)` remains Natural Earth II (`applyProps` uses index 0).

- [ ] **Step 1: Failing tests:**
  - `imagery-time.test.ts`: daily token uses UTC date at `2026-11-11T23:59:59Z` → `2026-11-11` and `2026-11-12T00:00:00Z` → `2026-11-12` under `TZ=America/New_York`; 10min floors `03:19:59Z` → `2026-11-11T03:10:00Z`; static → `default`; `tokenLabel` outputs.
  - `imagery-layers.test.ts` (mock Cesium like `viewer.test.ts`): disabled → no GIBS layer added; enabled + 2 shown → 2 layers at indices 1,2 in catalog order, grid stays last; translucency 25 → alpha 0.75; time change within same token → no replacement; token change twice within 1 s → exactly one replacement now + one trailing; two viewers → distinct provider instances; detach removes layers and unsubscribes; url template exact.
  - `imagery-store.test.ts`: `setEnabled(true)` sends GET then PUT whole doc with `online_imagery.enabled true` (stubFetch); failure keeps `enabled` false and reports a Thai warning.
  - `workbook.test.ts`: `globe` round trip; absent `globe` valid; bad translucency entries dropped; unknown id kept.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npm test`, `npm run typecheck` green (stub the new startup GET in tests that use `stubFetch` for App).
- [ ] **Step 5:** commit `feat(gnss-studio): GIBS imagery layers on 3D globes, time-tracked`.

---

### Task 4: Globe Manager window and consent

**Files:**
- Create: `W/src/windows/GlobeManager/GlobeManager.tsx` (+ `registerGlobeManagerPanel()`)
- Modify: `W/src/layout/panels.ts` (`PANEL_KINDS` + `BASE` entry: floating, `persist:false`, `scenarioBound:false`), `W/src/App.tsx` (register panel, load imagery store), `W/src/commands.ts` (`"view.globeManager"`), `W/src/chrome/coreCommands.ts` (command opens panel), `W/src/chrome/menus.ts` (View menu after `new2d` group: `Globe Manager...`), `W/src/labels/labels.ts` (`menu.view.globeManager`, `window.globeManager`, `field.onlineImagery`, `field.show`, `field.translucency` reuse if present), `W/src/labels/messages.th.ts` (`globe.*` keys), `W/tests/unit/labels.test.ts` (allow `globe` prefix; consent text must name `gibs.earthdata.nasa.gov`), `R/docs/2026-11-11-gnss-studio-stk-reference.md` (append `## H. Globe Manager` only with terms verified on help.agi.com; reading STK help pages is allowed, downloading data is not)
- Tests: `W/tests/unit/globe-manager.test.tsx`; update `commands.test.ts`, `workbook.test.ts`/`layout.test.tsx`/`insert.test.tsx` kind lists as needed

**Interfaces:**
- Consumes: `useImagery` (`enabled`, `layers`, `setEnabled`), layout `globe` + `setGlobeLayer`, `DEFAULT_GLOBE` (Task 3).
- Produces: panel kind `"globeManager"`, command `"view.globeManager"`.

UI (spec §5.1): checkbox "Online imagery (NASA GIBS)"; turning on opens a Thai confirm dialog (reuse the app's existing confirm dialog component used by `confirm.deleteWithSensors`) whose text names `gibs.earthdata.nasa.gov`, lists what is sent (layer name, time, tile coordinates only), the cache location `data/imagery` and its 2 GB cap, and that it can be switched off any time; Confirm → `setEnabled(true)`; first enable with no saved `globe` → apply `DEFAULT_GLOBE`; Cancel → nothing. Turning off → `setEnabled(false)` without dialog. Layer list: first row "Natural Earth II" (offline, always on, controls disabled); then the 8 catalog layers with Show checkbox and % Translucency number input 0–100 (integers; invalid input reverts); all GIBS rows disabled with a Thai hint while the switch is off.

- [ ] **Step 1: Failing tests** `globe-manager.test.tsx`: renders 9 rows in order; switch off → GIBS rows disabled; click switch → dialog with `gibs.earthdata.nasa.gov`; Cancel → no PUT; Confirm → one PUT whole doc with enabled true; first enable applies DEFAULT_GLOBE; uncheck switch → PUT enabled false, no dialog; translucency 150 → reverts; Show toggles `setGlobeLayer`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** unit + typecheck green. **Step 5:** commit `feat(gnss-studio): Globe Manager window with online imagery consent`.

---

### Task 5: Sensor View Camera mode and zoom

**Files:**
- Modify: `W/src/windows/SensorView/registry.ts` (`SensorViewParams` + `display`, `zoom`; `sensorViewParams` tolerant; `SensorHud` + `fovDeg`, `zoom`, `imagery`), `W/src/windows/SensorView/SensorView.tsx` (Display group, Zoom In/Out buttons + "×n", HUD lines, no cone ring in camera mode, wheel zoom), `W/src/windows/SensorView/commands.ts` (`openSensorView` passes `display:"camera", zoom:1` for new windows), `W/src/windows/Graphics3D/scene3d.ts` (`viewFromSensor` view kind carries display + zoom; camera mode hides overlays of this viewer only; `updateSensorCamera` divides fov by zoom), `W/src/cesium/sensorGeometry.ts` (`sensorViewShortFovDeg(α, zoom = 1)`), `W/src/labels/labels.ts` (`sensorView.display`, `.camera`, `.sensor`, `toolbar.zoomIn`/`zoomOut` — `stk` only if verbatim in the reference), `W/src/labels/messages.th.ts` (`sensorView.hudFov`, `sensorView.hudImagery`, `sensorView.hudImageryOffline`, `sensorView.hudImageryMissing`, `sensorView.hintGlobeManager`), `W/src/theme.css`, `W/src/cesium/testHooks.ts` (`sensorViewCamera` also returns `display`, `zoom`, and `visibleEntityCount` for that viewer)
- Tests: `W/tests/unit/sensor-view.test.tsx`, `sensor-view-scene.test.ts`, `sensor-geometry.test.ts`

**Interfaces:**
- Consumes: `imageryStatus(viewer)` (Task 3) for the HUD imagery line; existing `sensorViewPose`, `placeSensorCamera`, `lockCamera`, `useShiftWheelSteps`.
- Produces: `SensorViewParams { path: string; up: "north"|"velocity"; display: "camera"|"sensor"; zoom: 1|2|4|8|16|32|64|128 }`; `ZOOM_STEPS` const; `nextZoom(z, dir: 1|-1)` clamps at ends.

Camera mode rule: in this viewer only, set `show=false` on every data source, on `viewer.entities`, and on the sensor/inertial primitive collections this scene owns, remembering nothing — on switching back to Sensor call the existing `restyle()` so visibility is recomputed from the scenario doc (this restores user-hidden objects correctly). Keep globe, atmosphere, skybox, lighting. Wheel without Shift over the stage = `nextZoom` ±1 (deltaY < 0 → in); Shift+wheel unchanged.

- [ ] **Step 1: Failing tests:** params parser (`display` missing/invalid → camera; `zoom` 3, 0, "8", 256 → 1; 8 → 8); `sensorViewShortFovDeg(13.88+0.5, 8)` = `min(2*14.38*1.05,120)/8`; scene: camera hides all in its own viewer, main 3D viewer untouched (two scenes), back to sensor restores including a user-hidden satellite staying hidden; HUD shows `FOV` line and imagery offline line; no `.sensor-view-cone` in camera mode; Zoom In ×3 → params zoom 8, label "×8"; wheel without shift zooms, with shift does not; old e2e expectations for sensor mode unchanged when `display:"sensor"`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** unit + typecheck green. **Step 5:** commit `feat(gnss-studio): Sensor View camera mode and zoom`.

---

### Task 6: E2E, README and final docs

**Files:**
- Create: `W/tests/e2e/imagery.spec.ts`; Modify: `W/tests/e2e/sensor.spec.ts` only if Camera default changes its assertions (keep its geometric assertions; switch to `Sensor` display where it inspects own-sensor graphics)
- Modify: `R/README.md` (Sensor View §9.9: Camera/Sensor, zoom, HUD; new "ภาพถ่ายจริง (NASA GIBS)" section: how to enable, what is sent, cache path and size, limits, credits, that forecasts have no real imagery except Blue Marble, and that e2e never goes online)

**Interfaces:** consumes everything above; e2e server keeps `online_imagery.enabled=false` (Task 1 fixture).

- [ ] **Step 1:** `imagery.spec.ts`: (a) open Sensor View of a satellite → `display` camera, `visibleEntityCount === 0`, Zoom In twice → short-side fov = 1/4 of zoom-1 value (±1 %), camera-to-satellite distance < 1 m; (b) View → Globe Manager → 9 rows; tick Online imagery → dialog shows `gibs.earthdata.nasa.gov` → Cancel → `GET /api/settings` still `online_imagery.enabled false`; (c) no request to `/api/imagery/tiles` happened (record requests). The shared request guard still applies.
- [ ] **Step 2:** `npm run e2e` → all pass (perf may stay skipped).
- [ ] **Step 3:** README; full suites: web unit, typecheck, e2e, server (`-W error`), engine (`cd R && python3 -m unittest discover -s tests`). Commit `test(gnss-studio): e2e for camera mode and Globe Manager; docs`.

---

## Decisions (pre-made)

- D1 GetCapabilities is not read at runtime (spec §2); availability comes from per-tile 4xx.
- D2 One selection for all 3D globes, saved in the workbook; 2D unchanged.
- D3 `UrlTemplateImageryProvider` swap per token (not WMTS `times`+`clock`): our clock is bound manually and `requestRenderMode` is on; explicit swap is testable and throttled.
- D4 B0 (live GIBS verification) is done by the controller after all tasks, only with user consent; catalog values are corrected in one table if wrong.
