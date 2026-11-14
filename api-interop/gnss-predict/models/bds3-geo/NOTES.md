# BeiDou-3 GEO (`BDS-3G`) — 3D Model Technical Notes (`bds3-geo`)

Procedural, real-scale 3D model of a **BeiDou-3 Geostationary Orbit (GEO) navigation/RDSS satellite** manufactured by CAST on the DFH-3B platform (IGS block `BDS-3G`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.000, 0.000)` m) and `wing-Y` (pivot `(0.000, -1.000, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block code** | `BDS-3G` | **official** | `igs_satellite_metadata.snx` (`C059`, `C060`, `C061`, `C062`). |
| **Launch mass** | `~4600 kg` | **official** | CSNO *BeiDou Satellite Metadata* (`BDS-3G`) & CAST DFH-3B specifications; Steigenberger & Montenbruck (2020). |
| **DFH-3B bus box (`X_B × Y_B × Z_B`)** | `2.100 × 2.000 × 3.100 m` | **official** | CAST DFH-3B three-axis stabilized platform (`Z ∈ [-1.550, +1.550]` m); CSNO BDS-3 GEO metadata. |
| **Twin deployable S/C-band RDSS mesh reflectors (`±X`)** | `2 × Ø2.000 m` (`r = 1.000 m`, `~3.14 m²` aperture/dish) centered at `X = ±2.180 m` | **derived / measured** | Twin deployable gold-mesh parabolic reflectors for BDS-3 GEO RDSS and short-message service (`Ø2.00 m` matches `~3.14 m²` CAST GEO RDSS reflector aperture in Guo/Montenbruck POD literature; extends total `X` span to `6.360 m`. Previously estimated at `Ø2.20 m` / `6.900 m` `X`). |
| **Solar wing geometry** | `2 wings`, `3 panels/wing` (`2.450 × 1.860 m` per panel, `13.671 m²/wing`, `27.34 m²` total) | **est.** | Sized to fold against the `2.10 × 3.10 m` `±Y` bus faces and match CAST DFH-3B solar array area (`~26–28 m²`). |
| **Deployed wing span (`Y`)** | `19.040 m` | **est.** | `2 × (1.000 SADM + 1.050 yoke + 3 × 2.450 panels + 2 × 0.060 gaps) = 19.040 m`. |
| **L-band navigation array (`+Z`)** | `Ø1.36 m` circular array (`19` helical elements: `1 + 6 + 12`) | **measured** | Measured from CAST BDS-3 GEO cleanroom photographs (`Z = +1.550` to `+2.050 m`). |
| **Laser Retroreflector Array (`LRA_BDS_SHAO_90`)** | `90` corner-cube prisms (`10 × 9` tray, `0.46 × 0.38 m`) at `(+0.590, -0.085, +1.605) m` | **official** | Exact prism count (`90`) and horizontal offset `(+0.5896, -0.0845)` m from `igs_satellite_metadata.snx` (`LRA_BDS_SHAO_90`). |
| **Zenith (`-Z`) adapter & 490 N LAE nozzle** | Extends to `Z = -1.900 m` (`0.35 m` below `-Z` face) | **measured** | `Ø1.194 m` launch adapter ring and 490 N liquid apogee engine nozzle. |
| **Overall bounding box (`X × Y × Z`)** | `6.360 × 19.040 × 3.950 m` | **derived** | `X`: `2 × (2.180 + 1.000) = 6.360 m` across twin RDSS reflectors; `Y`: deployed wing span (`19.040 m`); `Z`: `-1.900 m` nozzle to `+2.050 m` L-band tips (`3.950 m`). |

---

## 3. Simplifications & Omissions

- Separated from `bds3-igso` (`BDS-3I`) because `BDS-3G` carries the twin `Ø2.00 m` side-deployed S/C-band RDSS mesh parabolic reflectors (`X = 6.36 m`).
- Multi-beam feed horn clusters and deployment hinge mechanisms for the side mesh reflectors are simplified to low-poly feed horns and dual-strut booms.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds3-geo/bds3-geo.glb`
- **File size**: `761,792` bytes (`0.727 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `7,990` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `6.360 × 19.040 × 3.950 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 761792 (0.727 MB)
REIMPORT_TRIANGLES 7990
REIMPORT_BBOX_MIN (-3.18, -9.52, -1.9)
REIMPORT_BBOX_MAX (3.18, 9.52, 2.05)
REIMPORT_BBOX_SIZE (6.36, 19.04, 3.95)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -1], wing-Y T=[0, 0, 1]
EXPECTED_SIZE (6.36, 19.04, 3.95) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
