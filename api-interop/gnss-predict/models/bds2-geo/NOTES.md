# BeiDou-2 GEO (`BDS-2G`) — 3D Model Technical Notes (`bds2-geo`)

Procedural, real-scale 3D model of a **BeiDou-2 geostationary navigation satellite (`BDS-2G`)** manufactured by CAST on the **DFH-3A** bus. Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures, split out from `bds2-igso` because `BDS-2G` carries a dedicated deployable ~2.0 m **RDSS C/S-band mesh reflector** on its `+X` face for geostationary Radio Determination Satellite Service (short-message / timing) communications.

## Coordinate Convention & Rigging
- `+Z`: Nadir (Earth-facing payload deck with L-band helical array, C-band uplink/S-band downlink antennas, deployable `+X -> +Z` RDSS reflector, and `BDS-2G` SHAO 90-prism LRA)
- `+Y / -Y`: Solar array drive axis (`wing+Y`, `wing-Y`)
- `-X`: Sun-facing cell normal at zero SADA rotation (`"cell_normal": "-X"`)
- Origin: Bus geometric center

## Verified Specifications & Sources

| Parameter | Value | Tag | Source / Basis |
|---|---|---|---|
| **IGS block code** | `BDS-2G` | **official** | `igs_satellite_metadata.snx` (BeiDou-2 GEO fleet: G1–G8, COSPAR 2010–2019). |
| **Platform / Bus** | CAST DFH-3A (~2.0 × 1.72 × 2.2 m) | **official** | CAST / CSNO BeiDou-2 ICD & DFH-3A platform documentation (`bus_x = 2.00 m`, `bus_y = 1.72 m`, `bus_z = 2.20 m`). |
| **Solar array span** | 16.24 m tip-to-tip | **official** | Two 4-panel wings (`4 × 1.720 × 1.640 m` + `0.48 m` yoke/SADM offset per side, matching `bds2-igso`). |
| **RDSS mesh reflector** | Ø 2.00 m (~3.14 m²), `+X` offset arm (`+1.95 m`) | **derived / est.** | CAST DFH-3A GEO RDSS C/S-band deployable mesh reflector on the ram/+X side (`DISH_R = 1.00 m`, total `+X` reach `+2.950 m`, width `3.975 m`). |
| **LRA (`BDS-2G`)** | 90-prism (`LRA_BDS_SHAO_90`) at `(-0.6241, -0.5705, +1.1000)` m | **official** | IGS `igs_satellite_metadata.snx` / ILRS BeiDou-2 GEO retroreflector offset table. |
| **Model bbox (m)** | `3.975 × 16.240 × 2.920` (X × Y × Z) | **measured** | `verify.py` (`REL_DIFF_PCT = (0.0, 0.0, 0.0)`, `VERIFY_STATUS PASS`). |

## Mesh & Export Check (`_tools/verify.py`)
- GLB: `bds2-geo/bds2-geo.glb` (`691,540` bytes / `0.660 MB`), `6,072` triangles
- Wing nodes: `wing+Y` (`T=[0, 0, -0.86]`), `wing-Y` (`T=[0, 0, 0.86]`) in glTF Y-up space
- Textures: procedural `tex_mli_gold`, `tex_mli_black` (+ normal maps), `tex_osr_tiles`, `tex_solar_front`, `tex_solar_back`
