# Himawari-8 / Himawari-9 (`himawari-9`) — JMA MELCO DS2000

## Sources & Dimension Attribution
- Platform & deployed envelope: **Japan Meteorological Agency (JMA)** & **ESA eoPortal**
  Himawari-8 / -9 mission profiles (Mitsubishi Electric DS2000 geostationary platform):
  - Overall deployed dimensions: `5.2 m (X) × 8.0 m (Y) × 5.3 m (Z)`.
  - Power subsystem: **single** South (`-Y`) 3-panel GaAs solar array wing (`~2.6 kW`),
    leaving the North (`+Y`) face unobstructed for OSR radiators and AHI passive cooler.
  - Primary payload (`+Z` nadir): **AHI** (Advanced Himawari Imager, L3Harris 16-band
    multispectral radiometer) + 3-stage North-facing radiative cooler + **SEDA** monitor.
  - Communications (`±X` deployable reflector dishes): Ka-band (`18.1–18.4 GHz`) high-rate
    imagery downlink & Ku-band TT&C / UHF-DCS reflectors.
- Spacecraft covered (`norad_ids`):
  - `41836` — Himawari-9 (`2016-064A`)
  - `40267` — Himawari-8 (`2014-060A`, identical twin)

## Frame & Conversion Notes
- Built procedurally via `_tools/proc_lib.py` in metres with `+Z` nadir (AHI aperture,
  payload deck & parabolic dishes), `-Z` apogee motor / launch adapter, and a single
  South solar array wing (`wing-Y`, `T_gltf = [0, -0.35, 1.15]`, SADM pivot at `y = -1.15 m`).

## Verification (`verify.py --single-wing`)
```
FILE_SIZE_BYTES 648036 (0.618 MB)
REIMPORT_TRIANGLES 2496
  bus                     494
  nadir_payload           330
  reflectors             1328
  sadm_-Y                 140
  wing-Y                  204
REIMPORT_BBOX_MIN (-2.609, -6.64, -2.65)
REIMPORT_BBOX_MAX (2.609, 1.397, 2.65)
REIMPORT_BBOX_SIZE (5.218, 8.037, 5.3)
IMAGES [('tex_mli_black', (512, 512)), ('tex_mli_black_nrm', (512, 512)), ('tex_mli_gold', (512, 512)), ('tex_mli_gold_nrm', (512, 512)), ('tex_mli_white', (512, 512)), ('tex_mli_white_nrm', (512, 512)), ('tex_osr_tiles', (256, 256)), ('tex_solar_back', (512, 256)), ('tex_solar_front', (1024, 512))]
WING_NODE wing-Y T=[0, -0.3499999940395355, 1.149999976158142]
EXPECTED_SIZE (5.2, 8.0, 5.3) REL_DIFF_PCT (0.35, 0.46, 0.0)
VERIFY_STATUS PASS
```

