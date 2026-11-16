# Free high-resolution optical examples

Verified 2026-11-15. The app's **Free high-res samples** page reads the fixed manifest in `highres-samples.json`; these are independent optical examples with their own geography and acquisition dates. They are not optical acquisitions of the currently selected Umbra scene. No tasking, paid API, account, generated imagery, or local super-resolution is used.

| Example | Satellite | Acquisition | Provider-reported GSD | Free release |
| --- | --- | --- | --- | --- |
| Las Vegas urban blocks | WorldView-3 | 2015-10-22 18:36:56 UTC | 0.30 m | SpaceNet, CC BY-SA 4.0 |
| Rotterdam port / shipyards | WorldView-2 | 2019-08-31 (time not supplied) | 0.50 m | SpaceNet 6, CC BY-SA 4.0 |
| Bangkok roads / Bang Sue district | WorldView-3 | 2025-02-14 04:02:16 UTC | 0.38 m | Maxar Open Data, CC BY-NC 4.0 |
| Mandalay International Airport apron | GeoEye-1 | 2025-03-26 04:22:44 UTC | 0.46 m | Maxar Open Data, CC BY-NC 4.0 |

Primary provenance and licence evidence:

- [SpaceNet Las Vegas](https://spacenet.ai/las-vegas/), [SpaceNet 2 licence and citation](https://spacenet.ai/spacenet-buildings-dataset-v2/).
- [SpaceNet Rotterdam optical source and acquisition date](https://spacenet.ai/rotterdam/), [SpaceNet 6 licence and expanded optical release](https://spacenet.ai/sn6-challenge/). The RGB source is the optical WorldView-2 product. SpaceNet 6's associated Capella SAR was collected from an aircraft; it is not used on this page.
- [Maxar Open Data registry, licence and anonymous bucket access](https://registry.opendata.aws/maxar-open-data/), [Vantor Open Data Program](https://vantor.com/company/open-data-program/), [public event catalog](https://maxar-opendata.s3.amazonaws.com/events/catalog.json).
- Exact public STAC items for Bangkok and Mandalay, source asset URLs, licence links and GSD are retained in `highres-bangkok-item.json`, `highres-mandalay-item.json`, and `highres-samples.json`. The generic ARD acquisition collections say `proprietary`; the specific public event catalog and Open Data Program grant CC BY-NC 4.0 for the public release. This discrepancy is retained in the manifest's `metadata_license_note` rather than replacing the source metadata.

GSD is kept separate from output pixel spacing. The Maxar ARD visual products use a ~0.305 m grid and vendor HD processing, while their recorded source GSD is 0.38 m / 0.46 m. The app reports the latter and renders at that spacing or coarser. The SpaceNet Las Vegas COG is uint16 RGB; the renderer uses one 2–98 percentile display stretch per band, reused for all three crops. Uint8 visual sources retain their supplied RGB values before reprojection.

Only bounded 500 m, 250 m and 100 m windows are read. Local PNGs, GeoTIFF source metadata, valid coverage, exact crop bounds, display stretch, and provenance JSON are cached under `data/highres-samples/`. PNG metadata also includes source URL, attribution, acquisition and licence. Image reuse must retain the displayed attribution and the applicable image licence, including NonCommercial / ShareAlike conditions.

Rebuild with `.venv/bin/python bootstrap_highres.py` or `--sample <id>`. No multi-GB archive download is required. Source geography is limited: Rotterdam's optical example is near 4.379 E, 51.906 N and is different from the original Botlek ROI. The Bangkok example is not Suvarnabhumi Airport. No coverage claim is made for Singapore.

Airbus Pléiades Neo and Planet SkySat evaluation sample pages are linked separately in the app; their imagery is not copied or advertised as an unrestricted free global archive.

## Satellite position metadata audit

The public Las Vegas PS-RGB XML matches catalog 10400100137F4900 and contains IMD/TIL/RPB, with mean satellite azimuth 150.6°, mean satellite elevation 71.3°, and mean off-nadir 16.8°. No EPH state-vector section was found. The Bangkok and Mandalay ARD items expose raw STAC view angles but no ECEF/geodetic satellite position. No ephemeris was found for the checked Rotterdam optical release. These are explicit unavailable-position states in the API, separate from the ground sample coordinates.

The ARD incidence fields are displayed as raw provider metadata. No satellite elevation, altitude, or position is inferred from them. Authoritative definitions: [Maxar tile metadata](https://developers.maxar.com/docs/specifications/ard-user-guide/ard-output-files/tile-metadata), [Maxar image support data and EPH description](https://docs.eapi.maxar.com/home/user-guides/ordering/#image-support-data).

## Independent historical orbit estimates

The Free samples page now supplies a separate `orbit_solution`, derived from historical TLEs rather than image-provider ephemerides. Raw responses, request URLs, original names and collection timestamps are pinned in `research/orbits/*-tle.json`. Source: [IAU CPS SatChecker orbital data access](https://satchecker.readthedocs.io/en/latest/tools_data_access.html). Platform identity is checked by NORAD ID, not temporary satellite names: WorldView-3 = 40115, WorldView-2 = 35946, GeoEye-1 = 33331.

Skyfield/SGP4 propagates each archived TLE at the image metadata UTC, converts TEME to ITRS/ECEF, and reports the WGS84 sub-satellite latitude, longitude and ellipsoid height. The Las Vegas, Bangkok and Mandalay TLE epochs are within six hours of their image timestamps. The Rotterdam image has only a date: no default satellite position is asserted. A user may select UTC on that day; the resulting orbit position is explicitly a selected-time estimate, not a verified acquisition position. The API rejects missing timezones, non-UTC times, dates outside the image date and extrapolation beyond 48 hours from the archived epoch. Requests use local archived inputs and the built-in timescale, without network downloads.

The Las Vegas archive response contains a trailing backslash after TLE line 1. The original response is retained; the calculation removes that single extra character, then validates both 69-character line lengths, satellite IDs and checksums. `date_collected` is archive ingestion time, not the orbit epoch or image capture time.

The UI labels all results as estimates and preserves the original provider-position-unavailable metadata audit. TLEs do not support meter-accurate image pointing; image metadata time may also differ from per-pixel time. See [Skyfield satellite prediction limitations](https://rhodesmill.org/skyfield/earth-satellites.html). One position is drawn for the selected instant; no optical collection duration or continuous imaging trajectory is invented. The translucent links connect that position to the displayed 500 m crop, a schematic graphic rather than a calibrated sensor field of view. Lines through Earth are suppressed for targets and crops below the satellite horizon. Ground targets use WGS84 ellipsoid height zero.

`GET /api/eo/samples/{id}/orbit` returns the default solution. An optional `at_utc=YYYY-MM-DDTHH:MM:SSZ` computes a user-selected instant. The coordinate export includes method, raw source record, normalized TLE lines, epoch, time basis and computed ECEF. RGB caches and source signatures remain independent of orbit calculations.
