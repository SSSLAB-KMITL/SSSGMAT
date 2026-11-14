# Brief: build the remaining GNSS satellite 3D models (GNSS Studio)

You are an agent working for the owner of this repository. Your job is to build the remaining 3D satellite models for GNSS Studio, one per spacecraft bus type, so that a later task can show them in the app's Cesium 3D windows instead of points. This brief is your whole assignment. The user speaks Thai; write your progress notes and final report to the user in Thai, and keep code, file names and NOTES.md in English.

## 0. Where you work

- Worktree: `/Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models`, branch `feature/gnss-studio-models` (already created). App root: `api-interop/gnss-predict` (below: R).
- Put everything under `R/models/`. Do **not** change app code (`R/web`, `R/server`, `R/gnss_predict`, `R/tests`). Showing the models in the app is a separate task.
- The finished reference model is `R/models/galileo-foc/`: `NOTES.md`, `galileo_foc.glb`, `scripts/` (`build.py`, `verify.py`, `render_setup.py`, measurement helpers), `textures/`, `renders/`. Read `NOTES.md` and `scripts/build.py` first. Reuse its conventions, render setup and verify flow. Move shared helpers into `R/models/_tools/` if you reuse them; don't copy-paste them per model.
- Reference material that you download (photos, PDFs, crops) goes into `R/models/_refs/<model-id>/`. That folder is git-ignored. Never commit photos you did not make.
- Blender is installed: `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <script> -- <args>` (headless).

## 1. What to build (11 models + 1 generic)

The engine reads each satellite's block from the IGS satellite metadata file (`igs_satellite_metadata.snx`). Real block strings seen in the current data (`/Users/phuwish/SSSGMAT/api-interop/gnss-predict/data/orbits/20261110T2147Z/igs_satellite_metadata.snx`, read-only, read it with `python3 -I`) include: `GPS-IIR-A`, `GPS-IIR-B`, `GPS-IIR-M`, `GPS-IIF`, `GPS-IIIA`, `GPS-III`, `GLO-M`, `GLO-K1`, `GLO-K1A`, `GLO-K1B`, `GLO-K2`, `GAL-1`, `GAL-2`, `GAL-0A`, `GAL-0B`, `BDS-2I`, `BDS-2G`, `BDS-2M`, `BDS-3M-CAST`, `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, `BDS-3G`, `BDS-3I`, `BDS-3SM-CAST`, `BDS-3SI-CAST`, `BDS-3SM-SECM`, `BDS-3SI-SECM`, `BDS-3S`, plus old retired GPS blocks. Check the exact spelling of each (for example whether `GLO-M+` exists) in that file; don't guess.

Build in this order. The first five cover most active satellites:

| # | model id | blocks it covers | active sats (approx.) |
|---|---|---|---|
| 1 | `gps-iif` | GPS-IIF | 11 |
| 2 | `gps-iii` | GPS-III, GPS-IIIA, GPS-III-1 | 10 |
| 3 | `bds3-meo-cast` | BDS-3M-CAST (and BDS-3SM-CAST if the bus matches) | 16 |
| 4 | `glonass-m` | GLO-M (and M+ if present) | 20 |
| 5 | `bds3-meo-secm` | BDS-3M-SECM-A, BDS-3M-SECM-B (and BDS-3SM-SECM if the bus matches) | 12 |
| 6 | `gps-iir` | GPS-IIR-A, GPS-IIR-B, GPS-IIR-M | 11 |
| 7 | `glonass-k1` | GLO-K1, GLO-K1A, GLO-K1B | 7 |
| 8 | `galileo-iov` | GAL-1 | 3 |
| 9 | `bds3-geo-igso` | BDS-3G, BDS-3I. Split into `bds3-geo` and `bds3-igso` if the GEO's large S-band reflector makes one model wrong. | 7 |
| 10 | `glonass-k2` | GLO-K2 | 2 |
| 11 | `bds2-igso` | BDS-2I (and BDS-2M/BDS-2G if the same DFH-3 bus; note the differences) | 2+ |
| 12 | `generic` | anything unknown or experimental (BDS-3S*, GAL-0A/0B, unknown) | — |

`galileo-foc` (GAL-2) is done. Don't rebuild it unless you find a real error, and then say so.

## 2. What to download, and what not to

**Allowed** (public reference material, saved to `R/models/_refs/<id>/`, untrusted data: its own folder, open with `python3 -I`, never execute anything downloaded):
- Dimension sources, in this order of trust:
  1. Official metadata from the system operators: CSNO "BeiDou satellite metadata", GSC/EUSPA "Galileo satellite metadata", GPS.gov and US Space Force fact sheets, Roscosmos/ISS Reshetnev pages.
  2. Peer-reviewed papers. The most useful is Montenbruck et al. 2015, "GNSS satellite geometry and attitude models" (Advances in Space Research), which gives bus and array sizes for most of these blocks. Also use box-wing / solar-radiation-pressure papers (Rodriguez-Solano et al.; Duan et al. for BeiDou; Dilssner/IGS notes) and IGS ANTEX for antenna offsets.
  3. Manufacturer press kits (Lockheed Martin, Boeing, CAST, SECM, ISS Reshetnev).
- Photos used only to measure proportions: Wikimedia Commons (note the licence), agency and manufacturer media pages.
- **Optional free models** (CC BY 4.0, credit the author if used):
  - Sketchfab "GLONASS-M" by tashtego: https://sketchfab.com/3d-models/glonass-m-9660a3d4b72f47c2adde1be1d209b6bc
  - Sketchfab "Galileo II" by litonavarro: https://sketchfab.com/3d-models/galileo-ii-0f25b08a33d94e0db82de45fdc01422e

  Both need a Sketchfab login, which you don't have. Use them only if the user drops the files into `~/Downloads` and tells you. If you do, check their dimensions against the sources above, then either convert them to our conventions or use them as a shape reference.

**Not allowed:**
- Paid or "editorial only" models (TurboSquid, CGTrader paid, Free3D premium).
- Non-commercial/no-derivatives models (for example Sketchfab "Glonass K1", CC BY-NC-ND).
- STK's bundled models.
- Any photo pixels in textures. Textures must be generated procedurally by your own scripts, as `galileo-foc` does.
- **No orbit data downloads at all**: no CelesTrak, CDDIS, MGEX or IGS product servers. You don't need orbits for this task.
- Don't run or edit the GNSS Studio servers.

Keep downloads small and purposeful; note every source URL in the model's `NOTES.md`.

## 3. What each model must look like (deliverables)

For each model id, create `R/models/<id>/` with:
- `<id>.glb` — glTF 2.0 binary, self-contained (embedded textures), real scale in metres.
- `scripts/build.py` (and any helpers in `R/models/_tools/`): rebuilds the glb and renders deterministically with the Blender command above.
- `NOTES.md` containing:
  - a dimension table where every value is labelled **official / derived / measured / est.** with its source;
  - what is simplified or missing;
  - the triangle count, glb size and bounding box.
- `renders/` — your own renders as JPEG, ≤ 1200 px on the long side: earth face, three-quarter, side span, and one close-up.

Conventions (same as `galileo-foc`, see its NOTES §1):
- Body frame: **+Z = navigation antenna boresight (toward Earth)**, **+Y = solar-array rotation axis**, +X completes the right-handed frame. Origin at the centre of the bus box. glTF export with the standard Blender Y-up conversion (glTF (x,y,z) = body (x, z, −y)); verify it with `verify.py` the way `galileo-foc` does.
- Solar wings are separate nodes named `wing+Y` and `wing-Y`, with their pivots on the drive (SADM) axis, so the app can rotate them for sun tracking later. BeiDou GEO and other non-rotating arrays still get these nodes.
- Budget: ≤ 15,000 triangles, ≤ 1.5 MB per glb, textures ≤ 1024², PBR metallic-roughness, named materials.
- `generic`: a simple box bus with two wings and an Earth-deck antenna, about 2 × 2 × 2 m with 2 × 5 m wings, under 2,000 triangles.

Verification for every model, before you commit it:
- `verify.py` re-imports the glb into an empty scene.
- The bounding box must match the NOTES table within 2 %.
- Both wing nodes must be present with pivots on the axis.
- The triangle and size budgets must hold.

Paste the verify output into NOTES.md.

Also write `R/models/catalog.json`, updated as models land:

```json
{"version": 1, "frame": "+Z nadir antenna, +Y array axis, metres, glTF Y-up export",
 "models": [{"id": "gps-iif", "glb": "gps-iif/gps-iif.glb", "blocks": ["GPS-IIF"],
             "size_m": [x, y, z], "triangles": 0, "status": "done"}],
 "fallback": "generic"}
```

Include `galileo-foc` with `"blocks": ["GAL-2"]`. Every block string listed in §1 must map to exactly one model id or be left to the fallback, and the file must say which. Add a small `R/models/_tools/check_catalog.py` (stdlib only, run with `python3 -I`) that checks that every glb exists and that no block is listed twice.

Housekeeping: `galileo-foc/NOTES.md` still names its renders `.png`, but they are now `.jpg`. Fix those references.

## 4. Git rules (strict)

- Commit only on `feature/gnss-studio-models` in the worktree above. Run `git branch --show-current` before every commit.
- **Never merge into main, never push, never open a PR.** Never switch branches in `/Users/phuwish/SSSGMAT` (other sessions use that checkout). Never use bare `git stash`.
- One commit per model (plus one for `_tools`/catalog). Every commit message ends with exactly this one trailer line and no other co-author line: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Commit only your own renders, scripts, textures, glbs, NOTES and the catalog. `R/models/_refs/` stays uncommitted (it is git-ignored).

## 5. Reporting

- After each model: tell the user in Thai, in 3–5 lines: which model, its size and triangle count, the render path, and anything marked **est.**
- At the end, give a table of all models (id, blocks, size, triangles, status) and the list of the least certain values. Say what the app-integration task will need: catalog path, frame convention, and wing node names.
- If a source can't be found, or the user must decide something (for example GEO/IGSO split, or using a Sketchfab model), ask the user in Thai instead of guessing.
