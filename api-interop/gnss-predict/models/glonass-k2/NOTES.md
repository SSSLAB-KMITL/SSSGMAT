# GLONASS-K2 (`Uragan-K2`) — 3D Model Technical Notes (`glonass-k2`)

Procedural, real-scale 3D model of a **GLONASS-K2 (`Uragan-K2`) navigation satellite** manufactured by JSC Information Satellite Systems Reshetnev (enlarged unpressurized Ekspress-1000K platform; IGS block `GLO-K2`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.700, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.700, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block code** | `GLO-K2` | **official** | `igs_satellite_metadata.snx` (`R803`, `R804`). |
| **Launch mass** | `1645 kg` | **official** | Steigenberger & Montenbruck (2023) / IGS GLONASS-K2 box-wing metadata; ISS Reshetnev *GLONASS-K2* specifications. |
| **Unpressurized Ekspress-1000K bus (`X_B × Y_B × Z_B`)** | `2.000 × 1.400 × 2.500 m` | **official** | Steigenberger & Montenbruck (2023) GLONASS-K2 box-wing geometry (`Y/Z` face `1.40 × 2.50 m = 3.50 m²`; `X/Z` bus+payload envelope `~6.25 m²`). |
| **Solar array total area (`A_sa`)** | `34.00 m²` (`17.00 m²` per wing) | **official** | Steigenberger & Montenbruck (2023) / IGS GLONASS-K2 box-wing solar array area (`34.0 m²`). |
| **Solar wing geometry** | `2 wings`, `3 panels/wing` (`2.8333 × 2.000 m` per panel, `17.00 m²/wing`) | **derived** | Derived from `A_wing = 17.00 m²` (`3 × 2.8333 × 2.000 = 17.00 m²`) and ISS Reshetnev GLONASS-K2 cleanroom photographs showing 3 wide panels per wing. |
| **Deployed wing span (`Y`)** | `20.400 m` | **est.** | `2 × (0.700 SADM + 0.8801 yoke + 3 × 2.8333 panels + 2 × 0.060 gaps) = 20.400 m`. |
| **Stepped payload module & L-band array (`+Z`)** | `1.76 × 1.32 × 0.39 m` pedestal + `18` L1/L2/L3 helical elements (`6` inner + `12` outer) | **measured** | Measured from ISS Reshetnev GLONASS-K2 assembly photographs (`Z = +1.250` to `+2.100 m`). |
| **Annular Laser Retroreflector Array** | `Ø1.20–1.44 m` ring array around navigation array at `Z = +1.640–1.685 m` | **measured** | Measured from ISS Reshetnev GLONASS-K2 payload deck photographs. |
| **Overall bounding box (`X × Y × Z`)** | `2.082 × 20.400 × 3.460 m` | **derived** | `X`: `2.000 m` bus + external corner longerons (`2.082 m`); `Y`: deployed wing span (`20.400 m`); `Z`: `-1.360 m` Fregat adapter to `+2.100 m` L-band tips (`3.460 m`). |

---

## 3. Simplifications & Omissions

- The multi-band FDMA/CDMA L1/L2/L3 navigation array and annular LRA are represented using low-poly cylindrical radome cups and a 36-prism ring array.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/glonass-k2/glonass-k2.glb`
- **File size**: `1,073,764` bytes (`1.024 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `4,990` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.082 × 20.400 × 3.460 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1073764 (1.024 MB)
REIMPORT_TRIANGLES 4990
REIMPORT_BBOX_MIN (-1.041, -10.2, -1.36)
REIMPORT_BBOX_MAX (1.041, 10.2, 2.1)
REIMPORT_BBOX_SIZE (2.082, 20.4, 3.46)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -0.699999988079071], wing-Y T=[0, 0, 0.699999988079071]
EXPECTED_SIZE (2.082, 20.4, 3.46) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
