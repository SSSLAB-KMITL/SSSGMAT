# QZSS GEO (`QZS-2G`, `QZS-3G`) — 3D Model Technical Notes (`qzss-geo`)

Procedural, real-scale 3D model of the **Japanese QZSS Geostationary Orbit (GEO) spacecraft** (**QZS-3 / Michibiki-3**, and Block III GEO follow-ons **QZS-6 / QZS-7**), built by Mitsubishi Electric on the **DS2000** platform (IGS blocks `QZS-2G`, `QZS-3G`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Nominal geometric centre (`[0, 0, 0]` m).
- **+Z**: Earth-facing payload antenna boresight (nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +1.150, -0.050)` m) and `wing-Y` (pivot `(0.000, -1.150, -0.050)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `QZS-2G`, `QZS-3G` | **official** | `igs_satellite_metadata.snx` (`J003` QZS-3 = `QZS-2G`; `J007` QZS-6 & `J008` QZS-7 = `QZS-3G`). |
| **DS2000 GEO main bus** | `2.360 × 2.300 × 5.000 m` | **official / derived** | MELCO DS2000 GEO platform dimensions (`5.0 × 2.3 × 2.36 m` cited for DS2000 / QZS-3 / QZS-6/7). |
| **Flat L-band & SBAS/L1S patch arrays (`+Z`)** | `1.36 × 1.36 m` L-band 6×6 patch + `0.56 × 0.44 m` L1S/SBAS 4×4 patch | **official / derived** | eoPortal & Cabinet Office `SPI-QZS3`: QZS-3/6/7 use flat microstrip patch arrays on the `+Z` face rather than the IGSO helical cone. |
| **Expandable S-band mesh reflector (`+X`)** | `Ø3.200 m` (`r = 1.600 m`) parabolic dish on `+X` boom (`apex X = +2.76 m`) | **official** | Cabinet Office `qzss.go.jp` QZS-3 spec: `Ø3.2 m` expandable S-band antenna (`+X` edge reaches `+4.303 m`). |
| **Fixed Ku-band dish (`-X`)** | `Ø1.000 m` (`r = 0.500 m`) dish on `-X` boom (`apex X = -1.78 m`) | **official** | Cabinet Office `qzss.go.jp` QZS-3 spec: `1 m` fixed Ku-band Q-ANPI reflector (`-X` edge reaches `-2.266 m`). |
| **Solar wings (`wing+Y`, `wing-Y`)** | `2 wings × 3 panels` (`2.480 × 1.800 m/panel`), `0.750 m` yoke → `18.920 m` span | **official / est.** | Matches `~19.0 m` DS2000 QZS-3/6/7 deployed span. |
| **Overall bounding box (`X × Y × Z`)** | `6.569 × 18.920 × 5.921 m` | **derived** | `X`: `-2.266` (Ku dish) to `+4.303` (S-band dish); `Y`: `18.920 m` wing span; `Z`: `-2.960` adapter to `+2.961` dish feed (`5.921 m`). |

---

## 3. Simplifications & Omissions

- Separated from `qzss-igso` because GEO QZSS spacecraft replace the `L-ANT` conical helical array with flat L-band/SBAS patch panels and add the large `Ø3.2 m` expandable S-band dish and `Ø1.0 m` Ku-band dish.
- `QZS-3G` (QZS-6/7) evolves S-band payload to inter-satellite/bi-directional ranging on the same DS2000 GEO bus and flat L-band patch layout, so it shares `qzss-geo`.

---

## 4. Verification Output (`verify.py`)

```text
FILE_SIZE_BYTES 716996 (0.684 MB)
REIMPORT_TRIANGLES 3352
REIMPORT_BBOX_MIN (-2.266, -9.46, -2.96)
REIMPORT_BBOX_MAX (4.303, 9.46, 2.961)
REIMPORT_BBOX_SIZE (6.569, 18.92, 5.921)
WING_NODES wing+Y T=[0, -0.05000000074505806, -1.149999976158142], wing-Y T=[0, -0.05000000074505806, 1.149999976158142]
EXPECTED_SIZE (6.569, 18.92, 5.921) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
