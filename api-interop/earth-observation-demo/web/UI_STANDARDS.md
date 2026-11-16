# Interface conventions

The app uses a shared visual layer in `src/modern.css` over the original dock
panel styles in `src/theme.css`, with a black theme in `src/dark.css`. The two
original, unmodified institutional/laboratory logos are served locally from
`public/brand`. Colors, border treatment, spacing and typography
are shared across imagery, summaries, free samples and viewing geometry. Main
navigation is implemented by `AppNavigation.tsx`. Free optical examples keep
their own area, time, platform and orbit context.

- Navigation has explicit accessible names and selected states. Supporting
  tools use native disclosure controls, close on outside interaction or Escape,
  and restore keyboard focus on Escape. The page provides a skip link, one
  visible page heading in the scroll layout and named sections/regions.
- The page reflows at narrow widths; mobile area selection uses a native
  dropdown. Images, maps and data tables retain their own scrolling surfaces.
  Full-sized imagery and vertical page scrolling remain available.
- Important controls are at least 40 px tall on desktop and 44 px on mobile.
  Timeline markers retain a small visual tick within a larger target, with the
  acquisition dropdown providing an equivalent selection control.
- Shared text/surface and primary button pairs exceed 4.5:1 calculated contrast.
  Visible keyboard focus, non-color selected indicators and screen-reader
  readiness labels supplement color states.
- CSS respects reduced-motion preferences; camera fitting also skips animated
  flights when reduced motion is requested. Image loading, failure/retry and
  empty catalog states are explicit.

References: [WCAG 2.2 reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
[contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Validation: `npm test` covers navigation, selected data consistency, menus and
focus, recovery from request failures and axe checks for the workspace and
optical sample controls. The JSDOM axe checks exclude color contrast, which
requires real rendering; palette contrast is checked separately. Real-browser
visual checks cover desktop and mobile layouts. These checks are a development
baseline, not a certification of full WCAG conformance. The Cesium canvas and
the advanced dock layout still need a dedicated assistive-technology audit.

Job status uses finite, visibility-aware polling. Hidden tabs pause their
requests; the high-resolution page uses its own detector status polling.
The legacy EventSource endpoint returns a single snapshot with a reconnect
delay rather than holding an HTTP/1 connection open. This keeps browser slots
available for Cesium workers, base map textures and geometry. Content-hashed
build assets are retained across local builds so an already-open tab can still
load its version of the lazy 3D renderer. The globe has an explicit WGS84 terrain
provider and a whole-Earth camera reset.
