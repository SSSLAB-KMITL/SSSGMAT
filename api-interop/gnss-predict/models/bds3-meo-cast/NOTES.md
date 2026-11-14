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
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.030, 0.000)` m) and `wing-Y` (pivot `(0.000, -1.030, 0.000)` m) with identity rotation so the host app can rotate them about `Y` for sun tracking.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `BDS-3M-CAST`, `BDS-3SM-CAST` | **official** | `igs_satellite_metadata.snx` (`C019–C024`, `C032–C033`, `C036–C037`, `C041–C042`, `C045–C046`, `C048–C049` as `BDS-3M-CAST`; `C057–C058` as `BDS-3SM-CAST`, all sharing `LRA_BDS_NCRIEO_38` and CAST bus geometry). |
| **Launch mass** | `~1010 kg` | **official** | CSNO *BeiDou Navigation Satellite System Open Service Performance Standard / Satellite Metadata* (2019); Zhao et al. (2022) / Steigenberger & Montenbruck (2020). |
| **Bus length (`X_B`)** | `1.88 m` | **official** | CSNO BDS-3 MEO CAST box-wing metadata (`Z` panel area `3.05 m² = 1.88 × 1.62 m`; `Y` panel area `2.70 m² = 1.88 × 1.44 m`). |
| **Bus width (`Y_B`)** | `1.62 m` | **official** | CSNO BDS-3 MEO CAST box-wing metadata (`X` panel area `2.33 m² = 1.62 × 1.44 m`). |
| **Bus height (`Z_B`)** | `1.44 m` | **official** | CSNO BDS-3 MEO CAST box-wing metadata (`Z ∈ [-0.72, +0.72]` m). |
| **Solar array area (`A_sa`)** | `14.12 m²` total (`7.06 m²` per wing) | **official** | CSNO BDS-3 MEO CAST box-wing metadata (`7.06 m²` per wing). |
| **Solar wing configuration** | `2 wings`, `2 panels/wing` (`3.00 × 1.18 m` per panel) | **derived** | Derived from `A_wing = 7.06 m²` (`2 × 3.00 × 1.18 = 7.08 m²`, within `0.3%` of official `7.06 m²`) and CAST BDS-3 MEO cleanroom photographs. |
| **SADM pivot offset (`|Y_pivot|`)** | `1.030 m` | **derived** | `Y_B / 2 + 0.22 m` SADM drive housing clearance (`0.81 + 0.22 = 1.03 m`). |
| **Total deployed wing span (`Y`)** | `14.460 m` | **derived** | `2 × (1.030 + 1.040 yoke + 2 × 3.000 + 0.080 hinge + 0.080 tip) = 14.460 m`. |
| **Navigation phased-array aperture** | `Ø1.16 m` circular array (`20` helical elements: `1` central + `7` inner + `12` outer) | **measured** | Measured from CSNO / CAST official BDS-3 MEO spacecraft renderings and cleanroom photographs (`Z = +0.72` to `+0.925 m`). |
| **Inter-Satellite Link (ISL) Ka-band phased array** | `0.58 × 0.58 × 0.14 m` at `(-0.38, +0.42, +0.79) m` | **measured** | Stepped Ka-band phased-array transceiver on the Earth-facing (`+Z`) deck for BDS-3 crosslink ranging and communication. |
| **Laser Retroreflector Array (`LRA_BDS_NCRIEO_38`)** | `38` corner-cube prisms (`0.38 × 0.28 m` tray) at `(+0.593, -0.087, +0.750) m` | **official** | Prism count (`38`) and horizontal eccentricity `(+0.5933, -0.0870)` m from `igs_satellite_metadata.snx` (`LRA_BDS_NCRIEO_38`). |
| **Overall bounding box (`X × Y × Z`)** | `1.970 × 14.460 × 1.955 m` | **derived** | From `X`: bus + end-plate louvers (`1.970 m`); `Y`: deployed wing span (`14.460 m`); `Z`: `-Z` launcher ring (`-1.030 m`) to `+Z` antenna tips (`+0.925 m`). |

---

## 3. Simplifications & Omissions

- The 20-element L-band navigation phased array uses low-poly cylindrical/conical radome cups rather than helical wire coils to remain well within the triangle budget.
- The 38-prism NCRIEO LRA is represented as an aluminum housing tray (`0.38 × 0.28 m`) with a representative 24-cup corner-cube grid (`6 × 4`).
- `BDS-3SM-CAST` (experimental/smart BDS-3 MEO CAST satellites `C057–C058`) shares the same CAST MEO platform and `LRA_BDS_NCRIEO_38` in `igs_satellite_metadata.snx` and is mapped to this model.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds3-meo-cast/bds3-meo-cast.glb`
- **File size**: `572,780` bytes (`0.546 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `3,230` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `1.9700 × 14.4600 × 1.9550 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
=== VERIFY /Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/bds3-meo-cast/bds3-meo-cast.glb ===
File size       : 572,780 bytes (0.546 MB)
Object count    : 121
Triangle count  : 3230
BBox min (body) : (-0.9850, -7.2300, -1.0300) m
BBox max (body) : (0.9850, 7.2300, 0.9250) m
BBox size (body): (1.9700, 14.4600, 1.9550) m
Materials (11)   : ['Al_Anodized', 'Black_Anodized', 'Copper_Helix', 'Ka_Radome_White', 'LRA_Glass', 'MLI_Black', 'MLI_Gold', 'OSR_Mirror', 'Radome_White', 'Solar_Cell', 'Ti_Dark']
Images (8)      : [('bds3-meo-cast_mli_gold_col.png', (512, 512)), ('bds3-meo-cast_mli_gold_MetRough.png', (512, 512)), ('bds3-meo-cast_mli_gold_norm.png', (512, 512)), ('bds3-meo-cast_osr_col.png', (512, 512)), ('bds3-meo-cast_osr_MetRough.png', (512, 512)), ('bds3-meo-cast_solar_col.png', (512, 1024)), ('bds3-meo-cast_solar_MetRough.png', (512, 1024)), ('bds3-meo-cast_solar_norm.png', (512, 1024))]
Wing node       : wing+Y origin_body=(-0.0, 1.03, 0.0) rot=(0.0, -0.0, 0.0)
Wing node       : wing-Y origin_body=(-0.0, -1.03, 0.0) rot=(0.0, -0.0, 0.0)
VERIFY_STATUS   : PASS
```
