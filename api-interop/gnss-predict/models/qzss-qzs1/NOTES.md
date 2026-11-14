# QZSS-1 / Michibiki-1 (`QZS-1`) — 3D Model Technical Notes (`qzss-qzs1`)

Procedural, real-scale 3D model of **QZS-1 (`Michibiki-1`)**, the first Quasi-Zenith Satellite System (QZSS) IGSO spacecraft built by Mitsubishi Electric on the **DS2000** platform (IGS block `QZS-1`, retired 2022–2023). Separated from `qzss-igso` (`QZS-2A`/`QZS-2I`) because `QZS-1` carries significantly wider ETS-VIII-derived **`25.3 m`** solar array wings (`vs. 19.0 m` on QZS-1R/2/4) and the `QZS-1` LRA offset.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Nominal geometric centre (`[0, 0, 0]` m).
- **+Z**: Navigation L-band antenna boresight (toward Earth / nadir; matches JAXA/Cabinet Office SPI `+Z`).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.180, -0.050)` m) and `wing-Y` (pivot `(0.000, -1.180, -0.050)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block code** | `QZS-1` | **official** | `igs_satellite_metadata.snx` (`J001` QZS-1 / Michibiki-1, `2010-045A`). |
| **Envelope dimensions (bus & height)** | `2.9 × 3.1 × 6.2 m` bus; `25.3 m` deployed solar span | **official** | JAXA *QZS-1 (Michibiki)* & Cabinet Office *Satellite Property Information* (`SPI-QZS1`), ESA eoPortal (`25.3 m` tip-to-tip span, `5.3 kW` EOL). |
| **DS2000 main bus box** | `2.400 × 2.360 × 4.900 m` (`Z ∈ [-2.50, +2.40]`) | **derived** | Derived from MELCO DS2000 structural core (`-Z` launch adapter ring down to `-2.90 m`, `+Z` antenna deck). |
| **Main L-band helical cone (`L-ANT`)** | Truncated cone `Ø1.76 m → Ø1.46 m` (`h = 0.56 m`), `19` helical elements (`+Z` tips at `+3.305 m`) | **official / derived** | Cabinet Office / JAXA QZS-1 L-band navigation payload (`1 + 6 + 12` elements). Total `Z` height `-2.900` to `+3.305 = 6.205 m`. |
| **L1-SAIF / LEX patch array** | `0.52 × 0.52 m` 4×4 patch panel at `(-1.02, +0.36, +2.55) m` | **derived** | Offset experimental/augmentation deck on `+Z`. |
| **Laser Retroreflector Array (`LRA_QZS_1`)** | Planar tray (`0.34 × 0.28 m`) on cantilevered deck bracket at `(-1.15, -0.55, +2.45) m` | **official** | Exact horizontal `(-1.150, -0.550) m` offset from Cabinet Office `SPI-QZS1`. |
| **Solar wings (`wing+Y`, `wing-Y`)** | `2 wings × 4 panels` (`2.600 × 1.800 m/panel`, `37.44 m²` total), `0.890 m` yoke → `25.300 m` span | **official / derived** | `2 × (1.180 + 0.890 + 4 × 2.600 + 3 × 0.060) = 25.300 m` matching official JAXA/eoPortal `25.3 m` span and `5.3 kW` power output; `2.600 m` panel length stows cleanly against the `4.900 m` bus `Z`. |
| **Overall bounding box (`X × Y × Z`)** | `2.854 × 25.300 × 6.205 m` | **derived** | Matches official `2.9 × 25.3 × 6.2 m` deployed envelope within `1.6%` (`< 0.05 m`). |

---

## 3. Simplifications & Omissions

- Separated from `qzss-igso` (`QZS-2A`/`QZS-2I`, `18.92 m` span) so `QZS-1` renders at its true `25.30 m` deployed wingspan.
- External MLI harnesses, S-band omni brackets, and thruster plumbing are simplified to clean geometric primitives under `5,400` triangles.

---

## 4. Verification Output (`verify.py`)

```text
FILE_SIZE_BYTES 813796 (0.776 MB)
REIMPORT_TRIANGLES 5302
REIMPORT_BBOX_MIN (-1.465, -12.65, -2.9)
REIMPORT_BBOX_MAX (1.389, 12.65, 3.305)
REIMPORT_BBOX_SIZE (2.854, 25.3, 6.205)
IMAGES [('tex_l1s_patch', (256, 256)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_mli_white', (512, 512)), ('tex_mli_white_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, -0.05000000074505806, -1.1799999475479126], wing-Y T=[0, -0.05000000074505806, 1.1799999475479126]
EXPECTED_SIZE (2.854, 25.3, 6.205) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
