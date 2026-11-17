# GNSS Studio ข2: Imaging Satellites as Scene Objects — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax.

**Goal:** The user inserts the 8 imaging satellites (X01–X08) from the Satellite Catalog like GNSS satellites, with an automatic primary-camera Sensor (Simple Conic or Rectangular). They propagate, get Access/AER to Facilities, stay out of DOP and Validation, render in 3D/2D with models, and a right-click **Show Imagery** opens that satellite's GIBS layer (through the existing consent) and the primary sensor's Sensor View.

**Architecture:** One engine preset table (`gnss_predict/imaging.py`) is the single source for codes, NORADs, names, CelesTrak groups, camera, sensor values and GIBS layer. The engine builds an imaging catalog from the snapshot's `weather`/`science`/`visual` files, matched by NORAD only, and merges it after the unchanged GNSS catalog. Imaging files enter a scene's hash only when the scene holds an imaging NORAD. DOP and Validation filter on the PRN letter. The server exposes `category`, a display name, a static presets route and `Rectangular` sensors, and inserts the primary sensors atomically. The web adds pure rectangular-pyramid geometry next to the cone geometry, so `graphics.ts` and `overlay2d.ts` need no change. It also adds an Imaging filter, a Show Imagery command and a shared GIBS consent helper.

**Tech Stack:** Python ≥ 3.10 stdlib + unittest (engine), FastAPI + pydantic + pytest (server), React 18 + TypeScript + Zustand + CesiumJS (web), Vitest + jsdom, Playwright (Chromium).

**Spec:** `docs/2026-11-15-gnss-studio-imaging-satellites-design.md` ("spec §n"). Also read `docs/2026-11-15-imaging-satellites-research.md` §2, §6 ("research §n") and `docs/2026-11-15-stk-terms-rectangular-sensor.md` ("STK terms §n"). R = `api-interop/gnss-predict`, W = `R/web`, S = `R/server`. All paths are from R.

## Global Constraints

- Branch `feature/gnss-studio-imagery`, worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery`. Never push, never merge, never switch branches in the main checkout.
- Run `git branch --show-current` before every commit; anything other than `feature/gnss-studio-imagery` means do not commit.
- Never use bare `git stash`. Commit with `git commit -m "<msg>" -- <paths>` listing only this task's files; never `git add -A` / `git commit -a`.
- Commit trailer is exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no other co-author line.
- Shared web files (`messages.th.ts`, `labels.ts`, `commands.ts`, `panels.ts`, `App.tsx`, `menus.ts`): stage only your own hunks. `git add -p` is interactive and unavailable here: if `git diff <file>` shows hunks you did not write, write a patch of your hunks and `git apply --cached` it.
- Don't touch files another agent is editing (`W/src/cesium/accessHighlight.ts`, `graphics.ts`, `W/src/windows/graphics/sceneSource.ts`, `W/src/windows/TimelineView/*`, and the docker files now dirty in the worktree). This plan needs none of them; re-check `git status` before each task.
- No network in tests or from implementers. Never call the real CelesTrak fetch, `/api/orbits/fetch`, `/api/daily/run` or `/api/scenarios/*/validate`. Tests use the OMM fixtures in `tests/fixtures/studio/imaging/` (spec §3.3, §1 criterion 6).
- Downloaded data is untrusted: anything that reads `data/` runs with `python3 -I`. Never touch `R/data` in the main checkout (`/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data`), not even to copy fixture values; the imaging OMM fixtures are hand-written.
- UI labels go through `stk(text, "G")` only when verbatim in `docs/2026-11-11-gnss-studio-stk-reference.md` under the delimiter rule of `W/tests/unit/labels.test.ts`, else `ours(text)`. Messages are Thai via `msg()`. Code comments stay Thai like the existing code.
- After any route or schema change run `cd web && npm run gen:api`; never hand-edit `openapi.json`, `types.gen.ts`, `enums.gen.ts`.
- Spec values (verbatim):
  - Codes and NORADs: X01 Himawari-9 41836, X02 GOES-18 51850, X03 GOES-19 60133, X04 Terra 25994, X05 Aqua 27424, X06 Suomi NPP 37849, X07 NOAA-20 43013, X08 NOAA-21 54234.
  - `SYSTEM_LETTERS` stays `GREC`; `IMAGING_LETTER = "X"`; fetch default systems stay `GREC`.
  - Age flags: LEO uses `AGE_OK_DAYS` 2.0 / `AGE_SHOWN_MAX_DAYS` 7.0. GEO (mean motion < 1.1 rev/day) is stale after 7 days and too_old (hidden) after 14 days.
  - No `no_broadcast` / `unhealthy` / `prn_changed` / `name_mismatch` flags for X.
  - Sensors: GEO Simple Conic 8.7°; MODIS Rectangular 55.0° × 0.41°; VIIRS Rectangular 56.28° × 0.42° (axis mapping in Ruling g). Rectangular angles 0 < a ≤ 89°.
  - Sensor View short-side FOV = `min(2α × 1.05, 120°)`; aspect unchanged.
  - Validate: skip X entirely, no `unverified` rows, one Thai line `ข้ามดาวถ่ายภาพ n ดวง (ไม่มีข้อมูลอ้างอิง)`.
  - GIBS layers: X01 `Himawari_AHI_Band3_Red_Visible_1km`, X02 `GOES-West_ABI_GeoColor`, X03 `GOES-East_ABI_GeoColor`, X04 `MODIS_Terra_CorrectedReflectance_TrueColor`, X05 `MODIS_Aqua_CorrectedReflectance_TrueColor`, X06 `VIIRS_SNPP_CorrectedReflectance_TrueColor`, X07 `VIIRS_NOAA20_CorrectedReflectance_TrueColor`, X08 `VIIRS_NOAA21_CorrectedReflectance_TrueColor`.
- Commands (from R):
  - engine: `python3 -m unittest tests.<module> -v`; whole suite `python3 -m unittest discover -s tests -v`.
  - server: `cd server && .venv/bin/python -m pytest -q -W error [tests/<file>]`.
  - web: `cd web && npx vitest run <file>`, `npm test`, `npm run typecheck`, `npm run gen:api:check`, e2e `npm run e2e`.

## Review Focus

1. **Rectangular axes swapped.** STK's standard Rectangular puts Horizontal Half Angle in the XZ plane (along-track) and Vertical Half Angle in the YZ plane (cross-track); the spec text says the opposite. A swapped implementation draws a 3,052 km strip *along* the track. Check: Task 6 `vertical edge midpoints are cross-track at ±13.723826°` and Task 5 `test_imaging_sensor_presets`.
2. **GNSS-only scenes change bytes.** `_files_sha256` must not add imaging files, `_plan` must not read them, `dop_series` must drop X, and the validation dict must gain no key. Check: Task 2 `test_gnss_only_hash_is_pinned` (literal recorded before the change) and Task 3 `test_dop_ignores_imaging_rows`.
3. **IPP/MF `None` breaks reading results.** `dataproviders._load_access` calls `float("")` on the empty IPP cells (`dataproviders.py:215-217`). One X satellite in a scene would turn that whole Facility bundle into `RESULT_CORRUPT` and break Access/AER/IPP reports. Check: Task 3 `test_access_tables_accept_empty_ipp` and the report `N/A` test.
4. **Show Imagery bypasses consent or goes online.** With GIBS off it must show the same Globe Manager confirm. Cancel must mean no `PUT /api/settings`, no layer change, no panel and no request to any host but `/api/`. Check: Task 7 `show imagery with GIBS off asks first; cancel does nothing`.
5. **Primary-sensor insert is not atomic or names collide.** Two MODIS satellites need `MODIS` and `MODIS_X05`, and a name clash must create nothing (409). Sensors must not join the created Constellation. Check: Task 5 `test_catalog_insert_primary_sensors_names_and_order`.

## Plan rulings

- Ruling (a), hash: `_files_sha256(snapshot_dir, systems, imaging_files=())` (`studio.py:265`) appends the given imaging file names. `_plan` (`studio.py:334`) passes `imaging.imaging_group_files(snapshot_dir)` only when the scene's NORADs intersect `IMAGING_NORADS`, and only then builds the imaging catalog. A GNSS-only scene therefore reads the same files and hashes the same dict as before, even when the snapshot holds `weather.json`. `_snapshot` (`studio.py:252`) is unchanged.
- Ruling (b), combined catalog: built by `imaging.scenario_catalog(snapshot_dir, period, systems, with_imaging)`. It returns the unchanged `build_catalog` result with the imaging satellites appended (sorted X01…X08) and with their unmapped entries and messages added. The engine calls it from `_plan`. The server calls it only from `templates.load_catalog` (`templates.py:152`, always `with_imaging=True`), which serves `GET /catalog` and `objects.scenario_catalog` (Insert). The thbk-gnss template keeps skipping X through its existing `SYSTEM_COLORS` check (`templates.py:170`).
- Ruling (c), IPP/MF `None`:
  - `AerRow.ipp_lat_deg`, `ipp_lon_deg` and `mf` become `float | None`; `aer_rows` (`analyze.py:37`) sets all three to `None` when `prn[0] == "X"`.
  - `_aer_csv_row` (`studio.py:134`) already writes `None` as an empty cell via `_fmt`.
  - `dataproviders._load_access` (`dataproviders.py:215-217`) parses those three cells with `_optional`.
  - IPP Data rows then carry `None`, which the report formatter already prints as `N/A` (.txt), an empty cell (.csv) and `null` (json) (access-reports P9).
  - The web `data/files.ts` `maybe()` and `cesium/ipp.ts` `usable()` already skip null IPP. `legacy_gps.csv` is GPS-only and unaffected.
- Ruling (d), STK terms:
  - "Rectangular" is in §G of the STK reference ("Complex Conic, Custom, EOIR, Half Power, Rectangular, SAR, …") and passes the delimiter rule, so it is `stk("Rectangular", "G")`.
  - "Vertical Half Angle" and "Horizontal Half Angle" are verified in STK terms §2 but are not in the STK reference doc, so they are `ours()`. Adding a §G row is a separate user decision; this round does not edit the reference.
  - "Imaging", "Add Primary Sensor" and "Show Imagery" are `ours()`.
- Ruling (e), Sensor View camera: no new camera code. `sensorViewPose` (`sensorDraw.ts:189`) and the HUD (`scene3d.ts:939`) take their half angle from a new `viewHalfAngleOf(sensor)`. That is `cone_half_angle` for Simple Conic and `max(vertical, horizontal)` for Rectangular, which equals the cross-track Vertical Half Angle for every preset (the spec's "cross-track" intent; Ruling g). Results: MODIS short FOV 115.5°, VIIRS 118.188°, GEO 8.7° gives 18.27°. Position, direction, up (North/Velocity) and aspect are unchanged. The Sensor-display circle (`SensorView.tsx:276`) is hidden for Rectangular, and the HUD cone line (`SensorView.tsx:295`) shows both half angles.
- Ruling (f), consent reuse: the confirm + `setSource` step of `GlobeManager.switchTo` (`GlobeManager.tsx:372-375`) moves to `W/src/windows/GlobeManager/consent.ts` as `enableSourceWithConsent(id)`, with the `SourceDef.consent` keys as `CONSENT_KEYS`. Globe Manager and Show Imagery both call it, so the dialog text and behaviour are identical.
- Ruling (g), axes (STK over spec): per STK terms §3.1 (standard Rectangular, "For Comm and Radar"):
  - **Horizontal Half Angle** = XZ plane = body ±X = along-track.
  - **Vertical Half Angle** = YZ plane = body ±Y = cross-track.
  - The spec (§4, §5.2) used the EOIR convention, so presets are stored as MODIS `vertical_half_angle` 55.0 / `horizontal_half_angle` 0.41 and VIIRS 56.28 / 0.42. The ground strips are exactly what the spec intends.
- Ruling (h), field names: the real schema is `SensorObj.definition = {type, cone_half_angle}` (`schema.py:201`), not `SensorObj.shape`. Rectangular uses `definition.type = "Rectangular"`, `definition.vertical_half_angle`, `definition.horizontal_half_angle` (degrees; no `_deg`, matching `cone_half_angle`).
- Ruling (i), sensor frame for general pointing: `sensorFrame(f, az, el)` rotates the body frame by Az about +Z, then by θ = 90° − El about the new +Y, so +Z_s = `boresightOf(f, az, el)`. Az 0 / El 90 gives exactly the body frame (STK `sn-orientation.htm`: the frame coincides). The presets all use Az 0 / El 90.
- Ruling (j), footprint surface: rectangle rays hit the same sphere (Re = 6371.0088 km, `hitEarth`/`horizonPoint` in `sensorGeometry.ts`) as Simple Conic and Swath, then go through `subSatellite` to geodetic. The spec's "WGS84 ellipsoid" would make the conic and rectangular footprints disagree.
- Ruling (k), drawing:
  - 3D draws the same parts as the cone: the ground ring (4 sides × 18 points) plus Radial Lines to the 4 corners. The cone has no translucent surface, so neither does the pyramid.
  - 2D draws the ring. `centralAngleRad` is `null` for Rectangular, so the circular Fill is not drawn (`overlay2d.ts:180`, unchanged).
- Ruling (l), primary-sensor names: the camera name (`AHI`/`ABI`/`MODIS`/`VIIRS`); if that is taken case-insensitively, `<camera>_<PRN>` (e.g. `MODIS_X05`); if that is also taken, 409 `NAME_EXISTS` and nothing is created.
- Ruling (m), Insert body and order:
  - The body key is `primary_sensors: bool`; it defaults to false on the server so old clients and GNSS inserts are unchanged.
  - The web sends `primary_sensors: true` only when the box is ticked and the selection includes an X row.
  - Created order is satellites, then the Constellation (satellites only), then sensors.
- Ruling (n), primary sensor for Show Imagery: the first Sensor child of the satellite in the tree. That is the same `firstSensorOf` (`SensorView/commands.ts:53`) the existing Sensor View command uses. With no sensor left, Show Imagery runs the existing satellite branch of Sensor View ("the view from the satellite as before": create `Sensor<n>` and open it).
- Ruling (o), menu: `object.showImagery` sits after `object.sensorView` in `SATELLITE_MENU` (`menus.ts:69`) and `SCENE_SATELLITE_MENU` (`menus.ts:96`). It is enabled only when the selected satellite's NORAD has a preset; menus are static, so it is greyed for GNSS satellites.
- Ruling (p), presets on the web: new `GET /api/imaging/presets` (static, no network, typed). The web loads it once at app start next to `useImagery.load()` (`App.tsx:92`) and identifies X satellites by NORAD.
- Ruling (q), snapshots:
  - `fetch_snapshot` always copies the newest cached `<group>_*.json` of `weather`, `science` and `visual` into the new snapshot as `<group>.json`, without a request, and includes them in `SHA256SUMS`.
  - With `X` in `systems` it calls `fetch_group` for those groups under the existing rate limit.
  - Existing snapshots lack these files, so imaging rows appear after the user's next own Fetch Now. There is no fallback that reads `_cache` at catalog time, because that would break reproducibility.
- Ruling (r), unreadable imaging group file: a `Message("IMAGING_GROUP_UNREADABLE", "warning", …)` and that group is skipped; never raise. This only runs for scenes that hold X satellites anyway.
- Ruling (s), GIBS CATALOG (research §6):
  - Add `MODIS_Aqua_CorrectedReflectance_TrueColor` ("MODIS Aqua True Color") and `VIIRS_NOAA21_CorrectedReflectance_TrueColor` ("VIIRS NOAA-21 True Color"): `daily`, `GoogleMapsCompatible_Level9`, max_level 9, credit `NASA GIBS / EOSDIS`, source `gibs`.
  - ext is `"jpg"`, like the existing MODIS/VIIRS rows that answered HTTP 200 live.
  - They go right after `GOES-West_ABI_GeoColor` (`imagery.py:140`) and before the EOX row, so existing index assertions (`body["layers"][4]`, `[-1]`) hold.
  - VIIRS SNPP on GIBS lagged to 2026-11-02 at the check. Show Imagery still works and the existing "no imagery at this time" HUD path covers it.
- Ruling (t), e2e: the e2e server has no GMAT, so "Propagate" is done by the fixture builder (fake orbits). That gives scenario `E2E_IMG` (THBK + X04 + MODIS) with results. The Insert flow is tested on `E2E_NORES`.
- Ruling (u), validation: `validate_ephemeris` drops `prn[0] == "X"` before comparing. Its result dict gains no key. `run_validate` adds `Message("IMAGING_SKIPPED", "info", "ข้ามดาวถ่ายภาพ n ดวง (ไม่มีข้อมูลอ้างอิง)")` and the markdown line only when n > 0.

---

### Task 1: Engine preset table and imaging catalog

**Files:**
- Create `gnss_predict/imaging.py`.
- Create `tests/fixtures/studio/imaging/{weather,science,visual}.json`: hand-written OMM, all 8 presets plus decoys. Add one line to `tests/fixtures/studio/SOURCES.md` saying they are synthetic.
- Create `tests/test_imaging.py`.
- Modify `gnss_predict/catalog.py:132` `_flagged_message`, adding optional thresholds.

**Interfaces:**
- Consumes `catalog.Catalog`, `CatalogSatellite`, `_unmapped`, `_flagged_message`; `omm.read_omm`, `to_tle_lines`; `config.AGE_OK_DAYS`, `AGE_SHOWN_MAX_DAYS`.
- Produces:
  - `IMAGING_LETTER = "X"`, `IMAGING_GROUPS = ("weather", "science", "visual")`, `GEO_MEAN_MOTION_MAX = 1.1`, `GEO_AGE_OK_DAYS = 7.0`, `GEO_AGE_SHOWN_MAX_DAYS = 14.0`.
  - `@dataclass(frozen=True) SensorPreset(type: Literal["Simple Conic", "Rectangular"], cone_half_angle: float | None = None, vertical_half_angle: float | None = None, horizontal_half_angle: float | None = None)` with `.definition() -> dict` (only the keys of its type plus `type`).
  - `@dataclass(frozen=True) ImagingPreset(prn: str, norad: int, name: str, block: str, groups: tuple[str, ...], camera: str, sensor: SensorPreset, gibs_layer: str)`.
  - `IMAGING_SATELLITES: tuple[ImagingPreset, ...]` (X01–X08 in order), `IMAGING_NORADS: frozenset[int]`, `preset_by_norad(norad: int) -> ImagingPreset | None`.
  - `imaging_group_files(snapshot_dir: Path) -> list[str]`: the `<group>.json` names present, in `IMAGING_GROUPS` order.
  - `build_imaging_catalog(snapshot_dir: Path, ref: tuple[datetime, datetime]) -> Catalog`: `ref` is the analysis period; age is measured at its midpoint like `build_catalog`.
  - `catalog._flagged_message(sat, ok: float = AGE_OK_DAYS, max_: float = AGE_SHOWN_MAX_DAYS) -> Message`; the GNSS text is unchanged.
- Preset rows:
  - `name`: "Himawari-9", "GOES-18", "GOES-19", "Terra", "Aqua", "Suomi NPP", "NOAA-20", "NOAA-21".
  - `block`: "Himawari-8/9", "GOES-R", "GOES-R", "EOS AM-1", "EOS PM-1", "JPSS", "JPSS", "JPSS".
  - `groups` per spec §1.
  - `camera`: AHI, ABI, ABI, MODIS, MODIS, VIIRS, VIIRS, VIIRS.
  - `sensor`: Simple Conic 8.7 (X01–X03); Rectangular V 55.0 / H 0.41 (X04–X05); Rectangular V 56.28 / H 0.42 (X06–X08).
  - `gibs_layer` per Global Constraints.
- `CatalogSatellite` for X: `prn` = code, `system="X"`, `svn=""`, `block` from the preset, `celestrak_name` = OMM `OBJECT_NAME`, flags only `stale`/`too_old`.

**Fixture epochs:** the period is 2026-11-10T00:00Z–06:00Z, so the midpoint is 03:00Z.
- Himawari-9: epoch −5.0 d, MM 1.0027.
- GOES-18: −9.0 d.
- GOES-19: −15.0 d.
- Terra: `science` −1.5 d and `visual` −0.5 d.
- Aqua (`visual` only): −0.8 d.
- SNPP: −8.0 d.
- NOAA-20: −1.0 d.
- NOAA-21: −2.5 d.
- LEO mean motions are 14.2–14.62. Every record has every field `to_tle_lines` needs.
- Decoys: `ROBUSTA-3A (MEDITERRANEE)` NORAD 60243 in `science`, and `TERRA FAKE` NORAD 99001 in `weather`.

- [ ] Failing tests in `tests/test_imaging.py`:
  - `test_presets_table`: `[(p.prn, p.norad) for p in IMAGING_SATELLITES]` equals the spec §1 list. Sensor values are exactly as in the preset rows. Every `gibs_layer` is a non-empty string.
  - `test_matches_by_norad_only`: with the snapshot dir = a temp copy of the GNSS snapshot plus the imaging fixtures, the catalog NORADs are exactly the 8 presets; 60243 and 99001 are absent from both `satellites` and `unmapped`.
  - `test_newest_epoch_wins`: X04 `omm_epoch` equals the `visual` epoch (2026-11-10T03:00Z − 0.5 d).
  - `test_age_flags_geo_and_leo`:
    - X01 `flags == frozenset()` (GEO, 5.0 d), X02 `{"stale"}`, X03 `{"too_old"}`.
    - X08 `{"stale"}` (LEO 2.5 d), X06 `{"too_old"}`, X04 empty.
    - X02's `SAT_FLAGGED` text contains `เก่ากว่า 7 วัน`; X08's contains `เก่ากว่า 2 วัน`.
  - `test_missing_is_tle_unavailable`: drop X05 from `visual.json` in a temp copy, giving `unmapped == [{"norad": 27424, "celestrak_name": "", "object_id": "", "reason": "TLE_UNAVAILABLE"}]`.
  - `test_no_gnss_flags`: no X satellite has `no_broadcast`, `unhealthy`, `prn_changed` or `name_mismatch`, even though the GNSS fixture snapshot has a broadcast file.
  - `test_unreadable_group_is_skipped`: `weather.json` = `b"not json"` gives one `IMAGING_GROUP_UNREADABLE` warning, and X04/X05 are still present.
  - `test_group_files`: `imaging_group_files(gnss_only_snapshot) == []`; with the fixtures it is `["weather.json", "science.json", "visual.json"]`.
- [ ] Run `python3 -m unittest tests.test_imaging -v`; expected `ModuleNotFoundError: gnss_predict.imaging`.
- [ ] Implement. Run `python3 -m unittest tests.test_imaging tests.test_catalog -v`; expected all PASS (GNSS catalog tests unchanged).
- [ ] Commit `feat(engine): imaging satellite presets and NORAD-matched imaging catalog` -- `gnss_predict/imaging.py gnss_predict/catalog.py tests/test_imaging.py tests/fixtures/studio/imaging tests/fixtures/studio/SOURCES.md`.

### Task 2: Engine snapshot, fetch, hash and propagate selection

**Files:**
- Modify `gnss_predict/imaging.py`, adding `scenario_catalog`.
- Modify `gnss_predict/studio.py`: `_system_letters` :181, `fetch_snapshot` :209, `_files_sha256` :265, `_plan` :334, the CLI `--systems` help :669, and the docstring line 3.
- Tests: `tests/test_studio_cli.py` (classes `TestFetchSnapshot`, `TestHashInputs`, new `TestImagingScenario`).

**Interfaces:**
- Produces `imaging.scenario_catalog(snapshot_dir: Path, period: tuple[datetime, datetime], systems: set[str], with_imaging: bool) -> Catalog` (Ruling b).
- Changes `_system_letters(systems: str) -> list[str]` to accept `GRECX`; the result is GNSS letters in `GNSS_GROUPS` order, then `"X"`.
- Changes `_files_sha256(snapshot_dir: Path, systems: set[str], imaging_files: Sequence[str] = ()) -> dict[str, str]`.
- `fetch_snapshot` signature is unchanged; its behaviour follows Ruling (q).
- `_plan`: `with_imaging = not {n for _, n in sc.satellites}.isdisjoint(IMAGING_NORADS)`.

- [ ] Step 0 (characterization, before any studio.py edit):
  - Add `TestHashInputs.test_gnss_only_hash_is_pinned`: `plan_propagate(self.sc, self.data).hash == "<literal>"`.
  - Run it once on the unchanged code to read the value, and paste the literal.
  - Also copy the imaging fixtures into the snapshot inside the same test and assert the same literal. Old code ignores those files, so the test passes now and must keep passing.
- [ ] Failing tests:
  - `TestFetchSnapshot`:
    - `test_copies_cached_imaging_groups`: the cache holds `weather_20261108T0000Z.json` and `weather_20261109T0000Z.json`; `fetch_snapshot(..., systems="GREC")` puts a `weather.json` in the snapshot that is byte-equal to the 20261109 file; `SHA256SUMS` has a line ending `  weather.json`; the opener saw no URL containing `GROUP=weather`.
    - `test_systems_x_fetches_imaging_groups`: `systems="GRECX"` makes the opener see `GROUP=weather`, `GROUP=science` and `GROUP=visual` once each (fixture routes).
    - `test_systems_validation`: `_system_letters("GRECX") == ["G","R","E","C","X"]`; `"GRECZ"` raises `ValueError`; the CLI default is still `GREC`.
  - `TestImagingScenario`, using FakeGmat plus the imaging fixtures copied into the snapshot; the scene holds G01 and Terra 25994:
    - `test_propagates_x04`: `plan.satellites` contains `"X04"`; `predicted.sp3` has `PX04` lines; `scene.czml` has the id `sat/X04`; the manifest entry for 25994 has `"prn": "X04", "system": "X"`; the manifest entry for G01 is unchanged (`"system": "G"`).
    - `test_imaging_files_in_hash`: `files_sha256` keys include `weather.json`, `science.json` and `visual.json`. Appending `b"\n"` to `visual.json` changes the ephem hash; doing the same to a GNSS-only scene does not.
    - `test_too_old_geo_hidden`: GOES-19 (too_old) is not propagated and shows up in `_no_satellites`/`SAT_FLAGGED` like GNSS.
- [ ] Run `python3 -m unittest tests.test_studio_cli -v`; the new tests fail (only `test_gnss_only_hash_is_pinned` passes).
- [ ] Implement. Run `python3 -m unittest tests.test_studio_cli tests.test_imaging -v`; expected all PASS, including the pinned literal and the existing `test_ephem_hash_changes_with_every_input` (`len(used) == 6` still holds for the GNSS-only scene).
- [ ] Commit `feat(engine): imaging groups in snapshots, fetch X and scenes with imaging satellites` -- `gnss_predict/imaging.py gnss_predict/studio.py tests/test_studio_cli.py`.

### Task 3: Engine analyze, DOP, validate and data providers

**Files:**
- Modify:
  - `gnss_predict/analyze.py` (`AerRow` :19, `aer_rows` :37);
  - `gnss_predict/dop.py` (`dop_series` :77; filter on `r.prn[0] in GNSS_GROUPS`; `_SYSTEMS` :19 unchanged);
  - `gnss_predict/studio_validate.py` (`validate_ephemeris` :113, `validation_markdown` :190);
  - `gnss_predict/studio.py` (`run_validate` :555);
  - `gnss_predict/dataproviders.py` (`_load_access` :203, lines 215–217).
- Tests: `tests/test_analyze.py`, `tests/test_dop.py`, `tests/test_studio_validate.py`, `tests/test_dataproviders.py`, `tests/test_report_format.py`, and `tests/test_integration_studio.py` (GMAT-gated).

**Interfaces:**
- `AerRow(time_utc: datetime, prn: str, az_deg: float, el_deg: float, range_km: float, ipp_lat_deg: float | None, ipp_lon_deg: float | None, mf: float | None)`.
- `dop_series(rows, fac, flags, times_utc=None) -> list[dict]`: same signature, X rows ignored.
- `validation_markdown(result: dict, *, scenario: str, ephem_hash: str, facility: str, skipped_imaging: int = 0) -> str`.
- `validate_ephemeris(...)`: same signature and the same result keys.

- [ ] Failing tests:
  - `test_analyze.TestImagingRows.test_aer_rows_x_have_no_ipp`: in an eph with `G01` and `X04`, every X04 row has `ipp_lat_deg is None and ipp_lon_deg is None and mf is None` and real az/el/range, and the G01 rows are unchanged. `studio._aer_csv_row(x_row)[5:] == ["", "", ""]`. `access_intervals` has an `X04` key.
  - `test_dop.TestImaging.test_dop_ignores_imaging_rows`: `dop_series(rows + x_rows, fac, {}, times_utc=t) == dop_series(rows, fac, {}, times_utc=t)`, where the 4 X rows have El 45–80; there are still 5 rows per time and no `"X"` system.
  - `test_studio_validate.TestImaging`:
    - `test_x_skipped`: a predicted SP3 with `G01` + `X04` gives `result == validate_ephemeris(<same without X04>)` (same keys and values); `"X04" not in result["satellites"]`.
    - `test_markdown_line`: `skipped_imaging=2` gives the line `- ข้ามดาวถ่ายภาพ 2 ดวง (ไม่มีข้อมูลอ้างอิง)`; `0` gives output identical to today.
  - `test_studio_cli.TestImagingScenario.test_validate_message` (FakeGmat, local `--sp3` fixture `tests/fixtures/studio/mgx_sample.sp3`, nav patched to `None`, no network): messages contain exactly one `IMAGING_SKIPPED` with text `ข้ามดาวถ่ายภาพ 1 ดวง (ไม่มีข้อมูลอ้างอิง)`. The GNSS-only scene has no such message.
  - `test_dataproviders.TestImaging`:
    - `test_access_tables_accept_empty_ipp`: a computed scene with X04 opens without `ResultCorruptError`.
    - IPP Data for `*/Facility/THBK */Satellite/X04` gives rows with `"IPP Lat" is None`, `"MF" is None` and a numeric `"Elevation"`.
  - `test_report_format`: the IPP Data `.txt` for X04 shows `N/A` in the IPP columns, and `.csv` has empty cells.
  - `test_integration_studio.test_propagate_imaging_x01_x04` (skipped without GmatConsole): the fixture snapshot plus imaging files with Himawari-9 and Terra gives `predicted.sp3` with X01 where every \|r\| ∈ [42114, 42214] km, and X04 where every \|r\| ∈ [6900, 7200] km.
- [ ] Run `python3 -m unittest tests.test_analyze tests.test_dop tests.test_studio_validate tests.test_dataproviders tests.test_report_format tests.test_studio_cli -v`; expected the new tests FAIL.
- [ ] Implement, then run `python3 -m unittest discover -s tests -v`; expected the whole engine suite PASSES. The golden report files in `tests/fixtures/reports/` are unchanged (GNSS-only), and the pinned hash still holds.
- [ ] Commit `feat(engine): imaging satellites in AER/access, out of DOP and validation` -- `gnss_predict/analyze.py gnss_predict/dop.py gnss_predict/studio_validate.py gnss_predict/studio.py gnss_predict/dataproviders.py tests/test_analyze.py tests/test_dop.py tests/test_studio_validate.py tests/test_dataproviders.py tests/test_report_format.py tests/test_studio_cli.py tests/test_integration_studio.py`.

### Task 4: Server catalog, presets route, fetch letters and GIBS CATALOG

**Files:**
- Modify:
  - `S/gnss_studio_server/templates.py` (`load_catalog` :152 calls `imaging.scenario_catalog(..., with_imaging=True)`);
  - `S/gnss_studio_server/routes/orbits.py` (`get_catalog` :102 accepts `system="X"` and adds `category`/`display_name`; new `GET /imaging/presets`);
  - `S/gnss_studio_server/jobs.py:47` (`SYSTEM_LETTERS = "".join(GNSS_GROUPS) + IMAGING_LETTER`);
  - `S/gnss_studio_server/imagery.py:126-145` (`CATALOG`: two rows after `imagery.py:140`, Ruling s).
- Regenerate `W/src/api/openapi.json`, `types.gen.ts`, `enums.gen.ts`.
- Tests: `S/tests/test_orbits.py`, `S/tests/test_imagery.py` (`TABLE`), `S/tests/test_jobs.py`, new `S/tests/test_imaging_presets.py`.

**Interfaces:**
- `/catalog` entries gain:
  - `"category": "gnss" | "imaging"`;
  - `"display_name": str`: the preset name for X, `celestrak_name` for GNSS.
- `GET /imaging/presets` → `list[ImagingPresetOut]` with `ImagingPresetOut(prn: str, norad: int, name: str, camera: str, gibs_layer: str, sensor: SensorDefinitionOut)`, where `SensorDefinitionOut(type: Literal["Simple Conic", "Rectangular"], cone_half_angle: float | None, vertical_half_angle: float | None, horizontal_half_angle: float | None)`.
- `daily.py:38` `SYSTEMS = "GREC"` and `worker.py:33` `DEFAULT_SYSTEMS = "GREC"` are unchanged.

- [ ] Failing tests:
  - `test_orbits`:
    - `ENTRY_KEYS` gains `category` and `display_name`.
    - `test_catalog_imaging_rows`: the fixture snapshot plus imaging files gives `[e["prn"] for e in rows if e["category"] == "imaging"] == ["X01","X02","X03","X04","X05","X06","X07","X08"]` (too_old X03 is listed with `flags == ["too_old"]`, like GNSS too_old rows such as R10; hiding is the web filter's job). Also `by["X04"]["display_name"] == "Terra"`, `by["X04"]["system"] == "X"`, `by["G01"]["category"] == "gnss"`, `by["G01"]["display_name"] == by["G01"]["celestrak_name"]`.
    - `test_catalog_system_x_filter`: `system=X` returns only X rows; `system=Q` returns 422 at field `system`.
    - The existing `test_catalog_entries_match_engine_catalog` still passes on the GNSS-only snapshot.
  - `test_imaging_presets`:
    - `GET /api/imaging/presets` → 200, 8 rows in X01…X08 order.
    - `rows[3] == {"prn": "X04", "norad": 25994, "name": "Terra", "camera": "MODIS", "gibs_layer": "MODIS_Terra_CorrectedReflectance_TrueColor", "sensor": {"type": "Rectangular", "cone_half_angle": None, "vertical_half_angle": 55.0, "horizontal_half_angle": 0.41}}`.
    - `test_every_preset_layer_is_in_catalog` pins each preset to a `CATALOG` id: `{p.prn: layer_by_id(p.gibs_layer).id for p in IMAGING_SATELLITES}` equals the 8-entry dict from Global Constraints, and each layer's `source == "gibs"`.
  - `test_imagery.TABLE` gains the two rows (`"daily", "GoogleMapsCompatible_Level9", 9, "jpg", "NASA GIBS / EOSDIS", "gibs"`) after GOES-West. `test_valid_time` gets cases for Aqua with `2026-11-02` (ok) and `2026-11-02T00:00:00Z` (not ok).
  - `test_jobs`: a `fetch` job with `systems="GRECX"` is accepted; `"GRECZ"` → 422 `systems`.
- [ ] Run `cd server && .venv/bin/python -m pytest -q -W error tests/test_orbits.py tests/test_imaging_presets.py tests/test_imagery.py tests/test_jobs.py`; expected the new tests FAIL.
- [ ] Implement, then run `cd web && npm run gen:api`. Run the server suite `.venv/bin/python -m pytest -q -W error` (expected all pass) and `cd web && npm run typecheck` (expected 0 errors).
- [ ] Commit `feat(server): imaging catalog category, presets route, X fetch letter and Aqua/NOAA-21 GIBS layers` -- the server files, the tests and `web/src/api/openapi.json web/src/api/types.gen.ts web/src/api/enums.gen.ts`.

### Task 5: Server Rectangular sensors and Insert with primary sensors

**Files:**
- Modify:
  - `S/gnss_studio_server/schema.py:201` (`SensorDefinition`);
  - `S/gnss_studio_server/templates.py:130` (new `imaging_sensor` next to `sensor`);
  - `S/gnss_studio_server/objects.py:60` (`_CATALOG_KEYS`), `:315` (`_from_catalog`).
- Regenerate the API types.
- Tests: `S/tests/test_objects.py`, `S/tests/test_scenarios.py`.

**Interfaces:**
- `SensorDefinition`:
  - `type: Literal["Simple Conic", "Rectangular"] = "Simple Conic"`;
  - `cone_half_angle: float = Field(45.0, gt=0, le=90)` (unchanged);
  - `vertical_half_angle: float | None = Field(None, gt=0, le=89, allow_inf_nan=False)`;
  - `horizontal_half_angle: float | None = Field(None, gt=0, le=89, allow_inf_nan=False)`;
  - a `model_validator(mode="after")`: Rectangular requires both, with the Thai `value_error` text `Rectangular ต้องมี vertical_half_angle และ horizontal_half_angle`.
- `templates.imaging_sensor(name: str, parent: str, definition: dict) -> dict`: `sensor(name, parent)` with `definition` replaced.
- `_CATALOG_KEYS = frozenset({"norads", "create_constellation", "primary_sensors"})`; `primary_sensors` must be a bool (else 422 `primary_sensors`). Rulings (l) and (m) apply.

- [ ] Failing tests:
  - `test_scenarios`:
    - `test_rectangular_sensor_round_trip`: PUT a doc with a Rectangular sensor (V 55.0, H 0.41), then GET it back identical.
    - `test_rectangular_ranges`: V `0` → 422 `objects[i].definition.vertical_half_angle`; `89` ok; `89.5` → 422; missing `horizontal_half_angle` → 422 `objects[i].definition`.
    - `test_old_sensor_without_type_loads_as_simple_conic`: a doc whose sensor `definition == {"cone_half_angle": 30}` validates.
  - `test_objects`:
    - `test_imaging_sensor_presets`: inserting 25994 with `primary_sensors: true` creates the sensor `MODIS` with `definition == {"type": "Rectangular", "vertical_half_angle": 55.0, "horizontal_half_angle": 0.41}`, `parent == "*/Satellite/X04"` and pointing Az 0 / El 90. 41836 gives `AHI` with `{"type": "Simple Conic", "cone_half_angle": 8.7}`.
    - `test_catalog_insert_primary_sensors_names_and_order`: norads `[25994, 27424, 62339]` with `create_constellation: "EO"` returns paths `["*/Satellite/X04", "*/Satellite/X05", "*/Satellite/G01", "*/Constellation/EO", "*/Sensor/MODIS", "*/Sensor/MODIS_X05"]`; EO's `assigned_objects` are the three satellites only; G01 gets no sensor.
    - `test_primary_sensor_name_clash_creates_nothing`: the doc already has `MODIS` and `MODIS_X04` → 409 `NAME_EXISTS` and `doc["objects"]` is unchanged.
    - `test_primary_sensors_default_false`: no key means no sensors; `"primary_sensors": "yes"` → 422 `primary_sensors`.
- [ ] Run `cd server && .venv/bin/python -m pytest -q -W error tests/test_objects.py tests/test_scenarios.py`; expected FAIL.
- [ ] Implement, `npm run gen:api` (the `SensorDefinitionType` enum gains `Rectangular`), then the server suite and `npm run typecheck`; expected all pass.
- [ ] Commit `feat(server): Rectangular sensors and primary camera sensors on catalog insert` -- the server files, the tests and the regenerated `web/src/api/*`.

### Task 6: Web rectangular geometry, drawing, Sensor View and Properties

**Files:**
- Modify:
  - `W/src/cesium/sensorGeometry.ts` (new functions after `coneRays` :143 / `sensorFootprint` :160);
  - `W/src/cesium/sensorDraw.ts` (`coneHalfAngleOf` :54, `sensorDrawState` :79, `radialLineEnds` :143, `sensorViewPose` :189);
  - `W/src/windows/Graphics3D/scene3d.ts:939` (HUD half angle);
  - `W/src/windows/SensorView/registry.ts` (`SensorHud`);
  - `W/src/windows/SensorView/SensorView.tsx` :276, :295;
  - `W/src/windows/PropertiesBrowser/pages/SensorPages.tsx` (`DefinitionPage` :17, page fields :77);
  - `W/src/windows/PropertiesBrowser/form.ts:172`;
  - `W/src/labels/labels.ts`, `messages.th.ts` (own hunks).
- Not touched: `graphics.ts` and `overlay2d.ts` (they consume `sensorDrawState`/`centralAngleRad` unchanged).
- Tests: `W/tests/unit/sensor-geometry.test.ts`, `sensor-draw.test.ts`, `sensor-view.test.tsx`, `sensor-view-parts.test.ts`, `properties.test.tsx`, `labels.test.ts`.

**Interfaces:**
- `sensorFrame(f: BodyFrame, azDeg: number, elDeg: number): BodyFrame` (Ruling i).
- `rectangleRays(sf: BodyFrame, verticalDeg: number, horizontalDeg: number, perSide = 18): Vec3[]`:
  - 4·perSide unit rays starting at corner (+H along +X, +V along +Y);
  - side 0 runs from +X to −X at +Y, then −Y side, etc.;
  - points are linear in (tan H, tan V), so each side stays in its bounding plane;
  - corners are at indices 0, perSide, 2·perSide, 3·perSide.
- `rectangleFootprint(pos: Vec3, sf: BodyFrame, verticalDeg: number, horizontalDeg: number, perSide = 18): SensorFootprint` reuses `hitEarth`/`horizonPoint`.
- `isRectangular(sensor: SensorObj): boolean`; `viewHalfAngleOf(sensor: SensorObj): number` (Ruling e). `coneHalfAngleOf` stays and is used only for Simple Conic.
- `SensorDrawState` gains `sensorFrame: BodyFrame`; `centralAngleRad` is `null` for Rectangular.
- `SensorHud` gains `shape: "Simple Conic" | "Rectangular"` and `halfAngles: { vertical: number; horizontal: number } | null`; `coneHalfAngle` now holds `viewHalfAngleOf`.
- Labels:
  - `option.sensorType.rectangular` = `stk("Rectangular", "G")`;
  - `field.verticalHalfAngle` = `ours("Vertical Half Angle")`;
  - `field.horizontalHalfAngle` = `ours("Horizontal Half Angle")`.
- Message `sensorView.hudRect` (Thai): `ครึ่งมุม Vertical {v}° × Horizontal {h}°`.

**Test setup for footprints:** Re = 6371.0088 km, ω = 7.292115e-5. `pos = {x: (Re + h)·1000, y: 0, z: 0}` and `vel = {x: 0, y: −ω·pos.x, z: 7450}`, so the inertial velocity points due north, body +X = north and +Y = east (cross-track).

- [ ] Failing tests:
  - `sensor-geometry`:
    - `sensorFrame(f, 0, 90)` equals `f` (1e-12).
    - `sensorFrame(f, 30, 60).z` equals `boresightOf(f, 30, 60)`, and the frame is orthonormal and right-handed.
    - `rectangleRays` gives `4·perSide` rays; each corner ray makes an angle `atan(√(tan²H + tan²V))` with +Z_s (1e-12).
    - **vertical edge midpoints are cross-track at ±13.723826°**: VIIRS V 56.28 / H 0.42 at h 826.9 km with `perSide = 2`. Ring points 1 and 5 are the +Y/−Y edge midpoints, at `[±13.723826, 0]` (lon ±1e-6, lat ±1e-9), so the strip spans 3052.044 km ±0.5 km of great circle on Re. The along-track midpoints (3, 7) have `|lon| < 1e-9` and `|lat| < 0.06`.
    - MODIS V 55.0 / H 0.41 at h 705 km: the cross-track midpoints are at ±10.477365°, so the width is 2330.063 km ±0.5 km.
    - With `perSide = 18`: `ring.length === 73`, all `horizon` false, and the 4 corners are symmetric (|lat| and |lon| pairwise equal, 1e-9).
  - `sensor-draw`:
    - A Rectangular sensor gives `centralAngleRad === null` and `footprint.ring.length === 73`.
    - `radialLineEnds` returns 4 points at the ring corners.
    - `sensor3dParts` with radial lines on returns 4 radials.
    - A Simple Conic sensor gives identical output to today (snapshot of the existing test values).
  - `sensor-view` / `sensor-view-parts`: `sensorViewShortFovDeg(viewHalfAngleOf(MODIS))` is 115.5, VIIRS 118.188, AHI 8.7 → 18.27. In the Rectangular HUD there is no `.sensor-view-cone` circle and the text contains `Vertical 55.0° × Horizontal 0.4°`.
  - `properties`:
    - A Rectangular sensor's Definition page shows Sensor Type "Rectangular" (read-only) and the two editable rows.
    - Apply sends `basic.definition.vertical_half_angle`.
    - A Simple Conic sensor's Apply body has no `vertical_half_angle`/`horizontal_half_angle` keys.
  - `labels`: the delimiter rule accepts `option.sensorType.rectangular`; the two Half Angle labels are `ours`.
- [ ] Run `cd web && npx vitest run tests/unit/sensor-geometry.test.ts tests/unit/sensor-draw.test.ts tests/unit/sensor-view.test.tsx tests/unit/sensor-view-parts.test.ts tests/unit/properties.test.tsx tests/unit/labels.test.ts`; expected FAIL.
- [ ] Implement, then run `npm test && npm run typecheck`; expected all pass, 0 type errors.
- [ ] Commit `feat(web): Rectangular sensor geometry, drawing, Sensor View and properties` -- the listed files (own hunks only in `labels.ts`/`messages.th.ts`).

### Task 7: Web Insert Imaging, presets store and Show Imagery

**Files:**
- Create:
  - `W/src/stores/imagingPresets.ts`;
  - `W/src/windows/GlobeManager/consent.ts`;
  - `W/src/windows/GlobeManager/showImagery.ts`.
- Modify:
  - `W/src/windows/GlobeManager/GlobeManager.tsx:372-375` (use `enableSourceWithConsent`);
  - `W/src/windows/SensorView/commands.ts` (export `openSensorViewForSatellite`, built from `run()` :117);
  - `W/src/windows/SatelliteCatalog/SatelliteCatalog.tsx` (`SYSTEM_OPTIONS` :29, `toEntry` :45, Name cell :305, the checkbox, `insert` :206);
  - `W/src/data/catalog.ts` (`CatalogEntry` gains `category`, `display_name`);
  - `W/src/commands.ts`, `W/src/chrome/menus.ts` :69, :96, `W/src/App.tsx` :66, :92, `labels.ts`, `messages.th.ts` (own hunks).
- Tests: `W/tests/unit/catalog-window.test.tsx`, `globe-manager.test.tsx`, new `show-imagery.test.ts`, `menubar.test.tsx`, `labels.test.ts`.

**Interfaces:**
- `useImagingPresets`: `{ presets: ImagingPresetOut[]; loaded: boolean; load(): Promise<void> }` and `presetOfNorad(norad: number): ImagingPresetOut | undefined`. Load failure reports a Thai warning `imaging.presetsFailed`, and Show Imagery stays disabled.
- `CONSENT_KEYS: Readonly<Record<ImagerySourceId, MsgKey>>` and `enableSourceWithConsent(id: ImagerySourceId): Promise<boolean>`. It resolves true when the source is already on or ends on after saving, and false when the user cancels or the save fails.
- `openSensorViewForSatellite(satellitePath: string): Promise<void>` (Ruling n).
- `showImagery(satellitePath: string): Promise<void>` and `registerShowImageryCommand(): () => void`, command id `object.showImagery`.
- Labels:
  - `menu.object.showImagery` = `ours("Show Imagery")`;
  - `option.system.imaging` = `ours("Imaging")`;
  - `dialog.catalog.addPrimarySensor` = `ours("Add Primary Sensor")`.
- Messages: `imaging.presetsFailed`, `showImagery.noLayer` (`ชั้นภาพ {layer} ไม่มีในรายการของ server`).

**Show Imagery steps:**
1. Find the preset by the satellite's NORAD.
2. If `sources.gibs` is off, `await enableSourceWithConsent("gibs")`; false means return.
3. If the layer is in `useImagery.layers`, `useLayout.getState().setGlobeLayer(layer, { show: true })`; otherwise report `showImagery.noLayer`.
4. `await openSensorViewForSatellite(path)`.

- [ ] Failing tests:
  - `catalog-window`:
    - The System select has an option "Imaging" (value `X`); choosing it shows only X rows, with PRN `X04` and the Name cell `Terra`.
    - "Add Primary Sensor" is checked by default.
    - Insert of X04 posts `{class: "Satellite", method: "From Satellite Catalog", norads: [25994], primary_sensors: true}`.
    - Insert of G01 only posts no `primary_sensors` key.
    - Unticking gives no key.
  - `globe-manager`: the existing consent tests still pass through `enableSourceWithConsent`. Cancel means no `PUT /api/settings`.
  - `show-imagery`:
    - **show imagery with GIBS off asks first; cancel does nothing**: the confirm text equals `msg("globe.consent")`; after cancel there are zero `PUT /api/settings`, `globe.layers` is unchanged and no Sensor View panel opened.
    - Confirm then sends one PUT with `online_imagery.enabled === true`; `globe.layers["MODIS_Terra_CorrectedReflectance_TrueColor"].show === true`; the Sensor View panel opens for `*/Sensor/MODIS`.
    - GIBS already on: no confirm.
    - If the satellite's sensor was deleted, the existing create-and-open path runs (`Sensor<n>`, Simple Conic).
    - Every `fetch` URL in the test starts with `/api/`.
    - The command is disabled for G01 and for no selection, and enabled for X04.
  - `menubar`: `SATELLITE_MENU` and `SCENE_SATELLITE_MENU` contain `object.showImagery` right after `object.sensorView`.
  - `labels`: the three new labels are `ours`.
- [ ] Run `cd web && npx vitest run tests/unit/catalog-window.test.tsx tests/unit/globe-manager.test.tsx tests/unit/show-imagery.test.ts tests/unit/menubar.test.tsx tests/unit/labels.test.ts`; expected FAIL.
- [ ] Implement, then run `npm test && npm run typecheck && npm run gen:api:check`; expected all pass and no API diff.
- [ ] Commit `feat(web): Imaging catalog filter, primary sensors on insert and Show Imagery` -- the listed files (own hunks only in the shared files).

### Task 8: E2E, README and decisions

**Files:**
- `W/tests/e2e/fixture/build_fixture.py`, own hunks only (another agent edited it recently; re-read it first):
  - copy `tests/fixtures/studio/imaging/*.json` into `orbits/20261110T0000Z/`;
  - add `RADIUS_KM["X"] = 7076.0` and `INCLINATION_DEG["X"] = 98.2` for `orbit_of`;
  - create `E2E_IMG` from the `empty` template plus THBK, Satellite `X04` (25994) and Sensor `MODIS` (Rectangular 55.0/0.41), then `run_propagate` + `run_analyze("THBK")` with the fake orbits.
- New `W/tests/e2e/imaging.spec.ts`.
- `R/README.md`: an imaging-satellites section covering the 8 presets, groups, snapshot rule (Ruling q), GEO age thresholds, DOP/Validation exclusion, that X codes are not IGS SP3 codes (spec §7), and the VIIRS SNPP GIBS lag.
- `R/docs/2026-11-14-gnss-studio-imagery-decisions.md`: append a "ข2 ดาวถ่ายภาพ" section with the Plan rulings and deferred items (swath corridor, night/IR switching, `resource`/`goes`/`noaa` fetch, adding V/H Half Angle to STK reference §G).

- [ ] Failing e2e tests:
  - `insert Terra with its primary sensor` (on `E2E_NORES`): Insert → From Satellite Catalog → System Imaging → select X04 → Insert. The Object Browser shows `X04` with child `MODIS`; the Properties Definition page shows Rectangular 55 / 0.41.
  - `imaging satellite in 3D` (on `E2E_IMG`): `entityPositionEcef("X04")` is not null and its altitude is 690–720 km; `sensorFootprint("MODIS", "3d") === 73`; `sensorFootprint("MODIS", "2d") === 73`.
  - `Show Imagery asks before going online`: right-click X04 in the Object Browser → Show Imagery → the Thai consent dialog appears → Cancel → no Sensor View tab, and the settings file still has `online_imagery.enabled === false`.
  - Every spec in this file asserts no request leaves `127.0.0.1` (the existing `localRequest.ts` helper).
- [ ] Run `cd web && npm run e2e -- tests/e2e/imaging.spec.ts`; expected FAIL before the fixture change, PASS after. Then run the full gates:
  - web: `npm test`, `npm run typecheck`, `npm run gen:api:check`, `npm run e2e`;
  - server: `cd server && .venv/bin/python -m pytest -q -W error`;
  - engine: `python3 -m unittest discover -s tests -v`.
  - Expected: all green.
- [ ] Commit `test(gnss-studio): e2e, README and decisions for imaging satellites` -- `web/tests/e2e/fixture/build_fixture.py web/tests/e2e/imaging.spec.ts README.md docs/2026-11-14-gnss-studio-imagery-decisions.md`.

---

## Plan amendments after the independent review (2026-11-17)

Source: `docs/2026-11-17-imaging-plan-review.md` (models branch, cc54756). These rulings override the tasks above where they conflict.

- **Ruling (v), R-01, Task 5/6:** a Rectangular `SensorDefinition` carries no `cone_half_angle`. A model validator drops it, or sets it to None, for `type == "Rectangular"`, and the web form never sends it for Rectangular. Tests:
  - the server round-trips a Rectangular sensor with no `cone_half_angle` in the saved JSON;
  - the Properties payload for Rectangular has only `vertical_half_angle`/`horizontal_half_angle`.
- **Ruling (w), R-02, Task 1:** `build_imaging_catalog` returns an empty catalog (no satellites, no unmapped entries, no messages) when the snapshot has no imaging group file at all. GNSS-only snapshots then gain no `TLE_UNAVAILABLE` rows. Test: `test_no_imaging_files_gives_empty_catalog`.
- **Ruling (x), R-03, Task 7:** Show Imagery must leave the satellite's GIBS layer visible.
  - If an opaque layer (EOX, OSM, or the exclusive ion) is shown above it, Show Imagery hides those layers (layer show off in the Globe Manager state, not the source switch).
  - It posts one Thai info message naming them.
  - Test: OSM shown, then Show Imagery for X04 → OSM hidden, the MODIS Terra layer is the top shown layer, and one message is posted.
- **Ruling (y), R-04, Task 2:** `fetch_snapshot` copies a cached imaging group file only when the file is at most 14 days old (the GEO hide threshold). An older file is left out and a Thai message says so. Test: a 20-day-old `weather_*.json` is not copied.
- **Ruling (z), R-05, Task 7 (amends spec §5.4 and Ruling n):**
  - With a child sensor, Show Imagery opens the Sensor View for that sensor.
  - Without one, it enables the GIBS layer and flies the 3D camera over the sub-satellite point. It must never create an object.
  - Test: a satellite with no sensors sends no `POST /objects`.
- **Ruling (aa), R-07, Task 2/3:** system checks use `prn[:1]`, never `prn[0]`, in `dop.py` and `studio_validate.py`.
- **Ruling (ab), review gap (2), Task 7:**
  - The Fetch Orbit Data dialog gains an "Imaging satellites" checkbox (ours label, default off). When ticked, it sends `systems` with `X`, so the user can refresh the weather, science and visual groups under the existing rate limits.
  - Its Thai hint names the three CelesTrak groups.
  - Test: ticked sends `GRECX`; unticked sends the old value unchanged.
- **R-06** (line drift of 1–5 lines) needs no ruling. Implementers re-locate by symbol name.
