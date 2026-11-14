# BeiDou-3 MEO (CAST) — 3D Model Technical Notes (`bds3-meo-cast`)

Procedural, real-scale 3D model of a **BeiDou-3 MEO satellite manufactured by CAST** (China Academy of Space Technology; IGS blocks `BDS-3M-CAST` and `BDS-3SM-CAST`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.570, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.570, 0.000)` m) with identity rotation so the host app can rotate them about `Y` for sun tracking.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `BDS-3M-CAST`, `BDS-3SM-CAST` | **official** | `igs_satellite_metadata.snx` (`C019–C024`, `C032–C033`, `C036–C037`, `C041–C042`, `C045–C046`, `C048–C049` as `BDS-3M-CAST`; `C057–C058` as `BDS-3SM-CAST`, all sharing `LRA_BDS_NCRIEO_38` and CAST bus geometry). |
| **Launch mass** | `~1010–1014 kg` | **official** | CSNO *BeiDou Navigation Satellite System Open Service Performance Standard / Satellite Metadata* (2019); Guo et al. (2021) / Duan et al. (2022) / Steigenberger & Montenbruck (2020). |
| **Bus dimensions (`X_B × Y_B × Z_B`)** | `1.970 × 1.140 × 1.070 m` (plus `+0.24 m` `+Z` payload bay step) | **derived** | Derived from CSNO BDS-3 MEO CAST official box-wing face areas (`X`-panel `1.22 m² = 1.140 × 1.070 m`, `Z`-panel `2.25 m² = 1.970 × 1.140 m`, `Y`-panel `2.68 m²` including stepped `+Z` bay; Duan et al. 2022 / Guo et al. 2021). Alternative T1/literature dimensions (`1.68 × 1.30 × 1.30 m`; legacy note `1.88 × 1.62 × 1.44 m`) recorded here for traceability. |
| **Solar array area (`A_sa`)** | `20.44 m²` total (`10.22 m²` per wing) | **official** | CSNO *BeiDou Satellite Metadata* / Guo et al. (2021) / Duan et al. (2022) analytical box-wing area for `BDS-3M-CAST` T-shaped bus (`20.44 m²`). Conflicting secondary values (ESA eoPortal `2 × 1.5 × 4.7 m = 14.10 m²`; earlier note `14.12 m²`) recorded as alternatives. |
| **Solar wing configuration** | `2 wings`, `3 panels/wing` (`1.893 × 1.800 m` per panel, `10.222 m²/wing`, `20.444 m²` total) | **derived** | Derived from CSNO official `A_sa = 20.44 m²` using 3 panels/wing (`PANEL_L = 1.893 m ≤ BUS X_B = 1.970 m` so panels stow flush, replacing earlier `2 × 2.840 m` non-stowable panels). |
| **SADM pivot offset (`|Y_pivot|`)** | `0.570 m` | **derived** | `Y_B / 2 = 1.140 / 2 = 0.570 m` (`sadm_+Y/-Y` hub extends `0.120 m` to `±0.690 m`). |
| **Total deployed wing span (`Y`)** | `13.998 m` | **derived / est.** | `2 × (0.570 SADM + 0.120 hub + 0.530 yoke + 3 × 1.893 panels + 2 × 0.050 gaps) = 13.998 m` (reduced from `14.460 m`). |
| **Navigation phased-array aperture** | `Ø0.88 m` circular array (`8` peripheral helical elements + central phased array) | **measured** | Measured from CSNO / CAST official BDS-3 MEO spacecraft renderings and cleanroom photographs (`Z = +0.775` to `+1.055 m`). |
| **Inter-Satellite Link (ISL) Ka-band phased array** | `0.28 × 0.32 × 0.10 m` at `(-0.78, 0.00, +0.825) m` | **measured** | Stepped Ka-band phased-array transceiver on the Earth-facing (`+Z`) deck for BDS-3 crosslink ranging and communication. |
| **Laser Retroreflector Array (`LRA_BDS_NCRIEO_38`)** | `38` corner-cube prisms (`0.20 × 0.24 m` tray) at `(+0.593, -0.087, +0.715) m` | **official** | Prism count (`38`) and horizontal eccentricity `(+0.5933, -0.0870)` m from `igs_satellite_metadata.snx` (`LRA_BDS_NCRIEO_38`). |
| **Overall bounding box (`X × Y × Z`)** | `1.970 × 13.998 × 1.955 m` | **derived** | `X`: `±0.985 m` bus (`1.970 m`); `Y`: deployed wing span (`13.998 m`); `Z`: `-0.900 m` thruster/adapter to `+1.055 m` antenna tips (`1.955 m`). |

---

## 3. Simplifications & Omissions

- The 8-element peripheral L-band helical antennas use low-poly cylindrical/conical radome cups rather than helical wire coils to remain well within the triangle budget.
- The 38-prism NCRIEO LRA is represented as an aluminum housing tray with a representative `6 × 6` staggered corner-cube grid.
- `BDS-3SM-CAST` (experimental/smart BDS-3 MEO CAST satellites `C057–C058`) shares the same CAST MEO platform and `LRA_BDS_NCRIEO_38` in `igs_satellite_metadata.snx` and is mapped to this model.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds3-meo-cast/bds3-meo-cast.glb`
- **File size**: `573,328` bytes (`0.547 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `3,350` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `1.970 × 13.998 × 1.955 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 573328 (0.547 MB)
REIMPORT_TRIANGLES 3350
REIMPORT_BBOX_MIN (-0.985, -6.999, -0.9)
REIMPORT_BBOX_MAX (0.985, 6.999, 1.055)
REIMPORT_BBOX_SIZE (1.97, 13.998, 1.955)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_phased_array', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -0.5699999928474426], wing-Y T=[0, 0, 0.5699999928474426]
EXPECTED_SIZE (1.97, 13.998, 1.955) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

