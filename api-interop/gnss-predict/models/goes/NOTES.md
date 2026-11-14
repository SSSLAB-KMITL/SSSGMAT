# GOES-R Series (`goes`) — GOES-16 / 17 / 18 / 19 (Lockheed Martin A2100)

## Source & License Attribution
- Upstream model: `models/vendor/nasa/Geostationary_Operational_Environmental_Satellites.glb`
  from **NASA 3D Resources** (`nasa/NASA-3D-Resources`, U.S. Government / public domain).
- Authoritative mission dimensions & configuration:
  NOAA / NASA GOES-R Series Data Book (`~6.1 m × 5.6 m × 3.9 m` core spacecraft,
  5-panel single solar array wing `~5.94 m × 3.40 m` + EXIS/SUVI sun-pointed yoke,
  deployed magnetometer boom `~8 m` (`26 ft`); overall deployed envelope
  `11.14 m × 13.44 m × 12.20 m`).
- Spacecraft covered (`norad_ids`):
  - `41866` — GOES-16 / GOES-East (`2016-071A`)
  - `43226` — GOES-17 (`2018-022A`)
  - `51850` — GOES-18 / GOES-West (`2022-021A`)
  - `60133` — GOES-19 (`2024-119A`)

## Frame & Conversion Notes
- Raw vendor GLB is scaled by `0.01` (`scale = 100.0` restores exact metres),
  and rotated `+90 deg` around Z so the Earth-viewing nadir instrument deck (`ABI`,
  `GLM`, `EXIS`, `SUVI` yoke cutout) faces `+Z`, the magnetometer boom extends
  away from nadir (`-X/-Z`), and the single solar array wing (`wing-Y`) extends
  along `-Y` (`T_gltf = [0, 0.1588, 2.1765]`, SADM root on `-Y` wall).
- Decimation welds disconnected raw CAD triangle soup (`weld_dist=0.0005`), applies
  `1.5 deg` / `1.0 deg` material-delimited planar dissolve before collapse decimation,
  and applies a `35 deg` sharp edge split so flat structural walls remain crisp.

## Verification (`verify.py --single-wing`)
```
FILE_SIZE_BYTES 797668 (0.761 MB)
REIMPORT_TRIANGLES 14799
  bus                    9799
  wing-Y                 5000
REIMPORT_BBOX_MIN (-8.635, -9.655, -9.465)
REIMPORT_BBOX_MAX (2.505, 3.789, 2.732)
REIMPORT_BBOX_SIZE (11.14, 13.444, 12.197)
IMAGES []
WING_NODE wing-Y T=[0, 0.1587846875190735, 2.176452159881592]
EXPECTED_SIZE (11.14, 13.44, 12.2) REL_DIFF_PCT (0.0, 0.03, 0.02)
VERIFY_STATUS PASS
```
