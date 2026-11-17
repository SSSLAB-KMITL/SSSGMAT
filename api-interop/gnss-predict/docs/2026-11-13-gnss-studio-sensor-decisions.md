# GNSS Studio งานเสริม ก (Sensor + Sensor View): การตัดสินใจระหว่างลงมือและข้อค้างเล็ก

บันทึกจากการลงมือแผน `2026-11-13-gnss-studio-sensor-plan.md` แบบ subagent-driven (branch `feature/gnss-studio-sensor`, 0a41fbf..e9b654f)
ทุกข้อเป็นบรรทัดจาก ledger ตามจริง (ภาษาอังกฤษ) รูปแบบ `<งาน>: Ruling: <สิ่งที่ตัดสิน> — <เหตุผล> — <ผลถ้าตัดสินผิด>`
งานเสริม ข (ภาพถ่ายจริงจาก NASA GIBS) และงานย่อยที่ 4 ควรอ่านหัวข้อ 1 และ 2 ก่อนเริ่ม: Sensor View, การเลือกดาวในหน้าต่าง 3D และตัวกัน request ของ e2e เป็นของที่งานเหล่านั้นต่อยอด

## 1. การตัดสินใจ (Ruling)

- Ruling R1: Task 2's nadir test compares boresightHit with closeTo(0, 9) per component instead of exact toEqual([0, 0]) — exact float equality (and -0 vs 0 under Object.is) would fail on correct code — costs nothing if wrong (stricter tolerance can be restored).
- Ruling R2: Task 6 adds a pure `drawableSensors(doc, view: "2d" | "3d", parentShown: (path: string) => boolean): SensorObj[]` in sensorDraw.ts used by both scenes; the "hidden parent draws nothing" and "hidden sensor draws nothing" tests target it (per-view show flag: graphics2d.show for 2D, graphics3d.show for 3D); sensorItems only formats states — keeps SensorDrawState geometry-only — cost if wrong: one helper to move.
- Ruling R0: execution proceeds without a separate written-spec review gate — the user explicitly asked to start implementing the proposal ("ลองทำตามแผนที่นำเสนอก่อนได้ไหม"); spec 3a1182c and plan 0a41fbf are committed for review anytime — cost if wrong: rework of whatever the user changes after reading them.
- Task 3: Ruling: page.sensor.attributes2d tagged stk "C" and page.sensor.attributes3d tagged ours (plan said stk G) — the texts are not verbatim in §G and the repo test enforces verbatim presence; keys/texts unchanged — cost if wrong: a re-tag if the STK reference is extended
- Task 5: Ruling: Define Properties for a Sensor also picks the parent in Select Object and shows it read-only (spec §5.1 names Select Object only for Insert Default; Define Properties needs a parent and STK attaches every sensor to a selected parent) — cost if wrong: swap for an in-form Parent picker
- Task 6: Ruling: 2D sensor graphics redraw in the existing 2D overlay pass (100 ms, same as Swath) rather than the spec's ≤4/s — the plan's Step 5 puts them in the Swath pass and the cost is a handful of polylines — cost if wrong: one throttle constant
- Task 6: Ruling: when the boresight misses the Earth, radial lines follow the true cone edges to horizon length instead of P6's ring points (which bend to the limb); coneRays exported from sensorGeometry.ts — keeps the drawn cone geometrically honest — cost if wrong: revert to ring points
- Task 7: Ruling: Important 2 — position for the default cone comes from the first 3D window, else any open Sensor View scene (sensorViewScenes) that has the satellite, else 45° — spec §5.1 wants ρ+0.5 whenever the satellite has a result; CZML positions live only in open viewers, so with no viewer open 45° stays (value editable, message reports it) — cost if wrong: an extra data path from results
- Task 8: Ruling: pathAt picks the nearest satellite/facility marker within 8 px in screen space instead of scene.pick/drillPick — orbit paths and access lines sit above the markers so drillPick never reached them (40 layers at THBK); entityScreenPosition uses the same projection so e2e clicks are consistent — cost if wrong: orbit-path/label clicks don't select (marker only)
- Task 8: Ruling: main 3D windows clear Cesium's canvas.oncontextmenu so the Radix menu opens in a real browser (Sensor View untouched) — jsdom hid this — cost if wrong: browser's native menu suppressed elsewhere is unaffected
- Task 9: Ruling: e2e uses G22 where the plan says G02 — the e2e snapshot has GPS G01 and G22 only — cost if wrong: none (any second satellite works)
- Final: Ruling: re-grade by effect — README inaccuracies (2D redraw rate, Define Properties uses Select Object, 45° when no viewer is open) and the silent sensor loss in the satellite delete confirmation enter the fix wave as Important (they mislead the user or lose sensor setup without warning); the rest of area B's minors stay deferred
- Final: Ruling: re-grade A-minor-1 (own ring wobble in the Sensor View) to Important — it is a visible glitch in the window the user asked for; fix by not drawing the sensor's own ring/marker in its own Sensor View (the HUD circle is the exact image of the cone edge, and for α ≥ ρ the ring is the Earth limb already visible) — amends P7 — cost if wrong: the ring can be redrawn per camera update instead

## 2. ข้อค้างเล็กที่เลื่อนไว้ (ผู้ตรวจรวมทั้งสองส่วนเห็นว่าเลื่อนได้)

- Task 1: minor (deferred): access.py normalize/expand_targets call a Sensor target "Facility" in the 422 text; no tests pin Sensor rejection from groups/assigned_objects/access to
- Task 1: minor (deferred): cascade delete of sensors lives inside _rewrite_refs (hidden side effect); clearer in delete()
- Task 1: minor (deferred): objects.py _default Sensor branch repeats first_free/claim; tree() sensors_of assigned after the node closure that reads it
- Task 1: minor (deferred): Define Properties with parent null says "ไม่พบ object None" (still 422 on parent), untested
- Task 1: minor (deferred): test_scenarios _invalid_cases "name equals a Facility" case sits under the pydantic block comment
- Task 2: minor (deferred): horizon-point side untested (sign flip in horizonPoint would pass); all-miss test asserts only null hit + finite
- Task 2: minor (deferred): sensorFootprint has no guard for |p| ≤ Re (garbage ring) — carry to Task 6: sensorDrawState must return null when the satellite is not above the surface (like swathShape)
- Task 2: minor (deferred): sensorViewFovDeg(α, 0|∞|NaN) → 180/NaN — carry to Task 7: guard zero-size viewport before setting fov; sensorFootprint n=0 throws (doc says n ≥ 1)
- Task 2: minor (deferred): npm test prints a jsdom "manifest.satellites.flatMap" trace from app-chrome-boundary.test.tsx (intentional throw; check whether pre-existing)
- Task 3: minor (deferred, plan-mandated): sensorView.hudCone has no Thai (NO_THAI allowlist) and repeats the STK term "Cone Half Angle" outside labels.ts; could compose from t("field.coneHalfAngle")
- Task 3: minor (deferred, plan-mandated): sensorView.* label namespace outside the agreed namespaces (Up/North/Velocity would normally be option.*)
- Task 3: minor (deferred): G_LABELS list in labels.test is hand-maintained; absence assertion for "3D Graphics - Attributes" is brittle by design
- Task 4: minor (deferred): sensors of a filter-hidden satellite get hidden:false (checkbox looks active) — owner: Task 6 drawableSensors already hides graphics when parent hidden; OB styling deferred to final review
- Task 4: minor (deferred): no test for a sensor whose parent satellite is missing (parentOf returns stored path; Zoom To enabled but no-op)
- Task 4: minor (deferred): selection stays on a hidden sensor when its satellite is collapsed (same as folders)
- Task 4: minor (deferred): collapse state keyed by satellite path is lost on rename; stale keys never pruned
- Task 4: minor (deferred): satellite delete confirmation does not say its sensors are deleted too
- Task 4: minor (deferred): menus.ts imports RowClass type from windows/ObjectBrowser/tree; effectiveColor computes themeTokens before Sensor early return; commands3d invalidates on every doc change
- Task 4: minor (deferred): effectiveColor (OB swatch) reads graphics2d.color only; if 2D/3D colours are set apart in Properties the swatch shows the 2D one
- Task 4: minor (deferred): an earlier full npm test run had 13 timeouts under machine load avg 400+; clean re-run passed — watch for flakiness
- Task 5: minor (deferred): parseDecimal ignores lt alone or with gt; parseNumber ignores gt/lt when integer — documented only
- Task 5: minor (deferred): SelectObjectDialog double-click bound to each <option> (browser-dependent); no test that focus reaches Define Properties after Select Object OK
- Task 5: minor (deferred): weak tests (form.test cone 422 near-tautological; insert.test remounts mid-test); Parent row shows the raw path
- Task 6: minor (deferred): no automated test for Scene3D.drawSensors entity lifecycle (add/update/remove, ids) or the scene2d sensor block; ring id string written twice (sensorParts vs sensorFootprintPoints)
- Task 6: minor (deferred): sensor-draw import-closure test pins the exact file set (brittle); fillBuilds counts Swath only; 2D visibility computed twice
- Task 7: minor (deferred): adopted() calls Graphics3D noteSceneLoaded() for Sensor Views too (sceneLoadedAt metric can come from a Sensor View)
- Task 7: minor (deferred): rename heuristic in track.ts can retarget on a coalesced external "delete last viewed sensor + insert new sensor"; tighten with now.parent === old.parent
- Task 7: minor (deferred): 4-window limit not enforced on workbook restore; one-frame noPosition flash on sensor rename; no automated test for lockCamera/release/pose assignment/parent hiding (Task 9 e2e should cover)
- Task 8: minor (deferred): Scene3D click glue (pressAt/clicked/opts.pick/grab gating, pathAt, windowPosition) not unit-tested — Task 9 e2e should left-click a satellite via entityScreenPosition
- Task 8: minor (deferred): right-drag release within 8 px of a marker opens the menu on Windows/Linux; two click-tolerance definitions (pick.ts vs zoomBox.ts); touch long-press may show a stale menu
- Task 9: minor (deferred): footprint e2e asserts only > 0 points (cannot show the footprint changed); afterEach restores sequentially (first throw skips the rest)
- Task 9: minor (deferred): zoomOut3D/settledPoint could click a stale R05 position under a >500 ms frame stall; guard has no permanent negative self-test; no e2e for facility click/right-click or the 5th-window refusal

## 3. งานที่เสร็จ

- Task 1: complete (commits 0a41fbf..3dca3c8, review clean)
- Task 2: complete (commits 3dca3c8..4bbb329, review clean)
- Task 3: complete (commits 4bbb329..7a6ab2a, review clean)
- Task 4: complete (commits 7a6ab2a..c49edd3, review clean)
- Task 5: complete (commits c49edd3..cc6fe6b, review clean)
- Task 6: complete (commits cc6fe6b..963d606, review clean)
- Task 7: complete (commits 963d606..da0fc2c, review clean)
- Task 8: complete (commits da0fc2c..624f5eb, review clean)
- Task 9: complete (commits 624f5eb..cd598d4, review clean)

## 4. การตรวจรวมทั้ง branch

- Final review: dispatched 2 area reviewers (opus) — A: server/geometry/rendering/SensorView/picking (final-areaA.diff), B: labels/OB/menus/Properties/Insert/layout/e2e/README (final-areaB.diff); range 0a41fbf..cd598d4
- Final area B: With fixes — Important: request guard (fixtures.ts isLocalRequest) fails perf.spec run against GNSS_E2E_PERF_URL (127.0.0.1:8767) — plan defect in P5. Minor: README 2D rate wrong (≤4/s only 3D); README Insert omits Select Object for Define Properties; README 45° case omits "no 3D window or Sensor View open"; ContextMenu with no entries still opens Root; satellite delete confirmation silent about its sensors; filter-hidden sensor rows look active; footprint e2e title unprovable; guard ignores websockets / no negative self-test.
- Final area A: Ready to merge Yes — no Critical/Important. Minor: own-sensor ring in its Sensor View lags the camera (redraw ≤4/s vs camera per tick → wobble around the HUD circle while animating); cone-ray reference is Earth-fixed +X; sensorTarget builds a full footprint per tick; no assertion that 3D/2D sensor graphics are removed after delete. Deferred-minor triage: all ok to defer; T2 |p|≤Re and fov guard and T8 click glue resolved.
- Final: fix wave dispatched (sonnet) with 4 findings: guard vs perf URL; README accuracy (2D rate, Define Properties uses Select Object, 45° also with no viewer open); satellite delete confirmation names its sensors; no own ring/marker in own Sensor View. FIX_BASE cd598d4
- Final: fix wave DONE c860625 e6e2ab0 3dc1928 e9b654f (web 2042 unit, typecheck clean, e2e 18 + perf skip; perf run itself not executed — guard logic verified by node checks). Scoped re-review dispatched (sonnet).
- Final: scoped re-review of fix wave — all 4 addressed, no new breakage (commits cd598d4..e9b654f)

## 5. เรื่องที่ผู้ใช้ควรรู้

- เปิด scenario ที่มี Sensor ด้วย server รุ่นก่อน branch นี้ (feature/gnss-studio-workspace) ไม่ได้ เพราะ schema รุ่นเก่าไม่รู้จัก class Sensor (422) จึงทดลองบนสำเนาข้อมูล ไม่ใช่ data dir จริง
- การวัดประสิทธิภาพ (perf.spec) ยังไม่ได้รันจริงหลังเพิ่มตัวกัน request เพราะต้องเปิด server ตัวที่สองที่พอร์ต 8767 ตรวจเฉพาะตรรกะของตัวกัน
- ท่าทางจริงของดาว GNSS (yaw steering) ยังไม่ทำ Sensor ใช้กรอบ Nadir alignment with ECI velocity constraint ของ STK
