# GNSS Studio Satellite 3D Models in the 3D Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Satellites in 3D windows render as their per-type glTF models from `models/catalog.json`, oriented nadir/yaw-steering with sun-tracking wings, with a window option to fall back to points.

**Architecture:** Vite copies the catalog and glbs into the web build at `/models/`. A pure resolver maps a satellite (block, NORAD) to a model. A pure attitude module computes body→ECEF quaternions and wing angles. The 3D scene attaches `ModelGraphics` to satellite entities and updates orientation on the existing 250 ms throttle. Two `Props3D` options control models.

**Tech Stack:** React/TS, CesiumJS 1.147 (`ModelGraphics`, `ModelUtility`, `Simon1994PlanetaryPositions`/`Transforms`), Vite (static copy), vitest, Playwright.

**Spec:** `api-interop/gnss-predict/docs/2026-11-14-gnss-studio-models-integration-design.md`. R = `api-interop/gnss-predict`, W = `R/web`, M = `R/models`.

## Global Constraints

- Branch `feature/gnss-studio-imagery`, worktree `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-imagery`. Run `git branch --show-current` before every commit. Never push or merge. Never use bare `git stash`.
- Commit trailer must be exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, with no other co-author line.
- No network in tests or from implementers.
- Don't modify `M/**` (the model sources belong to the models branch). Read `M/catalog.json` and model NOTES as data only.
- Model URL: `/models/<id>/<id>.glb`. Catalog URL: `/models/catalog.json`. Only files listed in the catalog are copied, never `_refs`, `scripts`, `renders`, `vendor` or `textures`.
- Resolution order: `block` (exact match in a model's `blocks`) → `fallback_blocks` → `norad_ids` → `fallback` (`generic`). Unknown or missing block → `norad_ids` → `generic`.
- Defaults: Satellite Models on, Model Pixel Size 48 (range 16–256 integer), `maximumScale` 20000. Use `ConstantProperty` updates on the existing 250 ms throttle; never use `CallbackProperty`.
- Attitude:
  - GNSS (every model with `blocks`) uses yaw steering: ez = −r̂, ey = ez×es/|…|, ex = ey×ez. In the singular case reuse the previous ey, else fall back to the sensor §3.1 frame.
  - EO models (`norad_ids` only) use the sensor §3.1 frame.
  - Wings rotate about body +Y so the cell-side normal faces es projected onto X-Z.
- UI labels go through `stk()` only when verbatim in the STK reference doc, otherwise `ours()`. Messages are Thai via `msg()`.

## Review Focus

1. Model axis correction: a body +Z (nadir) must render toward Earth. Prove it against real Cesium `ModelUtility`, not a hand formula.
2. Wing angle sign: the cells must face the sun, not away from it, for every model whose zero-angle normal differs.
3. Performance with about 146 satellites: one glb fetch per model id (Cesium resource cache), no per-frame allocations, and orientation updates only for visible satellites.
4. Fallback: a missing or failed glb, models off, or an unknown block must never break picking, labels, colours, sensors or access lines.
5. Build packaging: the copy plugin must not ship `_refs` (55 MB of reference photos) or anything outside the catalog. Check that the dist size increase is roughly the sum of the catalog glbs.

---

### Task 1: Package models and resolver

**Files:**
- `W/vite.config.ts`: static copy of `M/catalog.json` plus each catalog glb into `dist/models/`. Dev must serve the same paths; use a small vite plugin or the existing static-copy pattern.
- New `W/src/cesium/satModels.ts`.
- Tests: new `W/tests/unit/sat-models.test.ts`, and a build-output check in `W/tests/unit/models-packaging.test.ts` that reads `M/catalog.json` and asserts the copy plugin's file list (no `_refs`, every glb exists on disk).

**Interfaces:**
- Produces `loadModelCatalog(): Promise<ModelCatalog>` (fetches `/models/catalog.json` once and caches it).
- Produces `resolveModel(cat: ModelCatalog, sat: { block: string | null; norad: number | null }): { id: string; url: string; wings: "two" | "single"; eo: boolean }`. `eo` is true when the match came from `norad_ids`. `wings` comes from the catalog when present, otherwise "single" when the model id is in the EO list.

- [ ] Failing tests:
  - GPS-IIF → gps-iif.
  - GAL-2 → galileo-foc.
  - QZS-2I → qzss-igso.
  - A fallback block → generic.
  - NORAD 41836 → himawari-9 with eo true.
  - Unknown block and unknown NORAD → generic.
  - Null block with a known NORAD → that model.
  - The catalog file is fetched once.
  - The packaging list equals the catalog glbs plus `catalog.json`.
- [ ] Implement. Run `npm test` and `npm run typecheck` until green, then `npm run build` and check that `dist/models` has the expected files and no `_refs`.
- [ ] Commit `feat(gnss-studio): ship satellite model catalog and glbs with the web app`.

### Task 2: Attitude math

**Files:**
- New `W/src/cesium/attitude.ts` (pure, uses Cesium math types only).
- Tests in `W/tests/unit/attitude.test.ts`.

**Interfaces:**
- Produces `yawSteeringFrame(r: Cartesian3, v: Cartesian3, sun: Cartesian3, prevEy?: Cartesian3): { ex, ey, ez }`.
- Produces `nadirVelocityFrame(r, v): { ex, ey, ez }`. Reuse the sensor §3.1 implementation in `cesium/sensorGeometry.ts` if it exists; don't duplicate it.
- Produces `bodyToEcefQuaternion(frame): Quaternion`.
- Produces `wingAngle(frame, sun, r, zeroNormalBody: Cartesian3): number`.
- Produces `sunPositionEcef(date: JulianDate): Cartesian3` (Cesium `Simon1994PlanetaryPositions` + `Transforms.computeIcrfToFixedMatrix`/`computeTemeToPseudoFixedMatrix`, matching what the 3D window lighting uses).

- [ ] Failing tests:
  - The frame is orthonormal and right-handed.
  - ez·(−r̂) > cos 0.1°.
  - The sun is in the X-Z plane with es·ex ≥ 0.
  - After wingAngle the rotated normal is within 1° of es for zeroNormal +X, +Z and −Z.
  - The singular case uses prevEy.
  - nadirVelocityFrame matches the sensor frame.
  - The quaternion maps body axes to ex/ey/ez (1e-9).
  - The sun direction at a known date is within 0.5° of an independent formula, for example the low-precision Astronomical Almanac sun.
- [ ] Implement. Make sure the tests pass, then commit `feat(gnss-studio): yaw-steering and nadir attitude for satellite models`.

### Task 3: Render models in 3D windows

**Files:**
- `W/src/cesium/graphics.ts` (satellite entity model/point).
- `W/src/windows/Graphics3D/scene3d.ts` (throttled orientation and wing updates, sun position, model failure fallback).
- `W/src/windows/Graphics3D/props.ts`, plus the 3D Graphics Window Properties UI where `Props3D` is edited (find it), with options `satelliteModels: boolean` = true and `modelPixelSize: number` = 48.
- `W/src/labels/labels.ts` and `messages.th.ts`.
- `W/src/cesium/testHooks.ts`: `modelCount(): number`, which counts satellite entities with a shown model in the first 3D scene.
- Tests: `W/tests/unit/sat-model-render.test.ts` (new), `props` tests.

Determine the axis options by testing against the real Cesium `ModelUtility.getAxisCorrectionMatrix` (Review Focus 1). Read each model's zero-angle wing normal from `M/<id>/NOTES.md` or the glb node data. If the models differ, keep a per-id constant map in `satModels.ts` with a comment citing the source.

- [ ] Failing tests:
  - With models on, a satellite entity gets a model with the right uri, minimumPixelSize and maximumScale, and the point is hidden.
  - With models off, the point is restored and no model is set.
  - Orientation is a ConstantProperty and updates only on throttle ticks.
  - The wing nodeTransformations are set for two-wing and single-wing models.
  - A model load failure (simulated) reverts that id to points and shows one Thai message.
  - Hidden satellites get no updates.
  - Axis options: body +Z ends up as model-space +Z (via the real Cesium matrix).
  - Picking, labels and sensors are unaffected (existing tests still pass).
- [ ] Implement. Run `npm test` and `npm run typecheck` until green, then commit `feat(gnss-studio): render satellites as 3D models with yaw steering`.

### Task 4: E2E, README, decisions

**Files:**
- `W/tests/e2e/models.spec.ts` (new): the 3D window shows models (`modelCount() > 0` and equal to the number of shown satellites); toggling Satellite Models off gives `modelCount() == 0` and points visible; no foreign requests; `/models/catalog.json` is fetched once.
- `R/README.md` (models section: what is shown, attitude model and its limits, options, packaging, sources/licences from `M/vendor/SOURCES.md` and model NOTES).
- `R/docs/2026-11-14-gnss-studio-imagery-decisions.md` (append a "โมเดล 3 มิติในหน้าต่าง 3D" section with rulings and deferred minors).

- [ ] Run the full suites: web unit, typecheck, gen:api:check, e2e, server `-W error`, engine. Commit `test(gnss-studio): e2e and docs for satellite models`.
