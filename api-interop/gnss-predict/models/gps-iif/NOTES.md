# GPS Block IIF (`gps-iif`) — procedural 3D model

## Files

- **`gps-iif.glb`**: 568,812 bytes (0.542 MB), 3,538 triangles, 9 meshes, 14 materials, 7 generated PNG textures (max 1024×512).
- **`scripts/build.py`**: builds the model, exports `gps-iif.glb`, and renders the preview JPEGs (`renders/01_earth_face.jpg`, `02_side_span.jpg`, `03_three_quarter.jpg`, `04_closeup.jpg`) using shared helpers in `models/_tools/`.
- **`textures/`**: procedurally generated textures (`tex_mli_black`, `tex_mli_gold`, `tex_osr_tiles`, `tex_solar_front`, `tex_solar_back` and normal maps).

## 1. Frame and wing nodes

- **Body frame:** **+Z** = navigation antenna boresight (toward Earth), **+Y** = solar-array rotation axis, **+X** completes the right-handed frame. Origin at the geometric centre of the bus box.
- **glTF export:** standard Blender +Y up (`glTF (x, y, z) = body (x, z, -y)`).
- **Wing nodes:** `wing+Y` and `wing-Y` with pivots on the SADM axis at body `(0.0, ±1.245, -0.150)` m (glTF `(0.0, -0.150, ∓1.245)` m), identity rotation, solar cells facing `-X`.

## 2. Dimension table

| Item | Value | Status / source |
|---|---|---|
| Bus box (`X × Y × Z`) | 1.980 × 2.490 × 2.230 m | official / literature (Boeing GPS IIF fact sheet; Rodríguez-Solano et al. 2012, 2014) |
| Solar array area | 22.25 m² total (~11.125 m²/wing) | official / literature (Rodríguez-Solano et al. 2012; IGS repro3 `PROPBOXW.f`) |
| Solar wing panels | 3 panels per wing, each 1.940 × 1.880 × 0.025 m | derived from 22.25 m² total area and Boeing 3-panel wing layout (panel thickness est.) |
| Inter-panel hinge gap | 0.050 m | est. |
| Yoke length (bus `±Y` face to inner panel) | 1.150 m | derived from deployed span (16.63 m) |
| Deployed wing span (`Y`) | 16.630 m | official / literature (16.6–18 m deployed span range in USAF / eoPortal sheets) |
| SADM axis offset | `x = 0.00 m, z = -0.15 m` | est. from Boeing drawings |
| L-band helical array | 12 elements: 4 inner (`r = 0.25 m`, `h = 0.42 m`) + 8 outer (`r = 0.62 m`, `h = 0.35 m`) | element count & 4+8 layout official (Boeing / InsideGNSS); radii & heights derived / est. |
| Octagonal `+Z` antenna platen | `r = 0.78 m`, height `0.045 m` | est. from Boeing cleanroom photos |
| UHF cross-dipole, S-band TT&C, Earth sensor, `-X` APRA | see `scripts/build.py` | presence documented in Rodríguez-Solano (2012); dimensions & positions est. |
| OSR radiator panels on `±Y` and `±X` | `±Y`: `1.05×1.45` & `0.55×1.10 m`; `±X`: `1.55×0.65 m` | est. from Boeing photos and radiator area budget |
| Overall bounding box (`X × Y × Z`) | 2.300 × 16.630 × 2.875 m | verified by `verify.py` |

## 3. Simplifications

- Helical elements use white dielectric radome cylinders with external helical rings in gold cups rather than open wire helices.
- Secondary antennas (UHF cross-dipole, S-band TT&C, `-X` APRA, Earth/sun sensors) and `-Z` apogee kick motor nozzle use simplified geometric primitives at estimated positions.
- No external cable harnesses or thermal louver blades are modelled on the bus.

## 4. Sources

- **Rodríguez-Solano, C. J., Hugentobler, U., Steigenberger, P. (2012):** *Adjustable box-wing model for solar radiation pressure impacting GPS satellites*, Advances in Space Research, 49(7), 1113–1128.
- **Montenbruck, O. et al. (2015):** *GNSS satellite geometry and attitude models*, Advances in Space Research, 56(6), 1015–1029.
- **IGS Repro3 `PROPBOXW.f`:** https://files.igs.org/pub/resource/working_groups/repro3/PROPBOXW.f
- **Boeing / USAF GPS Block IIF fact sheet & InsideGNSS L-band array description.**

## 5. Verification output (`verify.py`)

```text
GLB magic=b'glTF' version=2 length=568812 bytes
FILE_SIZE_BYTES 568812 (0.542 MB)
REIMPORT_TRIANGLES 3538
REIMPORT_MESHES (name, tris, materials):
  aux_antennas_sensors    472  ['mli_gold', 'titanium_grey', 'aluminium', 'black_paint', 'white_paint', 'mli_black', 'radome_white']
  bus                     258  ['mli_gold', 'mli_black']
  lband_antenna_array    1824  ['gold_kapton', 'radome_white', 'titanium_grey']
  radiators_osr            72  ['osr_radiator']
  sadm_+Y                 140  ['mli_black', 'titanium_grey', 'bronze_anodised']
  sadm_-Y                 140  ['mli_black', 'titanium_grey', 'bronze_anodised']
  thrusters               224  ['titanium_grey', 'black_paint']
  wing+Y                  204  ['bronze_anodised', 'titanium_grey', 'solar_cells', 'panel_back_cfrp', 'panel_edge', 'gold_flex']
  wing-Y                  204  ['bronze_anodised', 'titanium_grey', 'solar_cells', 'panel_back_cfrp', 'panel_edge', 'gold_flex']
REIMPORT_BBOX_MIN (-1.29, -8.315, -1.295)
REIMPORT_BBOX_MAX (1.01, 8.315, 1.58)
REIMPORT_BBOX_SIZE (2.3, 16.63, 2.875)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODES wing+Y T=[0, -0.15000000596046448, -1.2450000047683716], wing-Y T=[0, -0.15000000596046448, 1.2450000047683716]
EXPECTED_SIZE (2.29, 16.63, 2.865) REL_DIFF_PCT (0.44, 0.0, 0.35)
VERIFY_STATUS PASS
```
