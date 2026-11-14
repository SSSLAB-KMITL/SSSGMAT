# QZSS IGSO (`QZS-2A`, `QZS-2I`, `QZS-1`) — 3D Model Technical Notes (`qzss-igso`)

Procedural, real-scale 3D model of the **Japanese Quasi-Zenith Satellite System (QZSS) IGSO spacecraft** (**QZS-1R / Michibiki-1R**, **QZS-2 / Michibiki-2**, **QZS-4 / Michibiki-4**), built by Mitsubishi Electric on the **DS2000** platform (IGS blocks `QZS-2A`, `QZS-2I`; also covers historical `QZS-1`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

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
| **IGS block codes** | `QZS-2A`, `QZS-2I`, `QZS-1` | **official** | `igs_satellite_metadata.snx` (`J005` QZS-1R = `QZS-2A`; `J002` QZS-2 & `J004` QZS-4 = `QZS-2I`; retired `J001` QZS-1 = `QZS-1`). |
| **Envelope dimensions** | `2.9 × 19.0 × 6.2 m` (on-orbit QZS-2/4/1R); `2.9 × 3.1 × 6.2 m` stowed box | **official** | Cabinet Office *Satellite Property Information* (`SPI-QZS2`, `SPI-QZS4`, `SPI-QZS1R`), JAXA/eoPortal QZSS specs. |
| **DS2000 main bus box** | `2.400 × 2.360 × 4.900 m` (`Z ∈ [-2.50, +2.40]`) | **derived** | Derived from MELCO DS2000 structural envelope (`~2.36 × 2.30 × 5.0 m` plus `-Z` launch adapter ring down to `-2.90 m` and `+Z` antenna deck). |
| **Main L-band helical cone (`L-ANT`)** | Truncated cone `Ø1.76 m` base → `Ø1.46 m` top (`h = 0.56 m`), `19` helical elements (`+Z` tips at `+3.305 m`) | **official / derived** | `SPI-QZS2` Box-Wing-Hat model (`Ø1.8 → Ø1.5 m, h = 0.8 m` envelope) and JAXA helical array layout (`1 + 6 + 12` elements). Total `Z` height `-2.900` to `+3.305 = 6.205 m`. |
| **Separate L1-SAIF / L1-SLAS patch array** | `0.56 × 0.56 m` flat 4×4 patch panel at `(-1.04, 0.0, +2.55) m` | **official / derived** | Cabinet Office / QZS-1R sub-meter augmentation deck physically offset (`~1.2 m`) from `L-ANT` axis. |
| **Laser Retroreflector Array (`LRA_QZS_2`)** | Planar tray (`0.34 × 0.28 m`) at `(+0.96, +0.84, +2.45) m` | **official / derived** | Horizontal `+X/+Y` offset (`+0.988, +0.861 m`) matched to `igs_satellite_metadata.snx` (`J002` `LRA_QZS_2`). |
| **Solar wings (`wing+Y`, `wing-Y`)** | `2 wings × 3 panels` (`2.480 × 1.800 m/panel`), `0.720 m` yoke → `18.920 m` span | **official / est.** | Matches `~19.0 m` QZS-2/1R/4 deployed span (`0.4%` diff). (`QZS-1` originally had wider `25.3 m` wings before replacement by QZS-1R.) |
| **Overall bounding box (`X × Y × Z`)** | `2.854 × 18.920 × 6.205 m` | **derived** | Within `< 1.6%` of official `2.9 × 19.0 × 6.2 m`. |

---

## 3. Simplifications & Omissions

- `QZS-1` (retired 2022–2023) is mapped alongside `QZS-2A` (QZS-1R) and `QZS-2I` (QZS-2/4); `QZS-1` shared the DS2000 IGSO bus with slightly wider (`25.3 m`) ETS-VIII-derived wings before QZS-1R standardized the constellation on `19 m` wings.
- External MLI harnesses, S-band omni brackets, and thruster plumbing are simplified to clean geometric primitives under `5,200` triangles.

---

## 4. Verification Output (`verify.py`)

```text
FILE_SIZE_BYTES 802924 (0.766 MB)
REIMPORT_TRIANGLES 5170
REIMPORT_BBOX_MIN (-1.465, -9.46, -2.9)
REIMPORT_BBOX_MAX (1.389, 9.46, 3.305)
REIMPORT_BBOX_SIZE (2.854, 18.92, 6.205)
WING_NODES wing+Y T=[0, -0.05000000074505806, -1.1799999475479126], wing-Y T=[0, -0.05000000074505806, 1.1799999475479126]
EXPECTED_SIZE (2.854, 18.92, 6.205) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

