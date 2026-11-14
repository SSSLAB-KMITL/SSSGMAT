# GNSS Studio Hi-res Imagery (ข1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Sentinel-2 cloudless (EOX, server-proxied), OpenStreetMap (browser-direct) and Cesium ion (browser-direct, exclusive) imagery sources, each behind its own off-by-default switch + Thai consent, and extend Sensor View zoom to ×8192 so the ground below a satellite can be seen down to street level.

**Architecture:** Server generalizes the GIBS proxy into per-source catalogs (gibs, eox) with per-source switches, limits and pause state; `settings.json` `online_imagery` gains `eox`/`osm`/`ion`. Web layer manager gains provider kinds (proxy, osm, ion), an ion-exclusive rule, and Globe Manager groups per source with consent dialogs and an ion token/asset picker.

**Tech Stack:** FastAPI/pydantic strict, stdlib urllib; React/TS, zustand, CesiumJS 1.147 (`UrlTemplateImageryProvider`, `IonImageryProvider`), vitest, Playwright.

**Spec:** `api-interop/gnss-predict/docs/2026-11-14-gnss-studio-hires-imagery-design.md` ("hires §n"), building on `2026-11-14-gnss-studio-imagery-design.md`. R = `api-interop/gnss-predict`, S = `R/server/gnss_studio_server`, W = `R/web`.

## Global Constraints

- Branch `feature/gnss-studio-imagery`, worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery`; `git branch --show-current` before every commit; never push/merge; never bare `git stash`.
- Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, no other co-author line.
- No test and no implementer contacts any external host (gibs, eox, openstreetmap, cesium.com APIs). Reading documentation web pages (cesium.com/learn, community.cesium.com, operations.osmfoundation.org, s2maps.eu) is allowed only to verify preset names/IDs/terms; never call `api.cesium.com` or tile hosts.
- Settings document after this plan: `{"daily":{...},"cesium_ion_token":"","online_imagery":{"enabled":false,"eox":false,"osm":false,"ion":false}}`. Missing new keys load as false; PUT requires all keys (strict bool).
- EOX: template `https://tiles.maps.eox.at/wmts/1.0.0/{layer}/default/g/{z}/{y}/{x}.jpg`; one catalog row `s2cloudless-2024_3857`, title `Sentinel-2 cloudless 2024`, period static, max_level 15, ext jpg, credit `Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)`; concurrency 2; per-source pause/failure state.
- OSM: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, maximumLevel 19, credit `© OpenStreetMap contributors` shown on screen; no prefetch; app must not set a restrictive Referrer-Policy.
- ion: `IonImageryProvider.fromAssetId(id, { accessToken })`, never set `Ion.defaultAccessToken` globally; ion shown ⇒ every other imagery layer hidden in every viewer (Natural Earth II alpha 0) until ion is hidden.
- Draw order: Natural Earth II (0) → GIBS (catalog order) → EOX → OSM → grid on top; ion alone when shown.
- Sensor View `ZOOM_STEPS` = [1,2,4,…,8192]; invalid persisted zoom → 1.
- UI: STK English names via `stk()` only if verbatim in the STK reference doc, else `ours()`; all messages Thai via `msg()`.

## Review Focus

1. Any source switch off ⇒ zero requests to that host (server proxy and browser); turning GIBS on must not enable EOX/OSM/ion and vice versa.
2. ion exclusivity holds across all viewers, survives time-token swaps and Globe Manager edits, and fully restores previous layers and base alpha when ion is turned off.
3. Settings round trip: Daily window and Globe Manager both keep all four flags and the token; an old file (only `enabled`) loads with the three new flags false.
4. Consent texts name the right host and say whether the browser connects directly; the ion token is never logged, never put in a URL query by our code, and never sent to our own server except via the existing settings PUT.
5. Zoom ×8192 keeps boresight < 0.01° and HUD footprint width correct; wheel accumulator still bounded.

---

### Task 1: Server — per-source settings and EOX proxy

**Files:** Modify `S/settings.py` (OnlineImagery + `eox`,`osm`,`ion`), `S/imagery.py` (Source abstraction: per-source template, catalog rows with `source`, switch accessor, concurrency, pause/failure state), `S/routes/imagery.py` (layers payload `sources`, per-source 403 text), `S/app.py` wiring; tests `R/server/tests/test_imagery.py`, `test_validation_settings.py` (+ any test asserting the settings document), `W/tests/e2e/fixture/build_fixture.py`; regenerate `W/src/api/openapi.json`/`types.gen.ts`; web types `W/src/stores/settings.ts` + Daily window echo test if the type changes.

**Interfaces:** Produces `Layer.source: Literal["gibs","eox"]`; `GET /api/imagery/layers` → `{"enabled": bool, "sources": {"gibs","eox","osm","ion": bool}, "layers": [{..., "source"}]}`; 403 `IMAGERY_DISABLED` texts: GIBS unchanged, EOX `"ภาพ Sentinel-2 (EOX) ปิดอยู่ เปิดได้ที่ View → Globe Manager"`.

- [ ] Failing tests: old settings file → `eox/osm/ion` false; PUT missing `online_imagery.eox` → 422 field `online_imagery.eox`; strict bool; EOX tile with `eox` off → 403 even if GIBS on (opener not called); GIBS tile with GIBS off but EOX on → 403; exact EOX upstream URL for z=3,y=2,x=5; EOX pause after 403 doesn't pause GIBS; EOX concurrency 2 (3rd waits/503 with short wait); EOX tile cached (static, settled); layers payload exact.
- [ ] Implement; server suite `-W error` green; `npm run gen:api` + `gen:api:check`; web `npm test`/`typecheck` green.
- [ ] Commit `feat(gnss-studio): per-source imagery switches and Sentinel-2 cloudless proxy`.

### Task 2: Web — provider kinds, OSM, ion, exclusivity

**Files:** `W/src/stores/imagery.ts` (sources flags, `setSource(source, on)` GET+PUT whole doc), `W/src/cesium/imageryLayers.ts` (kinds: proxy / osm / ion; ion exclusive rule; credits on screen), `W/src/layout/workbook.ts` + `W/src/stores/layout.ts` (globe selection: add `osm` row and `ion: { assetId: number | null }`, tolerant), new `W/src/cesium/ionAssets.ts` (presets verified from Cesium docs with source URLs in comments; unverifiable → omit preset, keep custom Asset ID), check `W/index.html` / server headers for Referrer-Policy; tests `imagery-layers.test.ts`, `imagery-store.test.ts`, `workbook.test.ts`, new `ion-assets.test.ts`.

**Interfaces:** Produces `ImagerySourceId = "gibs"|"eox"|"osm"|"ion"`; `useImagery.sources: Record<ImagerySourceId, boolean>`, `setSource(id, on)`; `ION_PRESETS: readonly {id: number; title: string; verifiedFrom: string}[]`; `imageryStatus(viewer).topLayer` includes `source`.

- [ ] Failing tests: osm off → no OSM provider; osm on + shown → UrlTemplate with exact URL/maxLevel 19, credit on screen, inserted above EOX/GIBS below grid; ion shown with token → IonImageryProvider.fromAssetId called with `{accessToken}` and all other layers hidden + base alpha 0 in every viewer; ion hidden → previous visibility and base alpha restored; ion with empty token → no provider, Thai warning; ion provider rejection (401) → layer removed + Thai message; token never appears in any URL we build; `setSource` PUTs whole doc keeping token and other flags.
- [ ] Implement; `npm test`, `npm run typecheck` green. Commit `feat(gnss-studio): OpenStreetMap and Cesium ion imagery layers (ion exclusive)`.

### Task 3: Web — Globe Manager groups, consent, ion token/asset

**Files:** `W/src/windows/GlobeManager/GlobeManager.tsx`, `W/src/labels/labels.ts`, `W/src/labels/messages.th.ts`, `W/tests/unit/globe-manager.test.tsx`, `labels.test.ts` (consent hosts per source).

- [ ] Failing tests: 4 groups in order GIBS, EOX, OSM, ion; each switch → its own consent (texts contain `tiles.maps.eox.at` / `tile.openstreetmap.org` / `api.cesium.com`; OSM + ion texts say the browser connects directly and mention IP/User-Agent/Referer; ion mentions the token is sent); Cancel → no request; turning one source on never changes other flags; ion token input (password type) saves via whole-doc PUT and is never rendered as plain text; ion asset radio (presets + custom Asset ID integer > 0) updates layout globe; rows of other sources show the Thai "hidden while Cesium ion is shown" note when ion is shown.
- [ ] Implement; tests/typecheck green. Commit `feat(gnss-studio): Globe Manager sources with consent and Cesium ion settings`.

### Task 4: Sensor View zoom to ×8192 and footprint HUD

**Files:** `W/src/windows/SensorView/registry.ts` (`ZOOM_STEPS`), `SensorView.tsx` (HUD footprint width line, "finest level" note), `W/src/cesium/sensorGeometry.ts` (footprint width helper), messages; tests `sensor-view.test.tsx`, `sensor-geometry.test.ts`, `sensor-view-scene.test.ts`.

- [ ] Failing tests: zoom parser accepts 8192, rejects 16384/3 → 1; `nextZoom` clamps at 8192; footprint width at GPS altitude (20,200 km, α 14.4°, zoom 1024 ≈ 10 km ±5 %, zoom 8192 ≈ 1.3 km ±5 %), HUD shows km above 1 km else m; boresight unchanged at ×8192 (1e-9); "finest level" note when needed level > top layer max_level (needed level = ceil(log2(2πR / (footprint_m / screenWidthPx · 256))) — put in a pure helper and test).
- [ ] Implement; tests/typecheck green. Commit `feat(gnss-studio): Sensor View zoom to x8192 with ground width`.

### Task 5: E2E, README, decisions

**Files:** `W/tests/e2e/imagery.spec.ts` (Globe Manager 4 groups; each consent Cancel keeps settings; zoom to ×8192 via buttons; no request to any external host and none to `/api/imagery/tiles`), `R/README.md` (sources table, consent, what is sent per source, OSM policy obligations, ion exclusivity and token, zoom ×8192), `R/docs/2026-11-14-gnss-studio-imagery-decisions.md` (append ข1.5 section).

- [ ] Run full suites: web unit, typecheck, gen:api:check, e2e, server `-W error`, engine. Commit `test(gnss-studio): e2e and docs for hi-res imagery sources`.
