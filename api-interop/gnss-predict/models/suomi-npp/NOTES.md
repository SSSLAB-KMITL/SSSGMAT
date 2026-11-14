# Suomi NPP / NOAA-20 (`suomi-npp`) — Ball BCP-2000 Bus

## Source & License Attribution
- Upstream model: `models/vendor/nasa/Suomi_National_Polar-orbiting_Partnership_Suomi_NPP.glb`
  from **NASA 3D Resources** (`nasa/NASA-3D-Resources`, U.S. Government / public domain).
- Authoritative mission dimensions & bus attribution:
  NASA / ESA eoPortal (`~4.18 m` length × `~8.96 m` solar array span × `~2.57 m` bus width).
- Spacecraft covered (`norad_ids`):
  - `37849` — Suomi NPP (`2011-061A`, Ball Aerospace BCP-2000 bus)
  - `43013` — NOAA-20 / JPSS-1 (`2017-073A`, identical Ball Aerospace BCP-2000 bus)
  - Note: NOAA-21 (`54234`, JPSS-2) uses the Northrop Grumman LEOStar-3 bus and is intentionally excluded.

## Frame & Conversion Notes
- Raw vendor GLB is already in `1:1` metres. `scripts/build.py` rotates `+90 deg`
  around Y so the nadir instrument deck (`VIIRS`, `CrIS`, `ATMS`, `OMPS`, `CERES`)
  faces `+Z` and the 3-panel single solar array wing (`wing-Y`) extends along `-Y`
  (`T_gltf = [0, 0, 0.8494]`).
- Embedded PBR textures (`AO_01`, `tex_01`, `tex_02`) are downscaled from `1024x1024`
  to `512x512` to stay comfortably under the `1.5 MB` budget.

## Verification (`verify.py --single-wing`)
```
FILE_SIZE_BYTES 922868 (0.880 MB)
REIMPORT_TRIANGLES 4024
  bus                    3166
  wing-Y                  858
REIMPORT_BBOX_MIN (-2.092, -8.229, -1.284)
REIMPORT_BBOX_MAX (2.092, 0.729, 1.284)
REIMPORT_BBOX_SIZE (4.183, 8.959, 2.569)
IMAGES [('AO_01', (512, 512)), ('foil_gold_ramp', (256, 256)), ('foil_silver_ramp', (256, 256)), ('tex_01', (512, 512)), ('tex_02', (512, 512))]
WING_NODE wing-Y T=[0, 0, 0.8493806719779968]
EXPECTED_SIZE (4.18, 8.96, 2.57) REL_DIFF_PCT (0.07, 0.01, 0.04)
VERIFY_STATUS PASS
```
