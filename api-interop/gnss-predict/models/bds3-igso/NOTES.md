# BeiDou-3 IGSO (`BDS-3I`) — 3D Model Technical Notes (`bds3-igso`)

Procedural, real-scale 3D model of a **BeiDou-3 Inclined Geosynchronous Orbit (IGSO) navigation satellite** manufactured by CAST on the DFH-3B platform (IGS block `BDS-3I`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.179, 0.000)` m) and `wing-Y` (pivot `(0.000, -1.179, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block code** | `BDS-3I` | **official** | `igs_satellite_metadata.snx` (`C038`, `C039`, `C040`). |
| **Launch mass** | `~4200 kg` | **official** | CSNO *BeiDou Satellite Metadata* (`BDS-3I`) & CAST DFH-3B specifications; Steigenberger & Montenbruck (2020). |
| **DFH-3B bus box (`X_B × Y_B × Z_B`)** | `2.098 × 2.358 × 3.602 m` | **official** | Official CSNO *BeiDou Satellite Metadata* for `BDS-3I` (via GFZ / Duan et al.: `X = 2.098 m`, `Y = 2.358 m`, `Z = 3.602 m`, `Z ∈ [-1.801, +1.801]` m; replaces generic DFH-3B estimate `2.100 × 2.000 × 3.100 m`). |
| **Solar wing geometry** | `2 wings`, `3 panels/wing` (`2.300 × 1.800 m` per panel, `12.42 m²/wing`, `24.84 m²` total) | **est.** | Sized to fold cleanly against the `2.098 × 3.602 m` `±Y` bus faces (`panel_l = 2.300 m ≤ 3.602 m`) and match CAST DFH-3B IGSO solar array area (`~24–25 m²`). |
| **Deployed wing span (`Y`)** | `18.040 m` | **est.** | `2 × (1.179 SADM + 0.120 hub + 0.821 yoke + 3 × 2.300 panels + 2 × 0.060 gaps) = 18.040 m`. |
| **L-band navigation array (`+Z`)** | `Ø1.36 m` circular array (`19` helical elements: `1 + 6 + 12`) | **measured** | Measured from CAST BDS-3 IGSO cleanroom photographs (`Z = +1.801` to `+2.301 m`). |
| **Ka-band ISL phased array (`+Z`)** | `0.58 × 0.58 × 0.16 m` at `(+0.520, +0.460, +1.881) m` | **measured** | Inter-satellite link phased-array transceiver on the `+Z` deck. |
| **Regional S/C-band dish (`+Z`, `+X` edge)** | `Ø0.84 m` (`r = 0.42 m`) centered at `(+0.860, -0.360, +1.961) m` | **measured** | Extends `+X` bounding box edge to `+1.280 m` (with `-X` louver frame at `-1.079 m`, total `X = 2.359 m`). |
| **Laser Retroreflector Array (`LRA_BDS_SHAO_90`)** | `90` corner-cube prisms (`10 × 9` tray, `0.46 × 0.38 m`) at `(-0.820, -0.712, +1.972) m` | **official** | Exact prism count (`90`), `Y = -0.7118 m`, and `Z = +1.9724 m` from `igs_satellite_metadata.snx` (`LRA_BDS_SHAO_90` on `BDS-3I`), supported on a `0.117 m` bracket above the `+1.801 m` `+Z` deck. |
| **Zenith (`-Z`) adapter & 490 N LAE nozzle** | Extends to `Z = -2.151 m` (`0.35 m` below `-Z` face) | **measured** | `Ø1.194 m` launch adapter ring and 490 N liquid apogee engine nozzle. |
| **Overall bounding box (`X × Y × Z`)** | `2.359 × 18.040 × 4.452 m` | **derived** | `X`: `-1.079` to `+1.280 m` (`2.359 m`); `Y`: deployed wing span (`18.040 m`); `Z`: `-2.151 m` nozzle to `+2.301 m` L-band tips (`4.452 m`). |

---

## 3. Simplifications & Omissions

- Separated from `bds3-geo` (`BDS-3G`) because `BDS-3I` omits the twin `Ø2.20 m` side-deployed RDSS mesh reflectors and mounts its 90-prism `LRA_BDS_SHAO_90` on an elevated pedestal (`Z = +1.972 m`) on the `(-X, -Y)` deck corner.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/bds3-igso/bds3-igso.glb`
- **File size**: `1,113,124` bytes (`1.062 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `6,378` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.359 × 18.040 × 4.452 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1113124 (1.062 MB)
REIMPORT_TRIANGLES 6378
REIMPORT_BBOX_MIN (-1.079, -9.02, -2.151)
REIMPORT_BBOX_MAX (1.28, 9.02, 2.301)
REIMPORT_BBOX_SIZE (2.359, 18.04, 4.452)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -1.1790000200271606], wing-Y T=[0, 0, 1.1790000200271606]
EXPECTED_SIZE (2.359, 18.04, 4.452) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
