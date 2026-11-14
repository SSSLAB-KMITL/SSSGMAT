# Generic GNSS Satellite Fallback — 3D Model Technical Notes (`generic`)

Procedural, real-scale 3D fallback model (`generic`) for experimental, retired, or regional GNSS satellite blocks (`GAL-0A`, `GAL-0B`, `BDS-3S*`, `QZS-*`, `IRS-*`, `GPS-I/II/IIA`, `GLO`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures, strictly within the `< 2,000` triangle budget specified in §3 of the brief.

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
| **Fallback block coverage** | `BDS-3S`, `BDS-3SI-CAST`, `BDS-3SI-SECM`, `GAL-0A`, `GAL-0B`, `GLO`, `GPS-I`, `GPS-II`, `GPS-IIA`, `IRS-1G`, `IRS-1I`, `IRS-2G`, `IRS-2I`, `QZS-1`, `QZS-2A`, `QZS-2G`, `QZS-2I`, `QZS-3G` | **official** | Brief §1 & §3 (`igs_satellite_metadata.snx` fallback blocks). |
| **Bus cube (`X_B × Y_B × Z_B`)** | `2.000 × 2.000 × 2.000 m` | **official** | Brief §3 specification (`about 2 × 2 × 2 m` simple box bus). |
| **Solar wings (`wing+Y`, `wing-Y`)** | `2 wings`, each `5.000 m` long × `2.000 m` wide (`2 × 2.200 m` panels + `0.060 m` gap + `0.540 m` yoke) | **official** | Brief §3 specification (`with 2 × 5 m wings`; deployed tip-to-tip span `Y = 12.000 m`). |
| **Earth-deck (`+Z`) navigation antenna** | `Ø1.24 m` circular ground plane + `9` L-band helical elements (`1` center + `8` outer) + LRA tray | **est.** | Representative GNSS Earth-facing (`+Z`) L-band array extending to `Z = +1.360 m`. |
| **Zenith (`-Z`) launch adapter ring** | `Ø1.08 m × 0.080 m` (`Z = -1.080 m`) | **est.** | Standard launch vehicle adapter collar. |
| **Overall bounding box (`X × Y × Z`)** | `2.000 × 12.000 × 2.440 m` | **derived** | `X`: `2.000 m` bus; `Y`: `12.000 m` deployed wing span; `Z`: `-1.080` to `+1.360 m` (`2.440 m`). |

---

## 3. Simplifications & Omissions

- Designed as a clean, low-polygon (`< 2,000` triangles) canonical GNSS box-wing spacecraft for any block code not covered by a dedicated constellation/bus model.

---

## 4. Model Metrics & Verification Output

- **GLB path**: `models/generic/generic.glb`
- **File size**: `884,948` bytes (`0.844 MB`, budget `≤ 1.5 MB`)
- **Triangle count**: `1,916` triangles (budget `< 2,000`)
- **Bounding box (body frame)**: `2.000 × 12.000 × 2.440 m`
- **Renders**:
  - `renders/01_earth_face.jpg`
  - `renders/02_side_span.jpg`
  - `renders/03_three_quarter.jpg`
  - `renders/04_closeup.jpg`

### `verify.py` Output

```text
FILE_SIZE_BYTES 884948 (0.844 MB)
REIMPORT_TRIANGLES 1916
REIMPORT_BBOX_MIN (-1.0, -6.0, -1.08)
REIMPORT_BBOX_MAX (1.0, 6.0, 1.36)
REIMPORT_BBOX_SIZE (2.0, 12.0, 2.44)
IMAGES [('tex_foil_silver', (512, 512)), ('tex_foil_silver_nrm', (512, 512)), ('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, 0, -1], wing-Y T=[0, 0, 1]
EXPECTED_SIZE (2.0, 12.0, 2.44) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
