# NavIC 2nd-Gen NVS (`IRS-2G`, `IRS-2I`) — 3D Model Technical Notes (`navic-nvs`)

Procedural, real-scale 3D model of India's second-generation **NavIC NVS-01 / NVS-02** navigation satellites, built by ISRO on the **I-2K** spacecraft bus (IGS blocks `IRS-2G`, `IRS-2I`). Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures.

---

## 1. Coordinate Frame & Export Conventions

Matches `galileo-foc`:
- **Origin**: Geometric centre of the I-2K main bus box (`[0, 0, 0]` m).
- **+Z**: Tri-band (L1/L5/S) navigation antenna boresight (toward Earth / nadir).
- **+Y**: Nominal solar-array drive axis (`wing+Y` on `+Y`, `wing-Y` on `-Y`).
- **+X**: Completes the right-handed body frame (`X = Y × Z`).
- **Units**: Metres (`1.0` unit = `1.0` m).
- **glTF export**: Standard `+Y up` axis conversion (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes**: `wing+Y` (pivot `(0.000, +0.765, 0.000)` m) and `wing-Y` (pivot `(0.000, -0.765, 0.000)` m) with identity rotation.

---

## 2. Authoritative Dimensions & Provenance

| Component / Parameter | Value | Status | Source & Notes |
|---|---|---|---|
| **IGS block codes** | `IRS-2G`, `IRS-2I` | **official** | `igs_satellite_metadata.snx` (`I010` NVS-01 = `IRS-2G`; `I011` NVS-02 = `IRS-2I`). |
| **Mass** | `1500.0 kg` (SNX); `~2232–2250 kg` launch | **official** | `igs_satellite_metadata.snx` & ISRO NVS-01/02 press releases (double the I-1K `700 kg` SNX mass). |
| **ISRO I-2K main bus box** | `1.650 × 1.530 × 2.400 m` | **official** | Official IN-SPACe / ISRO I-2K standard platform (`1.6 × 1.5 × 2.4 m`; secondary Encyclopedia Astronautica listing cites `1.65 × 1.53 × 3.0 m`). |
| **Solar wings (`wing+Y`, `wing-Y`)** | `2 wings × 2 panels` (`1.650 × 1.500 m/panel`, `9.90 m²` total), `0.635 m` yoke, `0.050 m` gap → `9.500 m` span | **derived / est.** | Span matches NVS-01 (`~9.50 m` via satellitemap; ESA eoPortal I-2K class cites `~9.0 m`); `9.90 m²` derived for `2.4 kW` (NVS-01) / `~3 kW` (NVS-02) ISRO GaAs arrays and stowed `1.65 × 1.50 m <= 1.65 × 2.40 m` bus wall. |
| **Tri-band L1 + L5 + S payload deck (`+Z`)** | `0.68 × 0.88 m` L1/L5 5×5 patch array + `8`-element S-band helical cluster + C-band horn | **derived / est.** | Representative layout reflecting NVS-01/02 addition of L1 civilian signal alongside L5 and S-band payload antennas (no public ISRO ICD drawing). |
| **-Z LAM apogee engine & adapter** | Extends down to `Z = -1.700 m` | **derived** | Standard I-2K 440 N LAM thruster and launch adapter cone. |
| **Overall bounding box (`X × Y × Z`)** | `1.916 × 9.500 × 3.316 m` | **derived** | Distinct in both height (`3.32 m` vs `2.25 m`) and wing span (`9.50 m` vs `6.92 m`) from `navic-irnss1`. |

---

## 3. Simplifications & Omissions

- Separated from `navic-irnss1` due to the transition from I-1K (`700 kg`, `1.5 m` bus, `1.66 kW`) to I-2K (`1500 kg`, `2.4 m` bus, `2.4–3.0 kW`) and addition of L1 signal hardware.
- Indigenous Rubidium atomic clock (iRAFS) thermal radiator bay is represented cleanly via OSR radiator plates on the `±X` bus faces.

---

## 4. Verification Output (`verify.py`)

```text
FILE_SIZE_BYTES 694292 (0.662 MB)
REIMPORT_TRIANGLES 2820
REIMPORT_BBOX_MIN (-1.065, -4.75, -1.7)
REIMPORT_BBOX_MAX (0.851, 4.75, 1.616)
REIMPORT_BBOX_SIZE (1.916, 9.5, 3.316)
WING_NODES wing+Y T=[0, 0, -0.7649999856948853], wing-Y T=[0, 0, 0.7649999856948853]
EXPECTED_SIZE (1.916, 9.5, 3.316) REL_DIFF_PCT (0.0, 0.0, 0.0)
VERIFY_STATUS PASS
```

