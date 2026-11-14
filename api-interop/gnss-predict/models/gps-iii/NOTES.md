# GPS Block III (`gps-iii`) — procedural 3D model

## Files

- **`gps-iii.glb`**: 620,348 bytes (0.592 MB), 4,070 triangles, 10 meshes, 16 materials, 7 generated PNG textures (max 1024×512).
- **`scripts/build.py`**: builds the model, exports `gps-iii.glb`, and renders the preview JPEGs (`renders/01_earth_face.jpg`, `02_side_span.jpg`, `03_three_quarter.jpg`, `04_closeup.jpg`) using shared helpers in `models/_tools/`.
- **`textures/`**: procedurally generated textures (`tex_mli_black`, `tex_mli_gold`, `tex_osr_tiles`, `tex_solar_front`, `tex_solar_back` and normal maps).

## 1. Frame and wing nodes

- **Body frame:** **+Z** = navigation antenna boresight (toward Earth), **+Y** = solar-array rotation axis, **+X** completes the right-handed frame. Origin at the geometric centre of the bus box.
- **glTF export:** standard Blender +Y up (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes:** `wing+Y` and `wing-Y` with pivots on the SADM axis at body `(0.0, ±0.890, -0.200)` m (glTF `(0.0, -0.200, ∓0.890)` m), identity rotation, solar cells facing `-X`.

## 2. Dimension table

| Item | Value | Status / source |
|---|---|---|
| Bus box (`X × Y × Z`) | 2.460 × 1.780 × 3.400 m | official / literature (Steigenberger, Thölert & Montenbruck 2020, Table 3) |
| Solar array area | 28.20 m² total (14.10 m²/wing) | official / literature (Steigenberger et al. 2020, Table 3) |
| Solar wing panels | 2 panels per wing, each 3.680 × 1.916 × 0.025 m | derived from 28.20 m² total area and Lockheed Martin A2100M 2-panel wing layout (panel thickness est.) |
| Inter-panel hinge gap | 0.060 m | est. |
| Yoke length (bus `±Y` face to inner panel) | 1.150 m | derived / est. |
| Deployed wing span (`Y`) | 18.920 m | derived (`1.780 + 2 × (1.150 + 2×3.680 + 0.060)`) |
| SADM axis offset | `x = 0.00 m, z = -0.20 m` | est. from Lockheed Martin GPS III drawings |
| L-band helical array | 12 elements on `+Z` deck (`x = -0.20 m`): 4 inner (`r = 0.24 m`, `h = 0.44 m`) + 8 outer (`r = 0.58 m`, `h = 0.37 m`) | 8+4 element layout official; radii & heights est. |
| Laser Retroreflector Array (`LRA_GPS_III`) | 48 CCR prisms (`6 × 8`) at `(1.103, 0.007, +Z)` m; tray `0.210 × 0.280 × 0.045 m` | X, Y position & 48 prism count official (`igs_satellite_metadata.snx`); tray dimensions derived / est. |
| UHF cross-dipole, S-band TT&C, Earth sensor, `-Z` LAE nozzle | see `scripts/build.py` | est. from Lockheed Martin GPS III cleanroom photos |
| OSR radiator panels on `±Y` | `1.92 × 1.75 m` & `1.60 × 0.82 m` per side | est. from cleanroom photos |
| Overall bounding box (`X × Y × Z`) | 2.508 × 18.920 × 4.110 m | verified by `verify.py` |

## 3. Simplifications

- Helical elements use cylindrical radome tubes with metallic helical collars in gold cups.
- UHF/DASS cross-dipole mast, S-band TT&C horn, Earth sensor, and `-Z` Liquid Apogee Engine nozzle are simplified geometric primitives at estimated positions.

## 4. Sources

- **Steigenberger, P., Thölert, S., Montenbruck, O. (2020):** *GPS III Vespucci: Results of half a year in orbit*, Advances in Space Research, 66(9), 2123–2134.
- **IGS Satellite Metadata (`igs_satellite_metadata.snx`):** `LRA_GPS_III` eccentricity and prism count.
- **Lockheed Martin GPS III fact sheet.**

## 5. Verification output (`verify.py`)

```text
GLB magic=b'glTF' version=2 length=620348 bytes
FILE_SIZE_BYTES 620348 (0.592 MB)
REIMPORT_TRIANGLES 4070
REIMPORT_MESHES (name, tris, materials):
  aux_antennas_sensors    402  ['mli_gold', 'titanium_grey', 'aluminium', 'black_paint', 'white_paint', 'mli_black']
  bus                     224  ['mli_gold', 'mli_black']
  lband_antenna_array    1824  ['gold_kapton', 'radome_white', 'titanium_grey']
  lrr                     780  ['aluminium', 'lrr_holder', 'lrr_cube_glass']
  radiators_osr            48  ['osr_radiator']
  sadm_+Y                 140  ['mli_black', 'titanium_grey', 'bronze_anodised']
  sadm_-Y                 140  ['mli_black', 'titanium_grey', 'bronze_anodised']
  thrusters               224  ['titanium_grey', 'black_paint']
  wing+Y                  144  ['bronze_anodised', 'titanium_grey', 'solar_cells', 'panel_back_cfrp', 'panel_edge', 'gold_flex']
  wing-Y                  144  ['bronze_anodised', 'titanium_grey', 'solar_cells', 'panel_back_cfrp', 'panel_edge', 'gold_flex']
REIMPORT_BBOX_MIN (-1.254, -9.46, -1.92)
REIMPORT_BBOX_MAX (1.254, 9.46, 2.19)
REIMPORT_BBOX_SIZE (2.508, 18.92, 4.11)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, -0.20000000298023224, -0.8899999856948853], wing-Y T=[0, -0.20000000298023224, 0.8899999856948853]
EXPECTED_SIZE (2.5, 18.92, 4.11) REL_DIFF_PCT (0.32, 0.0, 0.0)
VERIFY_STATUS PASS
```
