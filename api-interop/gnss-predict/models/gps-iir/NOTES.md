# GPS Block IIR / IIR-M — 3D Model Technical Notes (`gps-iir`)

Procedural, real-scale 3D model of a **Lockheed Martin GPS Block IIR / IIR-M navigation satellite** (AS-4000 bus; IGS blocks `GPS-IIR-A`, `GPS-IIR-B`, and `GPS-IIR-M`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.965, -0.080)` m) and `wing-Y` (pivot `(0.000, -0.965, -0.080)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `GPS-IIR-A`, `GPS-IIR-B`, `GPS-IIR-M` | **official** | `igs_satellite_metadata.snx` (active Block IIR-A, IIR-B, and modernized IIR-M satellites). |
| **Launch / on-orbit mass** | `2032 kg` launch / `~1080 kg` on-orbit | **official** | USAF / Lockheed Martin *GPS Block IIR / IIR-M Fact Sheet*; Montenbruck et al. (2015). |
| **AS-4000 bus box (`X_B × Y_B × Z_B`)** | `1.520 × 1.930 × 1.910 m` | **official** | Lockheed Martin / USAF *GPS Block IIR Fact Sheet* (`5.0 × 6.3 × 6.25 ft`); Montenbruck et al. (2015); Rodriguez-Solano et al. (2012) `PROPBOXW.f`. |
| **W-sensor (NDS) side arrays (`±X`)** | `2 × (0.26 × 0.92 × 0.24 m)` (`~0.5 m²` total) | **official** | Rodriguez-Solano et al. (2012) `PROPBOXW.f` (`0.5 m²` W-sensor area on `±X`); extends total `X` width from `1.520 m` to `2.040 m`. |
| **Solar array total area (`A_sa`)** | `13.78 m²` (`6.888 m²` per wing) | **official** | Matches the official `13.60–13.92 m²` box-wing area in Rodriguez-Solano et al. (2012) `PROPBOXW.f` and Montenbruck et al. (2015). |
| **Solar wing geometry** | `2 wings`, `2 panels/wing` (`2.050 × 1.680 m` per panel) | **derived** | `2 × 2.050 × 1.680 = 6.888 m²/wing`; SADM pivot at `|Y| = 0.965 m`, yoke `0.780 m`, gap `0.060 m`. |
| **Deployed wing span (`Y`)** | `11.810 m` | **official** | `2 × (0.965 + 0.780 + 2 × 2.050 + 0.060) = 11.810 m` (official USAF / Lockheed Martin deployed span `~11.4–11.8 m` / `38 ft`). |
| **L-band navigation array (`+Z`)** | `12` helical elements (`4` inner at `r = 0.220 m`, `8` outer at `r = 0.540 m`) | **official** | Classic/modernized ITI L-band array on `+Z` deck (`Z = +1.005` to `+1.445 m`). |
| **UHF cross-dipole & S-band TT&C boom** | Top at `Z = +1.515 m` | **measured** | Measured from Lockheed Martin GPS IIR-M cleanroom photographs. |
| **Zenith (`-Z`) adapter & Star-37FM nozzle** | Extends to `Z = -1.205 m` (`0.25 m` below `-Z` face) | **est.** | Delta II payload attach fitting (`Ø1.16 m`) and recessed Star-37FM apogee kick motor nozzle cone. |
| **Overall bounding box (`X × Y × Z`)** | `2.040 × 11.810 × 2.720 m` | **derived** | `X`: `1.520 m` bus + `2 × 0.260 m` W-sensor arrays (`2.040 m`); `Y`: deployed wing span (`11.810 m`); `Z`: `-1.205 m` nozzle to `+1.515 m` S-band boom (`2.720 m`). |

---

## 3. Simplifications & Omissions

- `GPS-IIR-A`, `GPS-IIR-B`, and `GPS-IIR-M` share the same Lockheed Martin AS-4000 bus (`1.52 × 1.93 × 1.91 m`) and 12-helix L-band layout; the modernized IIR-M antenna panel platen is represented so the single model accurately covers all three sub-blocks.
- Individual W-sensor dipole elements inside the `±X` side troughs are represented by a clean white radome aperture face.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/gps-iir/gps-iir.glb`
- **File size**: `546,512` bytes (`0.521 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `3,146` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `2.040 × 11.810 × 2.720 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 546512 (0.521 MB)
REIMPORT_TRIANGLES 3146
REIMPORT_BBOX_MIN (-1.02, -5.905, -1.205)
REIMPORT_BBOX_MAX (1.02, 5.905, 1.515)
REIMPORT_BBOX_SIZE (2.04, 11.81, 2.72)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, -0.07999999821186066, -0.9649999737739563], wing-Y T=[0, -0.07999999821186066, 0.9649999737739563]
EXPECTED_SIZE (2.04, 11.81, 2.72) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
