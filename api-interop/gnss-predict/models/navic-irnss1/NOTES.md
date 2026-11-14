# NavIC IRNSS-1 (`IRS-1G`, `IRS-1I`) — 3D Model Technical Notes (`navic-irnss1`)

Procedural, real-scale 3D model of India's first-generation **NavIC / IRNSS-1** navigation satellites (`IRNSS-1A..1I`), built by ISRO on the **I-1K** spacecraft bus (IGS blocks `IRS-1G`, `IRS-1I`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the I-1K main bus box (`[0, 0, 0]` m).
- **+Z**: Navigation helical array boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.750, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.750, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `IRS-1G`, `IRS-1I` | **official** | `igs_satellite_metadata.snx` (`I001–I007, I009`). |
| **SNX dry mass** | `700.0 kg` (`~1425 kg` launch) | **official** | `igs_satellite_metadata.snx` & ISRO URSC brochure. |
| **ISRO I-1K main bus box** | `1.580 × 1.500 × 1.500 m` | **official** | Official ISRO / URSC I-1K cuboid dimensions (`1.58 × 1.50 × 1.50 m`). |
| **Solar array wings (`wing+Y`, `wing-Y`)** | `2` two-sided wings (`2.160 × 1.800 m/wing` modeled as two hinged `1.060 × 1.800 m` panels + `0.04 m` gap), `0.550 m` yoke → `6.920 m` span | **official / derived** | URSC official IRNSS-1 panel dimensions (`2.15 × 1.8 m` per wing, total area `~7.74 m²`, generating `1660 W`). |
| **Dual-band L5 + S helical array (`+Z`)** | `12`-element shaped-beam helix array (`0.98 × 0.98 m` plate) | **measured / derived** | Characteristic ISRO IRNSS-1 dual-band L5/S-band helical cluster + C-band CDMA ranging horns. |
| **Laser Retroreflector Array (`LRA_IRNSS_1`)** | `(-0.436, +0.528, +0.920) m` | **official / derived** | Exact horizontal offset `(-0.4360, +0.5280)` m from `igs_satellite_metadata.snx` (`LRA_IRNSS_1`). |
| **440 N LAM apogee thruster (`-Z`)** | Nozzle & thermal shield down to `Z = -1.110 m` | **measured / derived** | Standard ISRO I-1K apogee thruster + adapter skirt. |
| **Overall bounding box (`X × Y × Z`)** | `1.814 × 6.920 × 2.250 m` | **derived** | Compact I-1K cuboid + LAM/helix envelope. |

---

## 3. Simplifications & Omissions

- Separated from `navic-nvs` (`IRS-2G`/`IRS-2I`) because IRNSS-1 uses the compact `1.50 m`-tall I-1K bus (`700 kg` dry mass, `1.66 kW` single-span wings) rather than the larger `2.40 m`-tall I-2K bus (`1500 kg` dry mass).
- Corner star tracker baffles, propellant valves, and feed coax lines are kept low-poly under `3,500` triangles.

---

## 4. Verification Output (`verify.py`)

```text
FILE_SIZE_BYTES 705136 (0.672 MB)
REIMPORT_TRIANGLES 3426
REIMPORT_BBOX_MIN (-1.008, -3.46, -1.11)
REIMPORT_BBOX_MAX (0.805, 3.46, 1.14)
REIMPORT_BBOX_SIZE (1.814, 6.92, 2.25)
WING_NODES wing+Y T=[0, 0, -0.75], wing-Y T=[0, 0, 0.75]
EXPECTED_SIZE (1.814, 6.92, 2.25) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```
