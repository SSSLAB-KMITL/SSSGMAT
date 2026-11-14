# NOAA-21 / JPSS-2 (`noaa-21`) — Northrop Grumman LEOStar-3 Bus

Procedural, real-scale 3D model of **NOAA-21** (pre-launch **JPSS-2**, **NORAD ID `54234`**, **COSPAR `2022-150A`**) built on the **Northrop Grumman (formerly Orbital ATK) LEOStar-3** spacecraft bus. Built in headless Blender (`scripts/build.py`) using only original procedural geometry and procedural PBR textures. (Suomi NPP `37849` and NOAA-20 `43013` use the Ball BCP-2000 bus in `suomi-npp/`.)

## Coordinate Convention & Rigging
- `+X`: Velocity / Ram vector (fore electronics bay; `-X` aft orbit-adjust propulsion module)
- `+Y`: Starboard cold-space side (OSR thermal radiator panel)
- `-Y`: Port sun-side SADA mount (`sadm_-Y`) and articulated 5-panel solar wing (`wing-Y`, `T_gltf = [-0.35, 0, 1.05]`)
- `+Z`: Nadir Earth-facing instrument deck (`VIIRS`, `CrIS`, `ATMS`, `OMPS-Nadir`, aft `OMPS-Limb`, Ka/X-band HGA dish, S-band/GNSS omni antennas)
- `-Z`: Zenith propulsion deck, S-band omni antenna, and dual canted star trackers
- `-X`: Solar cell active face normal at zero SADA rotation (`"cell_normal": "-X"`, matching the 1:30 PM ascending JPSS sun-synchronous orbit and `suomi-npp` convention)

## Verified Specifications & Sources

| Parameter | Value | Tag | Source / Basis |
|---|---|---|---|
| **Identifiers** | NORAD `54234`, COSPAR `2022-150A` | **official** | NASA / NOAA NESDIS / CelesTrak / N2YO (`2022-150A` launched 2022-11-10 on Atlas V). |
| **Platform / Bus** | Northrop Grumman `LEOStar-3` (chamfered octagonal prism) | **official** | NASA / ESA eoPortal JPSS-2 / NOAA-21 spacecraft overview. |
| **Body dimensions** | `4.30 m` (X) × `2.10 m` (Y/Z across flats) (`14 ft × 7 ft`) | **official** | NOAA NESDIS / NASA JPSS-2 official specifications (~`4.3 m × 2.1 m`). |
| **Deployed Y span** | `10.71 m` total (`-9.65 .. +1.06 m`, `35 ft` nominal) | **official** | NOAA NESDIS (`35 ft ≈ 10.67 m` deployed span; single 5-panel `-Y` wing `5 × 1.540 × 2.150 m` + `0.70 m` yoke). |
| **Solar array** | Single `-Y` wing, **5 panels** (`~9 m` deployed arm, `~4.45 kW` EOL) | **official** | NASA / ESA eoPortal / AmericaSpace JPSS-2 solar array description. |
| **Observatory height (Z)** | `3.118 m` (`-1.358 .. +1.760 m`) | **derived / est.** | `2.10 m` bus + `0.71 m` nadir instrument/HGA deck + `0.31 m` zenith omni & star trackers (within `3.61 m` stowed envelope). |
| **`ATMS` instrument** | `0.70 × 0.60 × 0.40 m` | **official** | ESA eoPortal JPSS ATMS mechanical dimensions. |
| **`VIIRS`, `CrIS`, `OMPS-N/L`** | Scaled from NASA/eoPortal deck layout | **derived / est.** | NOAA / NASA JPSS-2 nadir optical bench (`VIIRS` forward, `CrIS` starboard-mid, `OMPS-Nadir` + aft `OMPS-Limb`). |
| **Model bbox (m)** | `4.300 × 10.710 × 3.118` (X × Y × Z) | **measured** | `verify.py --single-wing --expected-size 4.3,10.71,3.118` (`REL_DIFF_PCT = (0.0, 0.0, 0.0)`). |

## Mesh & Export Check (`_tools/verify.py --single-wing`)
- GLB: `noaa-21/noaa-21.glb` (`634,692` bytes / `0.605 MB`), `1,982` triangles (`bus` 498, `nadir_payload_deck` 1020, `sadm_-Y` 140, `wing-Y` 324)
- Wing node: `wing-Y` (`T=[-0.35, 0, 1.05]` in glTF Y-up space, pivot centered on `sadm_-Y`)
- Textures: procedural `tex_mli_gold`, `tex_mli_black`, `tex_mli_white` (+ normal maps), `tex_osr_tiles`, `tex_solar_front`, `tex_solar_back`
