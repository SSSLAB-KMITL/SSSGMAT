# GNSS Studio server: การตัดสินใจระหว่างลงมือและข้อค้างเล็ก

บันทึกจากการลงมือแผน `2026-11-11-gnss-studio-server-plan.md` แบบ subagent-driven (branch `feature/gnss-studio-server`, 2dd4a59..97bf6ec)
ทุกข้อเป็นบรรทัดจาก ledger ตามจริง (ภาษาอังกฤษ) รูปแบบ `<งาน>: Ruling: <สิ่งที่ตัดสิน> — <เหตุผล> — <ผลถ้าตัดสินผิด>`
งานย่อยที่ 3 (workspace) และ 4 (access/reports) ควรอ่านหัวข้อ 2 ก่อนเริ่ม เพราะหลายข้อเป็นข้อตกลงที่หน้าจอต้องรู้

## 1. การตัดสินใจ (Ruling) 

- Rulings from pre-flight:
- Pre-flight: Ruling: Task 5 may modify routes/scenarios.py and routes/objects.py to publish `scenario` events — plan Produces requires it though Files omits them — cost if wrong: none (same files touched later anyway)
- Pre-flight: Ruling: Task 8 puts fixture `s1_computed` in server/conftest.py so Tasks 9, 10, 12 reuse it — cost if wrong: none
- Pre-flight: Ruling: Task 10 gives settings an `on_change` callback (no-op default) that Task 11 wires to the scheduler — cost if wrong: one extra parameter
- Task 2: Ruling: /api/health daily = null until Task 11 scheduler exists — brief requires the key but no producer yet — cost if wrong: one field change in T11
- Task 2: Ruling: replace plan-mandated httpx with httpx2 (what Starlette 1.10 TestClient prefers) so test output is pristine; if httpx2 cannot install, filter only that StarletteDeprecationWarning in pytest.ini — spec says nothing about the HTTP test client, plan picked httpx before Starlette deprecated it — cost if wrong: one dev-dependency line
- Task 2: Ruling: re-grade reviewer Minor "HTTP_ERROR uses str(exc.detail) as user text" to Important — global constraint requires Thai user text — cost if wrong: one string
- Task 3: Ruling: persist client doc (validate via pydantic + load_scenario, then os.replace) instead of model_dump — keeps unknown fields at all levels — cost if wrong: none (stricter normalisation can be added later)
- Task 3: Ruling: ETag header quoted RFC form, If-Match accepts quoted/bare/W/; PUT without If-Match → 412 — spec §5.3 "every edit must send If-Match" — cost if wrong: client echo semantics only
- Task 3: Ruling: empty/omitted snapshot → newest data/orbits folder, none → 422 ORBIT_SOURCE_UNAVAILABLE field snapshot; workbook has no ETag, GET none → 200 null, limit 1,048,576 bytes — spec silent — cost if wrong: small API tweak
- Task 3: Ruling (correction of my earlier "groups []"): thbk-gnss template creates groups "GPS sats", "GLONASS sats", "Galileo sats", "BeiDou sats" with each system's satellite paths as members — workspace §7 says template scenarios have one folder per system and spec §5.1 example + Task 4 test_tree_shape expect "GPS sats" ⊇ */Satellite/G01 — cost if wrong: one template block
- Task 3: Ruling: accept implementer's STK Literal sets for marker_style/line_style/visible_sides (not in repo docs) — UI (sub-project 3) will take allowed values from the server schema/OpenAPI so one source — cost if wrong: one Literal edit
- Task 3: Ruling: animation update_mode/cycle use spec §5.1 lowercase codes; UI shows STK display words — spec example is binding over display labels — cost if wrong: rename codes
- Task 3: Ruling: Save As copy drops `daily` (copy is not a daily product) — keeps retention/scheduler from adopting copies — cost if wrong: one line
- Task 4: Ruling: fixtures s1 (thbk-gnss S1, snapshot 20261110T0000Z, 2026-11-10 00-06Z) and s_empty live in conftest.py for reuse — cost if wrong: none
- Task 4: Ruling: results_stale = any of {propagate hash, analyze hash per Facility} differs before vs after; NoSatellitesError counts as a comparable sentinel; snapshot missing/plan error → true — brief + spec §6.4 — cost if wrong: an extra/missed stale badge
- Task 4: Ruling: Insert Default for Facility (P6) and Constellation only; Satellite → 422 field method (use From Satellite Catalog); any name collision → 409 NAME_EXISTS, nothing written; norad not in catalog → 422 field norads; custom constellation of mixed systems → system null (schema may make system optional) — spec silent — cost if wrong: small API change
- Task 4: Ruling: delete Facility removes accesses from it; delete object removes it from to-lists/groups/assigned_objects; an access left with empty `to` is removed; deleting a Constellation keeps its satellites — STK semantics — cost if wrong: one rule
- Task 4: Ruling: tree is cheap (no catalog build): satellites under their group folders, ungrouped at root; flags/hidden come from /catalog (Task 7) joined by the client — keeps GET /objects fast — cost if wrong: add fields later
- Task 4: Ruling: POST /groups {name, members} creates or sets a group; a satellite moved into a group leaves other groups (tree folders) — spec "New Group / move members" — cost if wrong: one rule
- Task 4: Ruling: carry reviewer minor #1 (≈1 s plan cost on every edit incl. colour/Show toggles) into Task 8 as a requirement: short-circuit results_stale=False when the engine-relevant projection (load_scenario EngineScenario fields) is unchanged, and cache fingerprints by (scenario, etag) — user-visible lag on the most common edits — cost if wrong: small extra code in plans.py
- Task 5: Ruling: PUT /scenarios/{sc} publishes scenario event with results_stale from the same plans fingerprint; create/copy publish results_stale false; delete publishes {name, etag: null, results_stale: false}; workbook writes publish nothing — brief says store+object routes publish after write; spec event shape {name, etag, results_stale} — cost if wrong: event field tweak
- Task 5: Ruling: per-subscriber asyncio.Queue maxsize 1000 (drop + log on overflow); SSE sends an immediate ping on connect; ping interval injectable for tests — P4 + spec §8 — cost if wrong: none
- Task 5: Ruling (revises my earlier PUT ruling): PUT /scenarios/{sc} returns the saved doc unchanged; results_stale goes in response header `X-Results-Stale: true|false` and in the SSE scenario event — doc shape must stay the scenario.json schema — cost if wrong: client reads a header
- Task 6: Ruling: job result = {"path": <bundle path relative to data_dir>} plus kind keys (fetch: {"snapshot"}; analyze: {"facility"}); engine messages go to job.messages AND the global message log (events.message) — spec silent — cost if wrong: field rename
- Task 6: Ruling: stale-pgid safety — child clears pgid (sends ("gmat_pgid", None)) when progress leaves stage "gmat" and when run_* returns/raises; cancel = set cancel_requested → killpg(pgid) if known → terminate child → drain late ("gmat_pgid", n) and killpg it — Task 1 review notes — cost if wrong: none
- Task 6: Ruling: progress job events throttled to ≤4/s per job, always on stage change/state change — spec silent — cost if wrong: UI smoothness
- Task 6: Ruling: re-grade reviewer Minors 1,2,3,4,6 to Important by effect — 1: child SIGKILLed mid-write hangs the queue thread forever (all later jobs stall) → ctx.Pipe(duplex=False) + close parent writer; 2: _loop crash fallback leaves child running (breaks single queue); 3: cancel-within-2s test never measures the bound (t0 after blocking cancel) = assertion gap; 4: sleep-synchronised test = flaky; 6: malformed record (non-str created_utc) aborts startup — cost if wrong: small extra fix work
- Task 6: Ruling: fold Minor 7 (check cancel_requested before runner.start) into the same round — 2-line fix on the same path — cost if wrong: none
- Task 7: Ruling: /api/catalog defaults — snapshot omitted → newest; start omitted → snapshot time; stop omitted → start + 1 day; system filter accepts one of G/R/E/C (else 422 field system) — spec silent — cost if wrong: param defaults
- Task 8: Ruling: /results — ephem.hash from plan_propagate; available = hash dirs on disk; status current (hash ∈ available) / stale (available non-empty, hash ∉) / missing (none); plan failure → hash null, status missing, error {code,text} (snapshot gone → ORBIT_SOURCE_UNAVAILABLE, no satellites → NO_SATELLITES); access per Facility the same with plan_analyze — spec §6.5 + Review Focus 5 — cost if wrong: status wording
- Task 8: Ruling: file routes accept only §6.5 names, hash `^[0-9a-f]{12}$`-style safe names, facility name regex; ETag = quoted full SHA-256 cached by (path,size,mtime_ns); content types czml/json → application/json, sp3 → text/plain, csv → text/csv — cost if wrong: header tweak
- Task 8: Ruling: re-grade reviewer Minor 1 to Important — graphics-only edit short-circuit doesn't seed the PlanCache for the new etag, so the next /results (UI refetch on scenario event) still pays ~1 s, defeating the carried Task 4 requirement — fix: copy old-key entry to new etag on the short-circuit path + test — cost if wrong: a few lines
- Task 9: Ruling: intervals response = {<satellite object name>: [intervals]} — object name → norad (scenario) → PRN (ephem manifest satellites) → intervals.json["intervals"][prn]; Constellation expansion skips hidden (manifest propagated false); a directly targeted hidden satellite keeps its key with [] — spec §6.6 + pre-flight row (key per target) — cost if wrong: response shape
- Task 9: Ruling: compute/clear/remove are scenario edits → require If-Match and go through tracking.write_tracked (ETag header + etag in body); compute sets computed true in both 200 and 202 paths; clear sets false; access identity = (normalized from, to list as stored) — global "every edit sends If-Match" — cost if wrong: client sends a header
- Task 9: Ruling: new error code RESULTS_NOT_CURRENT (409) for intervals when the facility's access bundle is not current — spec §10 has no code for it — cost if wrong: code rename (add to spec §10 in Task 12 docs)
- Task 9: Ruling: expand_targets returns satellite names (not paths) — they are the response keys and no other consumer exists — cost if wrong: one line
- Task 9: Ruling: access identity = (from, set(to)) — reordering targets doesn't change the access's meaning — cost if wrong: one comparison
- Task 9: Ruling: re-grade reviewer Minor 2 to Important — partial `graphics` on compute resets other fields to defaults and drops custom_color (silent loss of user settings) — merge exclude_unset into existing entry — cost if wrong: a few lines
- Task 9: Ruling: time_period stays whole-object replace when sent (mode/start/stop belong together) — avoids stale start/stop under mode object — cost if wrong: none
- Task 10: Ruling: Settings bounds not in spec — validation_retry_hours 1–168, validation_give_up_days 1–365, facility must match object-name regex; missing settings.json → defaults; corrupt → defaults + warning log (never crash); GET returns stored settings verbatim incl. cesium_ion_token (local 127.0.0.1 only) — cost if wrong: bound tweak
- Task 10: Ruling: settings PUT calls app.state.settings_on_change(new_settings) (no-op default) — pre-flight ruling, Task 11 wires the scheduler — cost if wrong: one param
- Task 10: Ruling: GET /validation/{sc}/{day}: day YYYY-MM-DD; look in current ephem bundle, then data/validation/<sc>/, else 404 — spec §6.8 + brief — cost if wrong: lookup order
- Task 12: Ruling (user constraint: never re-download from CelesTrak without asking): local run must pre-write settings.json with daily.enabled=false and copy an existing snapshot (data/orbits/20261110T2147Z) into the scratch data dir; no POST /orbits/fetch — cost if wrong: none
- Task 10: Ruling: missing settings.json → §9.1 defaults (enabled true = user-approved daily automation B); corrupt/invalid file → defaults but daily.enabled=false (fail safe), warning logged once per file mtime; load accepts utf-8-sig and ignores unknown keys (PUT stays strict) — user consent on CelesTrak downloads — cost if wrong: daily job stays off until the user saves settings
- Task 10: Ruling: PUT /settings requires every field (422 on missing) — "whole document" decision — cost if wrong: client sends full doc (it does)
- Task 10: Ruling: fold reviewer Minors 2 (lock around save+callback) and 3 (warn once per mtime) into fix round — both touch the consent path / Task 11 tick log spam — cost if wrong: none
- Task 10: Ruling → Task 11 requirement: scheduler re-reads settings.load() every tick (callback is only a nudge) — reviewer Minor 1 — cost if wrong: none
- Task 10: Ruling: tighten (c) — an existing settings.json without an explicit boolean daily.enabled fails safe to enabled=false (+warn once); other missing fields still default — PUT always writes enabled, so only hand-edited/typo files hit this; user consent on CelesTrak — cost if wrong: daily job stays off until saved
- Task 11: Ruling: forecast tick submits for D (= today+1 UTC) only if no daily job for D is succeeded, queued/running, or failed with a code other than INTERRUPTED (or data/daily/thbk_gnss_pred_<D>_24h.csv already exists) — brief's literal rule would retry a failed daily every 60 s (CelesTrak/GMAT hammering); spec §9.2 says a failure waits for the next day; Review Focus 4 needs INTERRUPTED to re-run — cost if wrong: one condition
- Task 11: Ruling: daily job params = {"for_date": "YYYY-MM-DD"} (jobs.submit validation updated); child loads settings itself; result {"path": "daily/thbk_gnss_pred_<YYYYMMDD>_24h.csv", "scenario": "daily_<YYYYMMDD>"}; scheduler re-reads settings.load() every tick; settings_on_change only wakes it; tick also calls jobs.prune(now) once per UTC day; /api/health daily = scheduler status (replaces Task 2's null) — cost if wrong: small
- Task 10: Ruling: fail-safe load also drops other valid hand-written values (e.g. cesium_ion_token) like the corrupt path; file on disk untouched + log warning — consistent single rule — cost if wrong: UI GET→PUT could overwrite a hand-written token (note for sub-project 3: surface settings provenance/fail-safe state)
- Task 11: Ruling: a cancelled daily job for D also blocks resubmission (user pressed Stop; otherwise restarts within 60 s) — cost if wrong: one condition
- Task 11: Ruling: give-up applies to ANY failure once now > for_date + validation_give_up_days (spec §9.4 "ยังไม่ได้ … ไม่ลองอีก"), not only TRUTH_UNAVAILABLE as the brief says — spec is binding; stops endless 3-hourly CDDIS/MGEX retries — cost if wrong: earlier give-up on a fixable error (user can re-validate manually)
- Task 11: Ruling: disabled daily also skips validation (network) and retention — accept — cost if wrong: old daily bundles kept while disabled
- Task 11: Ruling: re-grade reviewer Minors 3 (archive can drop a validation file then rmtree), 4 (retention deletes user-run results on old daily scenarios within 60 s → only delete bundles older than cutoff by mtime), 5 (non-ApiError from submit loses last_attempt → SP3 download attempt every minute) to Important — data loss / network hammering — cost if wrong: small extra code
- Task 11: Ruling: fold trivial Minors 6 (skip symlinked validation files), 8 (give-up deadline counts from D+1 00:00Z per §9.4 "N days after that day"), 9 (stop() keeps _thread if join timed out) into the round — cost if wrong: none
- Task 11: Ruling: "validated" = validation file in archive or ANY ephem bundle (cheap steady state) — scheduler-created daily periods are fixed by name, so cross-period files can't arise via scheduler; user re-runs aren't auto re-validated — cost if wrong: manual validate after editing a daily scenario
- Task 12: Ruling: re-grade doc Minors 1 (criterion-5 `ls data/daily/` wrong relative path from server/), 2 ($GNSS_STUDIO_DATA/settings.json expands to /settings.json when unset), 4 (no instruction to cancel an already-submitted daily job via POST /api/jobs/{id}/cancel) to Important — a user following the README fails / has no recovery — fold into the final fix wave — cost if wrong: doc edits
- Final: Ruling: I1 → TrustedHost (127.0.0.1, localhost, configured host) + reject non-GET/HEAD with foreign Origin (403) + warn on non-loopback host (M12) + README consent claim corrected — consent rule — cost if wrong: a non-browser client must send a proper Host
- Final: Ruling: I2(a) → POST /api/daily/run {for_date?} (origin user, same validation/blocking except it may re-run a failed/cancelled/interrupted day on explicit request) + test restart after 00:00 UTC documents behaviour; I2(b) (auto catch-up for today when started before run_at) NOT implemented — widens automatic CelesTrak fetch window, needs the user's consent → asked in final report; README §8.3 explains the window (21:00 UTC = 04:00 Thai time) and the manual endpoint; spec §9.3 amended — cost if wrong: user runs the endpoint by hand
- Final: Ruling: deferred-minor triage — fix now: dangling settings.json symlink fails safe; GET /validation/{sc}/{day} falls back to any ephem/*/validation_<day>.json newest first (M3, aligns with scheduler); POST /groups requires members; jobs.active_for counts a daily job for daily_<for_date> (M1); daily refuses to overwrite an existing scenario without a `daily` block and marks the analyzed access computed (M2 part); spawn-dependent waits in process tests → 20 s (flake) — cost if wrong: small
- Final: Ruling: docs — README 3 queued items + catch-up window/Thai time + manual run + cancel; spec: Python ≥ 3.11 (M14), §6.7 moved to sub-project 4 (M15), §9.3 wording, daily.facility must be THBK for the thbk-gnss template (M7 doc) — cost if wrong: doc edits

## 2. ข้อค้างเล็กที่เลื่อนไว้ (minor, deferred)

- Task 1: minor (deferred): hooks forwarded only when not None (propagate.py:71, studio.py:389) to spare old test fakes — fix fakes, forward unconditionally
- Task 1: minor (deferred): test_on_start_group_can_be_killed could pass via 10 s timeout; assert exit -15 / separate pgid
- Task 1: minor (deferred): test_progress_exception_leaves_no_bundle raises at "gmat" only (pre-write); add a "write" stage case
- Task 1: minor (deferred): run_gmat timeout path os.killpg unguarded (ProcessLookupError race when server also killpg's) — reuse _kill_group
- Task 1: minor (deferred): plan_analyze loads scenario.json twice (mirrors run_analyze)
- Task 1: minor (deferred): lambda assignment / use_hooked_gmat naming in test_studio_cli.py
- Task 2: minor (deferred): SPA fallback serves index.html for missing asset paths with extensions (/assets/x.js)
- Task 2: minor (deferred): web_dist existence decided once at create_app (rebuild needs restart) — add comment
- Task 2: minor (deferred): RequestValidationError field from loc may be a char offset for malformed JSON
- Task 2: minor (deferred): per-app unregistered logger — later modules must use app.state.logger (consider get_logger dependency)
- Task 2: minor (deferred): test_app.py pytest.raises(Exception) → FrozenInstanceError; traversal test should assert 200 + index.html; exc.errors() called twice
- Task 2: minor (deferred): errors._detail_text json.dumps fails on non-str dict keys (escapes handler → plain 500)
- Task 2: minor (deferred): tautological assertion tests/test_app.py:305
- Task 3: minor (deferred): copy keeps accesses[].computed true though access/ results not copied — Task 9 status must derive from files/hash, not the flag
- Task 3: minor (deferred): duplicated tmp-write-replace in store._write_atomic/_commit
- Task 3: minor (deferred): read_workbook swallows all OSError (PermissionError) → narrow to FileNotFoundError+ValueError
- Task 3: minor (deferred): _scenario_names scandir on every request (linear in scenarios)
- Task 3: minor (deferred): unreachable isinstance(dict) checks in write_workbook/validate_scenario
- Task 3: minor (deferred): test polish test_scenarios.py lines 185,189,221,302,499; strict=True rejects 30.0/"62339" (note for web client); AccessTimePeriod specify w/o start/stop, DailyInfo.for_date unchecked
- Task 3: minor (deferred): template emits empty "X sats" folder + constellation for a system absent from the snapshot
- Task 3: minor (deferred): group-name uniqueness not whitespace-normalised ("GPS sats " vs "GPS sats")
- Task 4: minor (deferred): "before" fingerprint computed before change(doc) (wasted on 404/409/422); "after" read outside lock
- Task 4: minor (deferred): mixed-system create_constellation colour #cccccc + inherit true → new sats render grey in tree
- Task 4: minor (deferred): POST /groups omitting members empties the group
- Task 4: minor (deferred): validate_object duplicates to_api_error lines; routes/objects imports private _etag_header; If-Match→"" workaround duplicated
- Task 4: minor (deferred): test helpers (ERROR_KEYS, THAI, assert_error, file_bytes) copied between test_objects/test_scenarios
- Task 4: minor (deferred): Review Focus 1 test loose (404/405/422); Constellation assigned_objects accepts non-satellite paths; set_group name unbounded/unstripped; s_empty also named S1
- Task 5: minor (deferred): Ctrl-C with an open SSE tab prints "timeout graceful shutdown exceeded" + ~60-line CancelledError traceback (fix idea: uvicorn.Server subclass closing bus subscribers in handle_exit)
- Task 5: minor (deferred): ping only after 15 s of silence, not every 15 s
- Task 5: minor (deferred): dropped events (queue overflow) give the client no resync signal
- Task 5: minor (deferred): /messages?since loses same-millisecond messages (spec-shaped API; seq would fix)
- Task 5: minor (deferred): json default=str / NaN in SSE frames; publish_scenario placement; level unvalidated; triple cleanup mechanism; fingerprint before validation in PUT; subscribe() is sync returning async iterator (callers must not await it)
- Task 5: minor (deferred): server spec §6.4 line 190 should mention PUT /scenarios uses X-Results-Stale header (doc update, fold into Task 12 docs)
- Task 6: minor (deferred): throttled progress has no trailing flush (stale fraction if engine goes quiet)
- Task 6: minor (deferred): prune only at start — Task 11 scheduler must call jobs.prune daily
- Task 6: minor (deferred): jobs.py 666 lines (runners could move to runners.py); no test of cancel-before-handle path or child SIGTERM GMAT kill alone
- Task 6: minor (deferred): _get's except→None makes post-exit drain stop at an unpicklable frame (reported as crash); reader fd held until GC if terminate() raises before messages()
- Task 6: minor (deferred): spawn on POSIX keeps one resource_tracker helper process alive
- Task 7: minor (deferred): third copy of "GREC" default (orbits.DEFAULT_FETCH_SYSTEMS vs jobs.SYSTEM_LETTERS vs worker.DEFAULT_SYSTEMS)
- Task 7: minor (deferred): catalog omm_epoch in ms (truncated) vs bundle whole seconds — decide one precision for the web client
- Task 7: minor (deferred): /catalog builds all systems + reads brdc on every call (per-keystroke search slow) — cache or systems arg
- Task 7: minor (deferred): no test for impossible-date folder via /catalog default; file-at-snapshot-path untested; test nits (unused data_dir, conditional-expression statement)
- Task 8: minor (deferred): shortcut proxy = snapshot folder exists (hollow folder → graphics edit says not stale while /results errors)
- Task 8: minor (deferred): snapshot identity one level deep (in-place nested edits with same size/mtime unseen; snapshots immutable by design)
- Task 8: minor (deferred): scenario deleted mid-edit → engine_view FileNotFoundError → 500 (narrow race)
- Task 8: minor (deferred): test nits test_results.py:421 (min-el 10 no-op), :317 pin 422, :302 ".."/"." normalised by httpx, thread-safety test proves no-crash only; `hash` shadows builtin; write_tracked takes store+plans; engine_view/_commit temp+load_scenario near-duplicate
- Task 8: minor (deferred): carry_over old_key read separately from compared bytes (A→B→A ABA could seed wrong plan; needs 3 writers in a window)
- Task 8: minor (deferred): test_graphics_edit_does_not_seed_the_cache_when_the_snapshot_changed never reaches carry_over (name overstates)
- Task 9: minor (deferred): body validation (422) precedes 404/412 on access routes unlike siblings — docstring corrected in fix round, behaviour left
- Task 9: minor (deferred): third copy of If-Match read/check (objects._edit, scenarios.put, access._checked) → tracking.edit helper; _read_json repeats results._send containment → safe_bundle_path
- Task 9: minor (deferred): compute ignores hidden when manifest unreadable (intervals 409s); clip start floored to ms; legacy specify without start → KeyError if read unvalidated; access.py imports iso_ms from jobs; trivial openapi/body tests
- Task 9: minor (deferred): explicit "custom_color": null now stored as null (schema allows; untested)
- Task 10: minor (deferred): scenario-name error field differs (POST validate "scenario" vs GET day "name"); third containment-check variant (validation/access/results) + jobs._write own tmp-replace; plans.get non-ApiError → 500 instead of falling back; corrupt day file → 404; test weaknesses (in (404,422), traversal test, roundtrip test, DAY_RECORD lacks truth_file)
- Task 10: minor (deferred): dangling settings.json symlink treated as missing (enabled true); PUT lock held during callback (keep Task 11 callback quick)
- Task 11: minor (deferred): SSE daily lags ≤60 s (completion hook → wake()); given_up grows unbounded in state.json; Scheduler.status() used only by a test
- Task 11: minor (deferred): GET /validation/{sc}/{day} reads only current bundle/archive (may 404 where scheduler sees validated); un-archivable bundle logs error every tick; partial archive bumps mtime; daily_scenarios outside _guarded; give_up_days > retention_days → retention may delete before give-up (regen via GMAT); jobs.list deep-copied 3×/tick; archive follows symlinked data/validation/<sc>/
- Task 12: minor (deferred): README run-on at :379; 8.7 starting dir unstated, health output trimmed (free_bytes), poll output from unshown script, local-only snapshot id; integration teardown doesn't check stray GmatConsole; 8.6 point-in-time test counts
- Final: minor (deferred): M4 hand-edited scenario.json → 500 on reads; M5 NO_SATELLITES not 422 on POST /propagate; M6 DELETE scenario without If-Match / no If-Match * or lists; M8 mixed second/ms precision (settle in sub-project 3 spec); M9 orphaned child+GMAT after server SIGKILL; M10 snapshots/SP3 never pruned; M11 no request body size limit; M13 duplicated helpers (containment ×5, If-Match ×3, GREC ×4, tmp-replace ×3, ephem/access names); M2 rest (no scenario SSE after daily rewrite)

## 3. เหตุการณ์ระหว่างลงมือ

- INCIDENT 09:20-09:32: a peer session (gpredict-web) ran `checkout -b feature/gpredict-web-core` in the main worktree; 45f224f landed on that branch; peer reset feature/gnss-studio-server to 45f224f at 09:32 and moved to .worktrees/gpredict-web (its branch now based on 45f224f). Verified: feature/gnss-studio-server = 0b6345b..6ccd1ee intact, HEAD on it, controller ran server suite → 224 passed -W error.
- FLAKE watch: tests/test_jobs_process.py::test_stop_kills_running_job_and_marks_it_interrupted failed once in Task 8 implementer's full-suite baseline; controller ran it alone 12× → 0 fails (likely load-timing) — final review must check its time bounds
