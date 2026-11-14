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
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.715, +0.050)` m) and `wing-Y` (pivot `(0.000, -0.715, +0.050)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

Every dimension used in `scripts/build.py` is listed below and marked **official**, **derived**, **measured**, or **est.**

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `GLO-K1`, `GLO-K1A`, `GLO-K1B`, `GLO-K1+` | **official** | `igs_satellite_metadata.snx` (`R801` as `GLO-K1A`, `R802` & `R805` as `GLO-K1B`, `R806` as `GLO-K1+`, all using `LRA_GLO_K1`; `GLO-K1` listed in brief §1). |
| **Launch mass** | `935–962 kg` | **official** | ISS Reshetnev *GLONASS-K1* specification; Montenbruck et al. (2015). |
| **Unpressurized Ekspress-1000K bus (`X_B × Y_B × Z_B`)** | `1.600 × 1.430 × 2.130 m` | **official / derived** | `Y_B = 1.430 m` and stowed overall height `Z = 3.010 m` from official GLONASS-IAC (`glonass-iac.ru`: `2.53 × 3.01 × 1.43 m`); `X_B = 1.600 m` derived to carry the `Ø1.50 m` annular LRA + COSPAS-SARSAT housing. Alternative GLONASS-IAC operational listing (`2.53 × 6.01 × 1.43 m`) is recorded as conflicting with the `17.0 m²` deployed solar array area. |
| **Annular Laser Retroreflector Array (`LRA_GLO_K1`)** | `123` corner-cube prisms (`Ø1.24–1.50 m` ring) at `(0.000, 0.000, +1.473) m` | **official** | Exact prism count (`123`, circular ring array) and coordinates `(0.0000, 0.0000, +1.4730)` m from `igs_satellite_metadata.snx` (`LRA_GLO_K1`; `Z = 1.065 + 0.365 + 0.043 = +1.473 m`). |
| **L-band navigation array (`+Z`)** | `12` helical antennas (`4` inner at `r = 0.22 m`, `8` outer at `r = 0.47 m`) inside the LRA ring | **official** | ISS Reshetnev *GLONASS-K1* layout (`Z = +1.430` to `+1.850 m`), plus COSPAS-SARSAT / L3 CDMA auxiliary antenna. |
| **Solar array total area (`A_sa`)** | `17.00 m²` (`8.50 m²` per wing) | **official** | Roscosmos / ISS Reshetnev / *Novosti Kosmonavtiki*: GaAs solar array area halved vs GLONASS-M (`~30–34 m²`) down to `~17 m²` (`1.6 kW` EOL); also half of GLONASS-K2 (`34.0 m²`). Replaces earlier `est.` `12.80 m²`. |
| **Solar wing geometry** | `2 wings`, `2 panels/wing` (`2.125 × 2.000 m` per panel, `8.50 m²/wing`, `17.00 m²` total) | **derived** | Derived from `17.00 m²` official area (`PANEL_W = 2.000 m ≤ Z_B = 2.130 m`; stows cleanly along the Ekspress-1000K `±Y` bus faces). |
| **Deployed wing span (`Y`)** | `11.290 m` | **derived / est.** | `2 × (0.715 SADM + 0.620 yoke + 2 × 2.125 panels + 0.060 gap) = 11.290 m`. |
| **Overall bounding box (`X × Y × Z`)** | `1.673 × 11.290 × 3.010 m` | **derived** | `X`: bus + external frame rails (`1.673 m`); `Y`: deployed wing span (`11.290 m`); `Z`: `-1.160 m` adapter ring to `+1.850 m` L-band helix tips (`3.010 m`, matching GLONASS-IAC `3.01 m`). |

---

## 3. Simplifications & Omissions

- The 123-prism annular `LRA_GLO_K1` reflector ring (`Z = +1.473 m`) is represented by an aluminum ring base with 36 evenly spaced corner-cube prism holders.
- Both `GLO-K1A` (first test satellite `R801`) and `GLO-K1B` / `GLO-K1+` (`R802`, `R805`, `R806`) share the same unpressurized Ekspress-1000K box and identical `LRA_GLO_K1` eccentricity `(0.0000, 0.0000, +1.4730)` m in `igs_satellite_metadata.snx`.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/glonass-k1/glonass-k1.glb`
- **File size**: `1,007,780` bytes (`0.961 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `3,976` triangles (budget `≤ 15,000`)
- **Bounding box (body frame)**: `1.673 × 11.290 × 3.010 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 1007780 (0.961 MB)
REIMPORT_TRIANGLES 3976
REIMPORT_BBOX_MIN (-0.836, -5.645, -1.16)
REIMPORT_BBOX_MAX (0.836, 5.645, 1.85)
REIMPORT_BBOX_SIZE (1.673, 11.29, 3.01)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0.05000000074505806, -0.7149999737739563], wing-Y T=[0, 0.05000000074505806, 0.7149999737739563]
EXPECTED_SIZE (1.673, 11.29, 3.01) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

