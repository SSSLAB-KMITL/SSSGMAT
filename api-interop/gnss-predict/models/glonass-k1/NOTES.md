# GLONASS-K1 (`Uragan-K1`) — 3D Model Technical Notes (`glonass-k1`)

Procedural, real-scale 3D model of a **GLONASS-K1 (`Uragan-K1`) navigation satellite** manufactured by JSC Information Satellite Systems Reshetnev (unpressurized Ekspress-1000A/K platform; IGS blocks `GLO-K1`, `GLO-K1A`, `GLO-K1B`, and `GLO-K1+`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the main spacecraft bus (`[0, 0, 0]` m).
- **+Z**: Navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.700, +0.050)` m) and `wing-Y` (pivot `(0.000, -0.700, +0.050)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `GLO-K1`, `GLO-K1A`, `GLO-K1B`, `GLO-K1+` | **official** | `igs_satellite_metadata.snx` (`R801` as `GLO-K1A`, `R802` & `R805` as `GLO-K1B`, `R806` as `GLO-K1+`, all using `LRA_GLO_K1`; `GLO-K1` listed in brief §1). |
| **Launch mass** | `935–962 kg` | **official** | ISS Reshetnev *GLONASS-K1* specification; Montenbruck et al. (2015). |
| **Unpressurized Ekspress-1000K bus (`X_B × Y_B × Z_B`)** | `1.400 × 1.400 × 2.100 m` | **measured** | ISS Reshetnev Ekspress-1000K unpressurized rectangular honeycomb frame (`Z ∈ [-1.050, +1.050]` m); consistent with `LRA_GLO_K1` at `Z = +1.4730 m` (`0.423 m` above `+Z` bus face). |
| **Annular Laser Retroreflector Array (`LRA_GLO_K1`)** | `123` corner-cube prisms (`Ø1.24–1.50 m` ring) at `(0.000, 0.000, +1.473) m` | **official** | Exact prism count (`123`, circular ring array) and coordinates `(0.0000, 0.0000, +1.4730)` m from `igs_satellite_metadata.snx` (`LRA_GLO_K1`). |
| **L-band navigation array (`+Z`)** | `12` helical antennas (`4` inner at `r = 0.22 m`, `8` outer at `r = 0.47 m`) inside the LRA ring | **official** | ISS Reshetnev *GLONASS-K1* layout (`Z = +1.430` to `+1.850 m`), plus COSPAS-SARSAT / L3 CDMA auxiliary antenna. |
| **Solar wing geometry** | `2 wings`, `2 panels/wing` (`2.000 × 1.600 m` per panel, `6.40 m²/wing`, `12.80 m²` total) | **est.** | Sized to fold against the `1.40 × 2.10 m` `±Y` bus faces during launch and match ISS Reshetnev GLONASS-K1 factory photos. |
| **Deployed wing span (`Y`)** | `10.760 m` | **est.** | `2 × (0.700 SADM + 0.620 yoke + 2 × 2.000 panels + 0.060 gap) = 10.760 m`. |
| **Overall bounding box (`X × Y × Z`)** | `1.520 × 10.760 × 2.980 m` | **derived** | `X`: `Ø1.520 m` antenna/LRA pedestal (`1.520 m`); `Y`: deployed wing span (`10.760 m`); `Z`: `-1.130 m` adapter ring to `+1.850 m` L-band helix tips (`2.980 m`). |

---

## 3. Simplifications & Omissions

- The 123-prism annular `LRA_GLO_K1` reflector ring (`Z = +1.473 m`) is represented by an aluminum ring base with 36 evenly spaced corner-cube prism holders.
- Both `GLO-K1A` (first test satellite `R801`) and `GLO-K1B` / `GLO-K1+` (`R802`, `R805`, `R806`) share the same unpressurized Ekspress-1000K box and identical `LRA_GLO_K1` eccentricity `(0.0000, 0.0000, +1.4730)` m in `igs_satellite_metadata.snx`.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/glonass-k1/glonass-k1.glb`
- **File size**: `1,010,008` bytes (`0.963 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `3,976` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `1.520 × 10.760 × 2.980 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1010008 (0.963 MB)
REIMPORT_TRIANGLES 3976
REIMPORT_BBOX_MIN (-0.76, -5.38, -1.13)
REIMPORT_BBOX_MAX (0.76, 5.38, 1.85)
REIMPORT_BBOX_SIZE (1.52, 10.76, 2.98)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0.05000000074505806, -0.699999988079071], wing-Y T=[0, 0.05000000074505806, 0.699999988079071]
EXPECTED_SIZE (1.52, 10.76, 2.98) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
