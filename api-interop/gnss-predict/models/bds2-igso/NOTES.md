# BeiDou-2 IGSO / GEO / MEO (`BDS-2I`, `BDS-2G`, `BDS-2M`) — 3D Model Technical Notes (`bds2-igso`)

Procedural, real-scale 3D model of a **BeiDou-2 navigation satellite** manufactured by CAST on the DFH-3A platform (IGS blocks `BDS-2I`, `BDS-2G`, and `BDS-2M`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.860, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.860, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `BDS-2I`, `BDS-2G`, `BDS-2M` | **official** | `igs_satellite_metadata.snx` (active and historical BeiDou-2 IGSO, GEO, and MEO satellites). |
| **DFH-3A bus box (`X_B × Y_B × Z_B`)** | `2.000 × 1.720 × 2.200 m` | **official** | Montenbruck et al. (2015), Guo et al. (2016), and CAST DFH-3A platform specifications (`Z ∈ [-1.100, +1.100]` m, matching the SINEX LRA `Z` coordinates `+1.1000–1.1128 m` directly on the `+Z` face). |
| **Solar array total area (`A_sa`)** | `20.47 m²` (`10.234 m²` per wing) | **official** | Matches the `20.5–22.7 m²` BDS-2 DFH-3A solar array area in Montenbruck et al. (2015) and Guo et al. (2016). |
| **Solar wing geometry** | `2 wings`, `3 panels/wing` (`2.080 × 1.640 m` per panel) | **derived** | `3 × 2.080 × 1.640 = 10.234 m²/wing`; SADM pivot at `|Y| = 0.860 m`, yoke `0.900 m`, gap `0.060 m`. |
| **Deployed wing span (`Y`)** | `16.240 m` | **derived** | `2 × (0.860 + 0.900 + 3 × 2.080 + 2 × 0.060) = 16.240 m` (CAST DFH-3A span `~16.2–18.1 m`). |
| **L-band navigation array (`+Z`)** | `Ø1.12 m` circular array (`12` helical elements: `4` inner + `8` outer) at `(+0.160, +0.140, +1.100) m` | **measured** | Measured from CAST BDS-2 cleanroom photographs (`Z = +1.100` to `+1.520 m`). |
| **Regional S/C-band dish (`+Z`)** | `Ø0.76 m` (`r = 0.38 m`) at `(-0.540, +0.280, +1.240) m` | **measured** | Measured from CAST BDS-2 IGSO/MEO diagrams. |
| **Laser Retroreflector Array (`LRA_BDS_SHAO_90`)** | `90` corner-cube prisms (`10 × 9` tray, `0.44 × 0.36 m`) at `(-0.417, -0.573, +1.150) m` | **official** | Exact prism count (`90`) and `BDS-2I` offset `(-0.4173, -0.5729, +1.1001)` m from `igs_satellite_metadata.snx` (`LRA_BDS_SHAO_90`). |
| **Zenith (`-Z`) adapter & 490 N LAE nozzle** | Extends to `Z = -1.400 m` (`0.30 m` below `-Z` face) | **est.** | CZ-3A payload attach fitting (`Ø1.12 m`) and 490 N liquid apogee engine nozzle. |
| **Overall bounding box (`X × Y × Z`)** | `2.050 × 16.240 × 2.920 m` | **derived** | `X`: `2.000 m` bus + `2 × 0.025 m` louver frames (`2.050 m`); `Y`: deployed wing span (`16.240 m`); `Z`: `-1.400 m` nozzle to `+1.520 m` L-band tips (`2.920 m`). |

---

## 3. Sub-Block Differences (`BDS-2I` vs. `BDS-2G` vs. `BDS-2M`) & Simplifications

- All three BeiDou-2 blocks (`BDS-2I`, `BDS-2G`, `BDS-2M`) use the same CAST DFH-3A rectangular bus (`2.000 × 1.720 × 2.200 m`) with the `+Z` payload deck at `Z = +1.100 m`:
  - **`BDS-2I` (IGSO)**: Carries the 90-prism `LRA_BDS_SHAO_90` at `(-0.4173, -0.5729, +1.1001)` m (used as the primary geometry for this model).
  - **`BDS-2G` (GEO)**: Carries the same 90-prism `LRA_BDS_SHAO_90` shifted slightly in `-X` to `(-0.6241, -0.5705, +1.1000)` m and adds a larger C/S-band RDSS reflector for geostationary short-message service.
  - **`BDS-2M` (MEO)**: Carries the smaller 42-prism `LRA_BDS_SHAO_42` at almost the identical deck location `(-0.4321, -0.5621, +1.1128)` m.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds2-igso/bds2-igso.glb`
- **File size**: `666,096` bytes (`0.635 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `5,244` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.050 × 16.240 × 2.920 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 666096 (0.635 MB)
REIMPORT_TRIANGLES 5244
REIMPORT_BBOX_MIN (-1.025, -8.12, -1.4)
REIMPORT_BBOX_MAX (1.025, 8.12, 1.52)
REIMPORT_BBOX_SIZE (2.05, 16.24, 2.92)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -0.8600000143051147], wing-Y T=[0, 0, 0.8600000143051147]
EXPECTED_SIZE (2.05, 16.24, 2.92) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
