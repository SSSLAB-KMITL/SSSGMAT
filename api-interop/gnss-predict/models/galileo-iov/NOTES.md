# Galileo IOV (`GAL-1`) — 3D Model Technical Notes (`galileo-iov`)

Procedural, real-scale 3D model of a **Galileo In-Orbit Validation (IOV) satellite** manufactured by EADS Astrium (Airbus Defence and Space) & Thales Alenia Space (IGS block `GAL-1`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(-0.100, +0.5745, 0.000)` m) and `wing-Y` (pivot `(-0.100, -0.5745, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block code** | `GAL-1` | **official** | `igs_satellite_metadata.snx` (`E101`, `E102`, `E103`, `E104`). |
| **Launch mass** | `~695–700 kg` | **official** | European GNSS Service Centre (GSC) *Galileo Satellite Metadata* (`GAL-1`); Montenbruck et al. (2015). |
| **Bus box (`X_B × Y_B × Z_B`)** | `2.611 × 1.149 × 1.149 m` | **official** | GSC *Galileo Satellite Metadata* (`GAL-1` IOV cuboid box dimensions: `X = 2.611 m`, `Y = 1.149 m`, `Z = 1.149 m`). |
| **Solar wing active area (`A_wing`)** | `5.000 × 1.082 m` (`5.410 m²` per wing, `10.820 m²` total) | **official** | GSC *Galileo Satellite Metadata* (`GAL-1` IOV solar wing dimensions `5.000 × 1.082 m`). |
| **Deployed wing span (`Y`)** | `14.500 m` (`wing_tip = 7.250 m`) | **official** | ESA *Galileo IOV Fact Sheet* & Montenbruck et al. (2015) (`14.5 m` deployed tip-to-tip span; `2` panels/wing of `2.470 × 1.082 m` + `0.060 m` hinge gap + `1.6755 m` yoke from `|Y| = 0.5745 m`). |
| **L-band navigation antenna (`+Z`)** | `Ø1.27 m` circular array at `X = +0.440 m`, height `0.110 m` | **measured** | Measured from ESA / Astrium Galileo IOV cleanroom photos and technical drawings. |
| **Search-and-Rescue (SAR) antenna (`+Z`)** | `Ø0.62 m` regular hexagon at `(-0.460, -0.140, +0.5745) m` | **measured** | Measured from ESA Galileo IOV payload deck drawings. |
| **C-band mission antenna (`+Z`)** | `Ø0.33 m` circular patch at `(-0.380, +0.340, +0.5745) m` | **measured** | Measured from ESA Galileo IOV payload deck drawings. |
| **Laser Retroreflector Array (`LRA_GAL_1`)** | `84` corner-cube prisms (`12 × 7` tray, `0.34 × 0.48 m`) at `(-1.050, +0.034, +0.623) m` | **official** | Exact prism count (`84`) and offset relative to CoM `(-1.0927, +0.0340, +0.6225)` m from `igs_satellite_metadata.snx` (`LRA_GAL_1`). |
| **Overall bounding box (`X × Y × Z`)** | `2.669 × 14.500 × 1.439 m` | **derived** | `X`: `2.611 m` bus + `2 × 0.029 m` end frames (`2.669 m`); `Y`: deployed wing span (`14.500 m`); `Z`: `-0.650 m` dispenser ring to `+0.789 m` S-band antenna tip (`1.439 m`). |

---

## 3. Simplifications & Omissions

- Compared with `galileo-foc` (`2.490 × 1.385 × 1.170 m`, 60-prism LRA), `galileo-iov` has a longer, narrower bus (`2.611 × 1.149 × 1.149 m`), narrower `1.082 m` solar panels (`5.41 m²/wing`), and a larger 84-prism (`12 × 7`) `LRA_GAL_1` array.
- Fine multi-layer blanket wrinkles and dispenser hold-down brackets are simplified.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/galileo-iov/galileo-iov.glb`
- **File size**: `845,084` bytes (`0.806 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `2,722` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.669 × 14.500 × 1.439 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 845084 (0.806 MB)
REIMPORT_TRIANGLES 2722
REIMPORT_BBOX_MIN (-1.334, -7.25, -0.65)
REIMPORT_BBOX_MAX (1.334, 7.25, 0.789)
REIMPORT_BBOX_SIZE (2.669, 14.5, 1.439)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[-0.10000000149011612, 0, -0.5745000243186951], wing-Y T=[-0.10000000149011612, 0, 0.5745000243186951]
EXPECTED_SIZE (2.669, 14.5, 1.439) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

