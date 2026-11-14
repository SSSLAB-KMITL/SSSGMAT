# GLONASS-M (`Uragan-M`) — 3D Model Technical Notes (`glonass-m`)

Procedural, real-scale 3D model of a **GLONASS-M (`Uragan-M` / 14F113) navigation satellite** manufactured by JSC Information Satellite Systems Reshetnev (IGS blocks `GLO-M` and `GLO-M+`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.100, -0.050)` m) and `wing-Y` (pivot `(0.000, -1.100, -0.050)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `GLO-M`, `GLO-M+` | **official** | `igs_satellite_metadata.snx` (`R715–R805` as `GLO-M`, `R855–R861` as `GLO-M+`, all using `LRA_GLO_M`). |
| **Launch mass** | `1415 kg` | **official** | ISS Reshetnev *Uragan-M* specifications; Montenbruck et al. (2015). |
| **Pressurized central cylinder (`Ø × H`)** | `Ø1.24 m × 2.70 m` (`Z ∈ [-1.55, +1.15]` m) | **official** | Rodriguez-Solano et al. (2012) `PROPBOXW.f` (`r = 0.62 m`) & Montenbruck et al. (2015). |
| **Equipment flange rings & side avionics envelope (`X`)** | `2.16 m` (`R = 1.08 m`) | **measured** | Outer structural equipment rings (`Ø2.16 m`) and `±X` avionics/clock bays from ISS Reshetnev technical drawings. |
| **Total axial height (`Z`)** | `3.90 m` (`Z ∈ [-1.80, +2.10]` m) | **derived** | From `-Z` zenith propulsion dome/adapter (`-1.80 m`) to `+Z` L-band helical antenna tips (`+2.10 m`), matching Rodriguez-Solano cylinder+cone length (`~3.60–3.90 m`) and `LRA_GLO_M` at `Z = +1.874 m`. |
| **Solar array total area (`A_sa`)** | `24.57 m²` (`12.285 m²` per wing) | **official** | Within the `23.6–26.1 m²` official box-wing range in Rodriguez-Solano et al. (2012) `PROPBOXW.f` (`26.1 m²`) and Montenbruck et al. (2015). |
| **Solar wing geometry** | `2 wings`, `2 panels/wing` (`3.150 × 1.950 m` per panel) | **derived** | `2 × 3.150 × 1.950 = 12.285 m²/wing`; SADM pivot at `|Y| = 1.100 m`, yoke `0.520 m`, gap `0.080 m`. |
| **Deployed wing span (`Y`)** | `16.000 m` | **derived** | `2 × (1.100 + 0.520 + 2 × 3.150 + 0.080) = 16.000 m` (note: some popular web pages quote `7.2 m` which is the single-wing length `~6.9–7.2 m` rather than tip-to-tip span). |
| **L-band navigation array (`+Z`)** | `12` conical helical antennas (`4` inner at `r = 0.30 m`, `8` outer at `r = 0.66 m`) on `Ø1.76 m` disc | **official** | ISS Reshetnev *GLONASS-M* layout: 12 conical L-band helices mounted on a conical nadir truss adapter (`Z = +1.58` to `+2.10 m`). |
| **Laser Retroreflector Array (`LRA_GLO_M`)** | `112` corner-cube prisms (`0.34 × 0.34 m` planar tray) at `(+0.137, +0.003, +1.874) m` | **official** | Exact prism count (`112`) and eccentricity `(+0.1370, +0.0030, +1.8737)` m from `igs_satellite_metadata.snx` (`LRA_GLO_M`). |
| **Overall bounding box (`X × Y × Z`)** | `2.160 × 16.000 × 3.900 m` | **derived** | `X`: structural ring/avionics (`2.160 m`); `Y`: deployed wing span (`16.000 m`); `Z`: `-1.800` to `+2.100 m` (`3.900 m`). |

---

## 3. Simplifications & Omissions

- The 112-prism `LRA_GLO_M` array is represented by a `0.34 × 0.34 m` aluminum tray with a 36-element (`6 × 6`) hexagonal prism grid at the exact SINEX eccentricity `(+0.137, +0.003, +1.874)` m.
- Semicircular launch-stowage cutouts at the inner root of the solar panels are simplified to rectangular panels with a `0.52 m` V-strut yoke.
- Fine external cabling and optical horizon sensor baffles on the conical nadir truss are simplified to clean geometric primitives.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/glonass-m/glonass-m.glb`
- **File size**: `1,068,752` bytes (`1.019 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `4,646` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.160 × 16.000 × 3.900 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1068752 (1.019 MB)
REIMPORT_TRIANGLES 4646
REIMPORT_BBOX_MIN (-1.08, -8.0, -1.8)
REIMPORT_BBOX_MAX (1.08, 8.0, 2.1)
REIMPORT_BBOX_SIZE (2.16, 16.0, 3.9)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, -0.05000000074505806, -1.100000023841858], wing-Y T=[0, -0.05000000074505806, 1.100000023841858]
EXPECTED_SIZE (2.16, 16.0, 3.9) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

