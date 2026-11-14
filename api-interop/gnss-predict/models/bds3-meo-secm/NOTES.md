# BeiDou-3 MEO (SECM) — 3D Model Technical Notes (`bds3-meo-secm`)

Procedural, real-scale 3D model of a **BeiDou-3 MEO satellite manufactured by SECM** (Shanghai Engineering Center for Microsatellites / Innovation Academy for Microsatellites of CAS; IGS blocks `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, and `BDS-3SM-SECM`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.600, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.600, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, `BDS-3SM-SECM` | **official** | `igs_satellite_metadata.snx` (`C025–C030`, `C034–C035` as `BDS-3M-SECM-A`; `C043–C044`, `C050` as `BDS-3M-SECM-B`; `C059–C060` as `BDS-3SM-SECM`, all carrying `LRA_BDS_SHAO_42`). |
| **Bus face areas (`A_Z`, `A_Y`, `A_X`)** | `2.58 m²`, `2.22 m²`, `1.24 m²` | **official** | CSNO *BeiDou Navigation Satellite System Open Service Performance Standard / Satellite Metadata* (2019); Zhao et al. (2022) / Steigenberger & Montenbruck (2020). |
| **Bus length (`X_B`)** | `2.150 m` | **derived** | Exact rectangular prism solution from CSNO official face areas: `X_B = sqrt(A_Z · A_Y / A_X) = sqrt(2.58 × 2.22 / 1.24) = 2.150 m` (`2.150 × 1.200 = 2.580 m²`). |
| **Bus width (`Y_B`)** | `1.200 m` | **derived** | Exact rectangular prism solution: `Y_B = sqrt(A_Z · A_X / A_Y) = sqrt(2.58 × 1.24 / 2.22) = 1.200 m`. |
| **Bus height (`Z_B`)** | `1.033 m` (`Z ∈ [-0.5165, +0.5165]` m) | **derived** | Exact rectangular prism solution: `Z_B = A_X / Y_B = 1.24 / 1.200 = 1.033 m` (matches `LRA_BDS_SHAO_42` at `Z = +0.6204 m`, i.e., `0.104 m` above the `+Z` deck). |
| **Solar wing geometry** | `2 wings`, `2 panels/wing` (`2.150 × 1.100 m` per panel, `4.73 m²/wing`, `9.46 m²` total) | **est.** | Sized to fold against the `2.150 × 1.033 m` `±Y` bus faces during launch and match SECM microsatellite cleanroom photos. |
| **Deployed wing span (`Y`)** | `11.360 m` | **est.** | `2 × (0.600 SADM + 0.720 yoke + 2 × 2.150 panels + 0.060 gap) = 11.360 m`. |
| **L-band navigation phased array (`+Z`)** | `Ø1.00 m` circular array (`16` helical elements: `4` inner + `12` outer) at `X = -0.360 m` | **measured** | Measured from SECM BDS-3 MEO spacecraft diagrams; extends from `Z = +0.5165 m` to `Z = +0.8165 m`. |
| **Ka-band ISL phased array (`+Z`)** | `0.52 × 0.52 × 0.11 m` at `(+0.480, -0.140, +0.572) m` | **measured** | Inter-satellite link phased-array transceiver on the `+X` half of the `+Z` deck. |
| **Laser Retroreflector Array (`LRA_BDS_SHAO_42`)** | `42` corner-cube prisms (`0.36 × 0.28 m` tray) at `(+0.610, +0.432, +0.620) m` | **official** | Exact prism count (`42`) and `BDS-3M-SECM-A` eccentricity `(+0.6096, +0.4316, +0.6204)` m from `igs_satellite_metadata.snx` (`LRA_BDS_SHAO_42`). |
| **Overall bounding box (`X × Y × Z`)** | `2.210 × 11.360 × 1.404 m` | **derived** | `X`: `2.150 m` bus + `2 × 0.030 m` end frames (`2.210 m`); `Y`: deployed wing span (`11.360 m`); `Z`: `-0.5865 m` adapter to `+0.8165 m` antenna tips (`1.404 m`). |

---

## 3. Simplifications & Omissions

- `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, and `BDS-3SM-SECM` share the same SECM microsatellite bus and `LRA_BDS_SHAO_42` reflector (`Z = +0.610–0.620 m`) with minor horizontal LRA relocation between batches; `BDS-3M-SECM-A` coordinates are used for the visual LRA placement.
- Individual L-band helical cup elements are represented as smooth low-poly radome cylinders in flared Kapton cups.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds3-meo-secm/bds3-meo-secm.glb`
- **File size**: `1,025,736` bytes (`0.978 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `4,432` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.210 × 11.360 × 1.404 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1025736 (0.978 MB)
REIMPORT_TRIANGLES 4432
REIMPORT_BBOX_MIN (-1.105, -5.68, -0.587)
REIMPORT_BBOX_MAX (1.105, 5.68, 0.817)
REIMPORT_BBOX_SIZE (2.21, 11.36, 1.404)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -0.6000000238418579], wing-Y T=[0, 0, 0.6000000238418579]
EXPECTED_SIZE (2.21, 11.36, 1.404) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

