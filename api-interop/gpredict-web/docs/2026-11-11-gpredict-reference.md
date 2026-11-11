# Gpredict UI reference (labels, defaults, behaviour)

Reference for re-implementing the Gpredict user interface as a web app. It records names, labels, defaults and behaviour only. No code is copied.

## Sources and conventions

- **Code (authoritative):** `csete/gpredict`, branch `master`, commit `22593781` ("Version 2.7", 1 Nov 2026). All `file:line` citations refer to `src/<file>` at that commit. Labels are quoted exactly as written inside `_("…")` / `N_("…")`.
- **Manual (secondary):** "Gpredict User Manual", rev. 2.0 (7 Dec 2017, "work in progress for Gpredict 2.x"), from `doc/um/gpredict-user-manual.odt` in the same repo. It is cited as `UM §x.y p.N`, with page numbers taken from the manual's own table of contents. The SourceForge PDF was **not** checked separately.
- In menu labels, `_` marks the keyboard mnemonic. The text the user sees omits the underscore, so `_New module` displays as "New module" with Alt+N.
- `\n` is a line break and `\t` is a tab. `°` is U+00B0, written as `\302\260` in the source.
- **UNVERIFIED** marks anything that could not be confirmed in the code.
- When the manual and the code disagree, the code wins. The differences are listed in §13.

---

## 1. Main window

**Title:** "Gpredict" at start (`main.c:240`). When the user switches tabs, the title becomes "Gpredict: <tab label>" (`mod-mgr.c:599`, `mod-mgr.c:618`). When no module is docked, it is "Gpredict: (none)" (`mod-mgr.c:593`).
**Default size:** 700 × 700 (`sat-cfg.c:208-209`). The size is always restored. The position is restored only if "Restore position of main window" is checked (`main.c:251-260`).
**Contents:** a menu bar plus the module notebook, and nothing else (`gui.c:41-42`).
**Status bar:** there is **none**. No `GtkStatusbar` exists anywhere in `src/` (grep), so no status-bar contents are defined.
**CLI:** `--fullscreen`, "Start gpredict in fullscreen mode.", makes the main window full screen (`main.c:60-61`, `main.c:157-158`).
**First start:** opens the module "Amateur" (`sat-cfg.c:222`). The default ground station file is `sample.qth` (`sat-cfg.c:221`).

### Menu bar (order: File, Edit, Help, at `menubar.c:976`, `:982`, `:988`)

| Menu | Item (raw label) | Accel | Cite | Action / resulting UI |
|---|---|---|---|---|
| `_File` | `_New module` | Ctrl+N | `menubar.c:862` | Opens the "Create new module" dialog (§3) |
| | `_Open module` | Ctrl+O | `menubar.c:869` | Opens the dialog "Select a module" (`:341`) with one column "Module" (`:335`) and buttons Cancel/OK. If there are no modules: "You do not have any modules set up yet. Please use File->New in order to create a module." (`:308`) |
| | separator | | | |
| | `_Log browser` | Ctrl+L | `menubar.c:879` | Window "Log Browser" (`sat-log-browser.c:478`) |
| | separator | | | |
| | `_Quit` | Ctrl+Q | `menubar.c:889` | |
| `_Edit` | `Update TLE data from _network` | – | `menubar.c:904` | Dialog "TLE Update" (`:590`) showing "<b>Updating TLE files from network</b>" (`:607`), then "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n" (`:620-622`), then "Finished" (`:645`) |
| | `Update TLE data from local _files` | – | `menubar.c:909` | Dialog "Update TLE from files" (`:697`) with "Select TLE directory:" (`:687`) and a folder chooser "Select directory" (`:681`) |
| | `Update transponder data` | – | `menubar.c:914` | Dialog "Transponder Update" (`:515`) showing "<b>Updating transponder files from network</b>" (`:531`) |
| | separator | | | |
| | `_Preferences` | – | `menubar.c:922` | Preferences dialog (§11) |
| `_Help` | `_Online help` | F1 | `menubar.c:935` | Info box "A comprehensive PDF user manual and \nvideo tutorials are available from the \nGpredict website:" plus a link button to `http://gpredict.oz9aec.net/documents.php` (`:813-817`) |
| | separator | | | |
| | `_License` | – | `menubar.c:944` | Shows the COPYING text |
| | `_News` | – | `menubar.c:949` | Shows the NEWS text |
| | separator | | | |
| | `_About Gpredict` | – | `menubar.c:956` | GTK About dialog. Program name "Gpredict" (`about.c:122`) |

### How modules appear

- **Notebook:** scrollable, with a tab-list popup enabled (`mod-mgr.c:95-97`). The tab label is the module name (`mod-mgr.c:209-212`). Tabs can be reordered by dragging (`mod-mgr.c:215`). Tabs are hidden when exactly one module is docked (`mod-mgr.c:172-179`, `:243-250`).
- **States:** `DOCKED` (default), `WINDOW`, `FULLSCREEN` (`gtk-sat-module.h:19-21`, `gtk-sat-module.c:1047`).
  - Detach moves the module into its own top-level window (`gtk-sat-module-popup.c:345-432`).
  - "Full screen" from the docked state first creates a window and then full-screens it (`:516-552`).
  - From the window state it full-screens the window (`:567-571`).
  - "Exit full screen" returns the module to the **window** state, not to docked (`:575-579`).
  - "Attach module" from the window or full-screen state docks it back into the notebook (`:456-479`).
- **Detached window title:** "GPREDICT: <module> (<ground station>)" (`gtk-sat-module-popup.c:384`, `menubar.c:146`). When the window is restored at start-up the title is "Gpredict: <module> (<ground station>)" (`mod-mgr.c:699`). The capitalisation differs between the two.
- **Module header** (`gtk-sat-module.c:1058-1090`):
  - Left: a time label showing the *module* time, formatted with the global Time format and refreshed at most once per second (`:543-567`, `:1071-1074`). For a GPSD ground station the label reads "<time> GPS %0.3f seconds old" (`:556`).
  - Right: a flat button with the icon `open-menu-symbolic` and tooltip "Module menu" (`:1059-1066`). It opens the module popup (§2).
  - Below the header: a horizontal separator, then the view grid with homogeneous rows and columns (`:375-409`).
  - There is **no close (X) button** in the header. Use the popup's "Close" item.

## 2. Module popup menu (button "Module menu")

Built in `gtk-sat-module-popup.c:1088-1236`. Items in order:

| # | Label | Cite | Notes |
|---|---|---|---|
| 1 | "Detach module" (when docked) / "Attach module" (otherwise) | `:1110` / `:1117` | Toggles between docked and window |
| 2 | "Full screen" / "Exit full screen" (when full screen) | `:1132` / `:1125` | |
| – | separator | `:1139` | |
| 3 | "Autotrack" (check item) | `:1143` | When on, the module target is the satellite above the horizon, or else the one with the earliest AOS (`gtk-sat-module.c:95-130`) |
| 4 | "Select satellite" ▸ submenu | `:1150-1169` | Submenu lists satellite nicknames sorted by name. Picking one selects it in all views |
| – | separator | `:1172` | |
| 5 | "Sky at a glance" | `:1176` | Window "The sky at a glance (<module>)" (`:719`) |
| 6 | "Time Controller" | `:1182` | Window "Time Controller / <module>" (§9) |
| – | separator | `:1187` | |
| 7 | "Radio Control" | `:1191` | Window "Gpredict Radio Control: <module>" (`:825`). With no radio configured, an error dialog titled "ERROR": "You have no radio configuration!\nPlease configure a radio first." (`:813-817`) |
| 8 | "Antenna Control" | `:1196` | Window "Gpredict Rotator Control: <module>" (`:905`). With no rotator configured: "You have no rotator configuration!\nPlease configure an antenna rotator first." (`:893-897`) |
| – | separator | `:1201` | |
| 9 | "Configure" | `:1205` | Opens "Edit module" (§3). Blocked while a radio or rotator controller is open: "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again." (`:68-71`) |
| 10 | "Clone..." | `:1210` | See the Clone Module dialog below |
| – | separator | `:1215` | |
| 11 | "Delete" | `:1219` | Yes/No dialog: "This operation will permanently delete <b>%s</b> from the disk.\nDo you want to proceed?" (`:966-967`) |
| 12 | "Close" | `:1224` | |

**Clone Module dialog** (`gtk-sat-module-popup.c`):
- Title "Clone Module" (`:156`), buttons Cancel/OK (`:161-162`).
- Label "Name of new module:" (`:167`).
- Name entry: maximum 25 characters, pre-filled with the current name (`:173-174`). Tooltip "Enter a short name for this module.\nAllowed characters: 0..9, a..z, A..Z, - and _" (`:176-177`).
- Check box "Open module when created", default on (`:195-196`). Tooltip "If checked, the new module will be opened after it has been created" (`:198-199`).

## 3. Module configuration dialog (`mod-cfg.c`)

- **Title:** "Create new module" for File → New, "Edit module" for Configure (`:620`, `:622`).
- **Buttons:** "_Properties", "_Cancel", "_OK" (`:627-629`). Properties opens the module properties dialog described below.
- **Default height:** 400 px (`:902`).

| Field | Label / widget | Cite | Notes |
|---|---|---|---|
| Name | "Module name" + text entry | `:681`, `:641-668` | Maximum 25 characters. Allowed characters as in the Clone tooltip (`:654-655`). Read-only when editing. OK stays disabled until a name is entered |
| Ground station | "Ground station" + combo | `:686`, `:291-422` | Lists the `*.qth` files sorted by name, then "** DEFAULT **" last (`:389`). Tooltip "Select a ground station for this module." (`:674`) |
| | Button "Add" | `:692-693` | Tooltip "Add a new ground station". Opens "Edit ground station data" (§10) |
| Satellites header | "<b>Satellites</b>" | `:704` | |
| Available list | Satellite selector | `gtk-sat-selector.c` | Group combo with tooltip "Satellite group / category" (`:398`). First entry "All satellites" (`:736`) |
| | | | Search entry with tooltip "Search for a satellite by name or catalog number" (`:406`). Its clear icon has tooltip "Clear the search field" (`:420`) |
| | | | Columns "Available Satellites" (`:462`), "Catnum" (`:472`), "Updated" (`:482`). Name and Catnum are shown by default; Updated is hidden (`gtk-sat-selector.h:31`, `.c:388`) |
| Move buttons | " --> " / " <-- " | `:723-729` | Tooltips "Add satellite to list" / "Delete satellite from list" |
| Hint | "Double click on a satellite to move it to the other box." | `:734-735` | |
| Selected list | Columns "Selected Satellites", "Catnum", "Epoch" (hidden) | `:513`, `:522`, `:531-536` | Sorted by name. Double-click removes a satellite |

**Errors:**
- "Please select at least one satellite from the list." (`:966`)
- "There is already a module called %s.\nDo you want to overwrite this module?" (`:69-70`)

**Module properties dialog:**
- Title "Module properties", buttons Cancel/OK (`mod-cfg.c:847-851`).
- Notebook tabs: "Layout", "Refresh Rates", "List View", "Map View", "Polar View", "Single Sat View" (`sat-pref-modules.c:65-80`).
- There is no tab for the event list ("Upcoming passes") view.
- Every page has a "Reset" button. In module mode its tooltip is "Reset module settings to the global values."; in global mode it is "Reset settings to the default values." (e.g. `sat-pref-layout.c:449-461`). The Map View page uses different wording: "Reset settings to default values" / "Reset module to global settings" (`sat-pref-map-view.c:1439-1450`).

**Layout page** (`sat-pref-layout.c`):
- "Select layout:" combo (`:259`) with a thumbnail preview below it.
- "Layout code:" entry (`:291`). It is disabled unless "Custom" is selected (`:305-308`). Tooltip "This entry holds the layout code for the module.\nConsult the user manual for how to create custom layouts using layout codes." (`:299-302`).
- Shown only in **global** Preferences:
  - "<b>Window Placements:</b>" (`:334`)
  - "Restore position of main window" (`:339`)
  - "Restore position of module windows" (`:354`)
  - "Restore the state of modules when reopened (docked or window)" (`:370`)
  - All three default to off (`sat-cfg.c:117-119`).

**Layout code:** groups of five integers, `type;left;right;top;bottom`, on an invisible grid. Types:
- `0` List
- `1` Map
- `2` Polar
- `3` Single sat
- `4` Event list ("Upcoming passes")

Sources: `gtk-sat-module.h:26-30`, `gtk-sat-module.c:353-369`, `:395-406`, UM §8 p.62. The default code is preset 0 (`sat-cfg.c:224`).

**Built-in presets** (`sat-pref-layout.c:55-71`; the combo shows them in this order):

| # | Label | Code | Arrangement (decoded) |
|---|---|---|---|
| 0 | "World map, polar and single sat" (default) | `1;0;2;0;1;2;0;1;1;2;3;1;2;1;2` | Map across the top half. Polar bottom-left, single sat bottom-right |
| 1 | "World map" | `1;0;2;0;1` | Map only |
| 2 | "Table" | `0;0;2;0;1` | List only |
| 3 | "World map and table" | `1;0;2;0;2;0;0;2;2;3` | Map in the top 2/3, list in the bottom 1/3 |
| 4 | "Polar and single sat" | `2;0;1;0;1;3;1;2;0;1` | Polar left, single sat right |
| 5 | "Polar and upcoming passes" | `2;0;1;0;1;4;1;2;0;1` | Polar left, event list right |
| 6 | "All views (narrow)" | `1;0;3;0;4;0;0;3;4;6;2;0;1;6;8;3;1;2;6;8;4;2;3;6;8` | Map at rows 0-4, list at rows 4-6, then polar / single / events side by side at rows 6-8 |
| 7 | "All views (wide)" | `1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;4;3;4;2;3;3;3;4;3;4` | Map at columns 0-3 rows 0-3, list at columns 0-3 rows 3-4. Right column: polar (rows 0-2), events (2-3), single (3-4) |
| 8 | "Map, table, polar and single sat (wide)" | `1;0;3;0;3;0;0;3;3;4;2;3;4;0;2;3;3;4;2;4` | Like #7, but the right column holds polar (rows 0-2) and single sat (2-4) |
| 9 | "Custom" | (free text) | Code entry enabled |

**Refresh Rates page** (`sat-pref-refresh.c`; defaults from `sat-cfg.c`):

| Label | Range | Unit label | Default |
|---|---|---|---|
| "Refresh data every" (`:250`) | 100–10000 (`:254`) | "[msec]" (`:274`) | 300 (`sat-cfg.c:148`) |
| "Refresh list view every" (`:282`) | 1–50 | "[cycle]" | 1 (`:155`) |
| "Refresh map view every" (`:311`) | 1–50 | "[cycle]" | 10 (`:158`) |
| "Refresh polar view every" (`:340`) | 1–50 | "[cycle]" | 3 (`:172`) |
| "Refresh single-sat view every" (`:370`) | 1–50 | "[cycle]" | 1 (`:181`) |

The event list refresh exists as a config key (default 1, `sat-cfg.c:184`) but has no control in the UI.

## 4. List view (`gtk-sat-list.c`)

The column titles and the hints below are also used as the check-box labels and tooltips on the "List View" preference page. That page shows the bold header "<b>Visible Fields:</b>" and 27 check boxes in three columns (`sat-pref-list-view.c:180-196`).

| # | Title (`:50-76`) | Hint (`:83-109`) | Rendered as / unit | Default visible |
|---|---|---|---|---|
| 0 | "Satellite" | "Satellite Name" | nickname, left-aligned | ✔ |
| 1 | "Catnum" | "Catalogue Number" | integer | |
| 2 | "Az" | "Azimuth" | `%.2f°` | ✔ |
| 3 | "El" | "Elevation" | `%.2f°` | ✔ |
| 4 | "Dir" | "Direction" | "G" = GEO, "D" = decayed, "↓" = receding (range rate > 0.001), "↑" = approaching (< −0.001), "↺" / "↷" = turning (`:651-692`) | ✔ |
| 5 | "Ra" | "Right Ascension" | `%.2f°` | |
| 6 | "Dec" | "Declination" | `%.2f°` | |
| 7 | "Range" | "Slant Range" | `%.0f` km (or mi) | ✔ |
| 8 | "Rate" | "Range Rate" | `%.3f` km/s (or mi/s) | |
| 9 | "Next Event" | "Next Event" | `<time format> (AOS)` or `<time format> (LOS)`, else "--- N/A ---" (`:744-788`) | ✔ |
| 10 | "Next AOS" | "Next AOS" | time format, else "--- N/A ---" | |
| 11 | "Next LOS" | "Next LOS" | time format, else "--- N/A ---" | |
| 12 | "Lat" | "Latitude" | `%.2f°` + N/S suffix if N/S/E/W is on, else signed | |
| 13 | "Lon" | "Longitude" | `%.2f°` + E/W suffix if N/S/E/W is on, else signed | |
| 14 | "SSP" | "Sub-Satellite Point" | 6-character Maidenhead locator | |
| 15 | "Footp" | "Footprint" | `%.0f` km (or mi) | |
| 16 | "Alt" | "Altitude" | `%.0f` km (or mi) | ✔ |
| 17 | "Vel" | "Velocity" | `%.3f` km/s (or mi/s) | |
| 18 | "Dop" | "Doppler Shift @ 100MHz" | `%.0f` Hz = −100e6·rate/299792.458 (`:627-632`) | |
| 19 | "Loss" | "Signal Loss @ 100MHz" | `%.2f` dB = 72.4 + 20·log10(range in km) (`:643-648`) | |
| 20 | "Del" | "Signal Delay" | `%.2f` ms = range / 299.792458 (`:635-640`) | |
| 21 | "MA" | "Mean Anomaly" | `%.2f°` | |
| 22 | "Phase" | "Orbit Phase" | `%.2f°` | |
| 23 | "Orbit" | "Orbit Number" | integer | ✔ |
| 24 | "Vis" | "Visibility" | one character: `-` / `V` / `D` / `E` (§10) | |
| 25 | "Decayed" | "Decayed" | internal boolean, used as the row filter (decayed satellites are hidden, `:392-393`). Still has a check box | |
| 26 | "Status" | "Operational Status" | "Operational", "Non-operational", "Partially operational", "Backup/Standby", "Spare", "Extended Mission", "Unknown" (`:912-937`; these strings are **not** translatable) | |

- **Default visible set:** Satellite, Az, El, Dir, Range, Next Event, Alt, Orbit (`sat-cfg.c:51-58`).
- **Column cell formats:**
  - Degrees: `degree_cell_data_function` (`:1013`).
  - Lat/Lon: `:953`.
  - Distances: `:1033`.
  - Rates: `:1061`.
  - Doppler: `:1087`.
  - Loss/Delay: `:1108`.
  - AOS/LOS: `:1128`.
  - The mapping from columns to these functions is at `:820-882`.
  - Distance cells print **no unit text**.
- **Rows:**
  - A row is rendered **bold** when El > 0 (`:621-623`).
  - Default sort is Satellite ascending (`:304-305`). The sort column and order are saved per module.
  - The AOS and LOS columns use a numeric sort (`:399-404`).
- **Mouse:**
  - Double-click a row: the Satellite Info dialog (`:1289-1316`).
  - Right-click (`:1245-1356`) opens a popup (`gtk-sat-list-popup.c:60-77`, `gtk-sat-popup-common.c:30-63`):
    1. "Satellite info"
    2. separator
    3. "Show current pass" (only when El > 0)
    4. "Show next pass"
    5. "Future passes"
- **Number formats** are set in Edit → Preferences → General → "Number Formats" (`sat-pref-formats.c`):

| Control | Cite | Default | Tooltip |
|---|---|---|---|
| Check box "Show local time instead of UTC." | `:77` | off (`sat-cfg.c:114`) | `:32-34` |
| "Time format:" (`:104`) entry with a live preview label that starts as "--/--/-- --:--:--" and is updated every second, plus a "Reset" button | `:98-100` | `%Y/%m/%d %H:%M:%S` (`sat-cfg.c:220`) | Reset button: "Reset to default value". Entry tooltip lists the codes `%Y %m %d %j %H %M %S` (`:37-42`) |
| "Use N/S/E/W for geographical coordinates." | `:113` | off | |
| "Use Imperial units instead of Metric." | `:122` | off | |

## 5. Map view (`gtk-sat-map.c`, drawn with Cairo)

**What is drawn, in order** (`on_draw`, `:438-806`):

1. The background map image, scaled to fill the view. The default file is `nasa-bmng-07_1024.jpg` (`sat-cfg.c:225`). It is centred on the longitude set by MAP_CENTER, default 0 (`sat-cfg.c:157`). A keep-ratio option exists in config (default off, `sat-cfg.c:129`) but has **no UI**.
2. **Grid** (`:471-547`), when enabled:
   - Lines every 30°: 5 horizontal and 11 vertical, 0.5 px wide.
   - Labels `%.0f°`, with an N/S/E/W suffix when that format option is on.
   - Latitude labels sit at x+15. Longitude labels sit along the bottom edge.
   - The labels use the **grid colour**. The "Tick Labels" colour is read but aliased to the grid colour (`:346`).
3. **Solar terminator** (`:550-575`), when enabled: the night side is filled with the "Global shadow" colour and outlined with the terminator colour. It is recomputed every 15 s of module time (`:51`). The terminator calculation (`:2021-2071`) is the only use of the Sun's position.
4. **Ground station:** a 6×6 px square in the QTH colour, with the station name centred below it in the same colour (`:578-590`).
5. **For each satellite** (decayed satellites are skipped, `:1715-1718`):
   - **Ground track** polylines, 1 px, track colour (`:600-623`). They are drawn for N orbits starting with the current one. N defaults to 3 (`gtk-sat-map-ground-track.c:86-90`).
   - **Footprint:** range circle(s) filled with the coverage colour and outlined in the satellite or selected-satellite colour (`:632-689`).
   - **Marker:** a shadow square, then a 6×6 px marker square (`:691-713`; `MARKER_SIZE_HALF` 3 at `:48`).
   - **Label:** the name with a shadow (`:716-756`). The label is placed below the marker. Near the left or right edge it goes to the side; near the bottom edge it goes above.
6. **Info texts** in the info foreground colour on a `<span background>` in the info background colour (`:759-803`):
   - **Top-left, QTH info:** " <name> · <location> " (`:415-418`).
   - **Top-right, next event:**
     - "Next: <sat> in MM:SS", or "Next: <sat> in HH:MM:SS" when more than 59 minutes away (`:979-990`).
     - "Next: N/A" when there is no upcoming event (`:1008`).
     - "Next: ERR" on error (`:1002`).
     - Initially " ... " (`:424`).
   - **Bottom-left, cursor:** " LON:%.0f° LAT:%.0f° " (`:1056-1059`).
   - **Bottom-right, selected satellite:**
     - " <sat> AOS in MM:SS " or " <sat> LOS in MM:SS " (an hours field is added when needed) (`:1990-2003`).
     - " <sat>: Always in range " / " <sat>: Always out of range " for satellites with no AOS/LOS (`:1956`, `:1962`).
     - These strings are **not** translatable.
- **Not drawn:** no Sun or Moon markers. Grep finds no drawing code for them in `gtk-sat-map.c`.
- **Selected satellite:** footprint, marker and label are always shown, even when those layers are switched off globally (`:628-630`).
- **Mouse:**
  - Left click toggles selection of a satellite within 10 px. Only one satellite can be selected at a time (`:814`, `:1117-1153`).
  - Double-click opens Satellite Info (`:1084-1097`).
  - Right-click opens the satellite popup (`:1099-1108`).
- **Tooltip:** the code builds a tooltip "<b>sat</b>\nLon: …°\nLat: …°\n Az: …°\n El: …°\n<AOS/LOS in N minutes>" (`:1874-1883`, `:2138-2140`). `has-tooltip` is set (`:377`), but **no `query-tooltip` handler exists**, so whether the tooltip is actually shown is **UNVERIFIED** (probably not shown in v2.7).
- **Map popup** (`gtk-sat-map-popup.c:62-147`):
  1. "Satellite info"
  2. separator
  3. "Show current pass" (only when El > 0), "Show next pass", "Future passes"
  4. separator
  5. "Highlight footprint" (check item). It toggles whether this satellite's footprint is drawn; default on (`:103`, `:160-208`, `gtk-sat-map.c:1745-1753`).
  6. "Ground Track" (check item, default off, `:114`).
  7. A "Set Target" item exists but is compiled out with `#if 0` (`:125-139`).
- **Defaults** (`sat-cfg.c`):
  - Contents switched on: Satellite Name, Satellite Footprint, Satellite Marker, QTH Info, Next Event, Grid Lines (`:121-125`, `:127`).
  - Contents switched off: Cursor Position and Solar Terminator (`:126`, `:128`).
  - Refresh every 10 cycles (`:158`).
  - Default colours, as RGBA:

| Colour | RGBA | Cite |
|---|---|---|
| info text FG | `0x00FF00FF` | `:159` |
| info text BG | `0x000000FF` | `:160` |
| ground station | `0x00FFFFFF` | `:161` |
| satellite | `0xF0F000FF` | `:162` |
| selected satellite | `0xFFFFFFFF` | `:163` |
| footprint / coverage | `0xFFFFFF1F` | `:164` |
| grid | `0x7F7F7FC8` | `:165` |
| terminator | `0xFFFF0080` | `:166` |
| earth shadow | `0x00000060` | `:167` |
| tick | `0x7F7F7FC8` | `:168` |
| track | `0xFF1200BB` | `:169` |
| shadow alpha | `0xDD` | `:171` |

  - Font: the GTK default font. The `MAP_FONT` config value "Sans 8" is not used (`gtk-sat-map.c:368-373`).
- **Map View preference page** (`sat-pref-map-view.c`):

| Group | Controls (labels) | Cite |
|---|---|---|
| "<b>Background Map:</b>" | 100×50 thumbnail, button "Select map" (tooltip "Click to select a map") | `:747`, `:803-804` |
| "<b>Contents:</b>" | Check boxes, in order: "Satellite Name", "Satellite Footprint", "Satellite Marker", "QTH Info", "Next Event", "Cursor Position", "Grid Lines", "Solar Terminator" | `:828`, `:840-983` |
| "<b>Colours:</b>" | Colour buttons: "Ground Station:", "Grid:", "Tick Labels:", "Satellite:", "Selected Sat.:", "Ground Track:", "Footprint:" (tooltip ends "Hint: Make it transparent"), "Info Text FG:", "Info Text BG:", "Solar terminator:", "Global shadow:" | `:1023-1268` |
| | Slider "Shadow:" with end labels "<i>Transp.</i>" / "<i>Opaque</i>" | `:1292-1300` |
| Orbits | "Display ground track for" [spin 1–10] "orbit(s)" | `:1349-1373` |
| Centre | "Center map at longitude" [spin −180…180] "[deg]" (tooltip "Select longitude. West is negative.") | `:1397-1422` |
| Reset | "Reset" button | `:1439` |

## 6. Polar view (`gtk-polar-view.c`, drawn with Cairo)

**What is drawn** (`on_draw`, `:361-595`):

1. The background colour fills the view.
2. **Axes colour** (`:390-414`):
   - Elevation circles at 0°, 30° and 60°, with radii r, 0.6667r and 0.333r.
   - Horizontal and vertical axes through the centre, extended 5 px beyond the rim (`POLV_LINE_EXTRA`, `:46`).
   - r = min(width, height)/2 − 25 px (`:860`).
3. **Cardinal labels** "N", "E", "S", "W" (translatable) in the tick colour, placed according to the orientation setting (`:416-455`).
4. **Info texts** in the info colour:
   - **Top-left:** the QTH name only (`:457-467`).
   - **Bottom-left:** cursor "AZ: %.0f°   EL: %.0f°", shown only above the horizon (`:724-748`).
   - **Top-right, right-aligned:** "Next: <sat>\nin MM:SS" or "Next: <sat>\nin HH:MM:SS", or "Next: N/A" / "Next: ERR" (`:986-1013`).
   - **Bottom-right:** the selected satellite as "<sat>\nLOS in MM:SS" or "<sat>\nLOS in HH:MM:SS", or "<sat>\nAlways in range" for a satellite with no LOS (`:911-937`, `:1093-1111`).
5. **Satellites:** only satellites with El ≥ 0 that are not decayed are drawn. Others are removed (`:1054-1077`).
   - **Sky track** (if enabled for that satellite): a 1 px polyline in the track colour for the **current pass** (`get_current_pass`, `:1177`). It starts at (AOS azimuth, 0°) (`:1198-1290`).
   - **Time ticks:** 4 labels in `%H:%M` (`TRACK_TICK_NUM` 4, `gtk-polar-view.h:16`). The first is at AOS; the others are evenly spaced along the track (`:1250`, `:1277`, `:539-553`).
   - There are **no "AOS"/"LOS" text labels** on the track.
   - **Marker:** a 6×6 square (`:559-572`). **Name:** centred below the marker (`:574-588`). Both use the satellite colour, or the selected colour when selected.
- **Not drawn:**
  - No Sun or Moon (grep finds nothing in `gtk-polar-view.c`).
  - The "Extra Az Ticks" option is loaded (`:822-824`) but `on_draw` never uses it, so it has no visible effect in v2.7. This is an observation from the code.
- **Tooltip:** the text is built (`:1100-1102`, `:1172-1174`), but there is no `query-tooltip` handler, so it is **UNVERIFIED** whether it is shown.
- **Mouse:** same as the map view. The hit radius is 10 px (`:603`). Left click toggles selection, double-click opens Satellite Info, right-click opens the popup (`:620-722`).
- **Orientation options** (`gtk-polar-view.h:55-58`, `sat-pref-polar-view.c:304-326`):

| Option | Tooltip layout | Default |
|---|---|---|
| "N/E/S/W" | N at top, W at left, E at right, S at bottom | ✔ (`sat-cfg.c:173`) |
| "N/W/S/E" | E and W swapped | |
| "S/E/N/W" | N and S swapped | |
| "S/W/N/E" | both pairs swapped | |

- **Polar popup** (`gtk-polar-view-popup.c:60-122`):
  1. "Satellite info"
  2. separator
  3. "Show current pass" (only when El > 0), "Show next pass", "Future passes"
  4. separator
  5. "Sky track" (check item; disabled for GEO satellites, `:99-111`)
  6. "Set as target" is commented out (`:113-122`).
- **Defaults** (`sat-cfg.c`):
  - Switched on: Satellite Name, Satellite Marker, QTH Info, Next Event, Cursor Position (`:130-134`).
  - Switched off: Extra Az Ticks (`:135`) and "Show the sky tracks automatically" (`:136`).
  - Refresh every 3 cycles (`:172`).
  - Default colours, as RGBA:

| Colour | RGBA | Cite |
|---|---|---|
| background | `0xFFFFFFFF` | `:174` |
| axes | `0x0F0F0F7F` | `:175` |
| tick labels | `0x007F00FF` | `:176` |
| satellite | `0x8F0000FF` | `:177` |
| selected satellite | `0xFF0D0BFF` | `:178` |
| track | `0x0000FFFF` | `:179` |
| info text | `0x00007FFF` | `:180` |

  - Font: the GTK default font. The `POLAR_FONT` value "Sans 10" is unused (`gtk-polar-view.c:851-856`).
- **Polar View preference page:**
  - "<b>Orientation:</b>" (`:295`) with the four radio buttons above.
  - "<b>Contents:</b>" (`:401`): "Satellite Name", "Satellite Marker", "QTH Info", "Next Event", "Cursor Position", "Extra Az Ticks" (tooltip "Show extra tick marks for every 30°") (`:413-515`).
  - "<b>Colours:</b>" (`:556`): "Background:", "Axes/Circles:", "Tick Labels:", "Satellite:", "Selected Sat.:", "Sky Track:", "Info Text:" (`:567-709`).
  - "<b>Miscellaneous:</b>" (`:746`): "Show the sky tracks automatically" (`:755-760`).
  - "Reset" (`:791`).

## 7. Single-sat view (`gtk-single-sat.c`)

**Header:**
- A flat mini button with the icon `gpredict-mod-popup.png` and tooltip "Satellite options / shortcuts" (`:761-763`).
- Next to it, the selected satellite's name in bold (`:772-780`). The satellites are sorted by name, and the selection is remembered per module.

**Body:** a grid with three columns per row: `<Title>` (right-aligned) `:` `<value>` (left-aligned). Values start as "-". Each row's tooltip is its hint text (`:791-813`). The "Single Sat View" preference page shows "<b>Visible Fields:</b>" and check boxes using these titles, in three columns (`sat-pref-single-sat.c:171-190`).

| # | Title (`:45-67`) | Hint (`:72-94`) | Value format (`:166-365`) | Default |
|---|---|---|---|---|
| 0 | "Azimuth" | "Azimuth of the satellite" | `%6.2f°` | ✔ |
| 1 | "Elevation" | "Elevation of the satellite" | `%6.2f°` | ✔ |
| 2 | "Direction" | "Direction of the satellite" | "Geostationary" / "Decayed" / "Receding" / "Approaching" / "N/A" (not translatable) | |
| 3 | "Right Asc." | "Right Ascension of the satellite" | `%6.2f°` | |
| 4 | "Declination" | "Declination of the satellite" | `%6.2f°` | |
| 5 | "Slant Range" | "The range between satellite and observer" | `%.0f km` / `%.0f mi` | ✔ |
| 6 | "Range Rate" | "The rate at which the Slant Range changes" | `%.3f km/sec` / `%.3f mi/sec` | ✔ |
| 7 | "Next Event" | "The time of next AOS or LOS" | "AOS: <time>" / "LOS: <time>" / "N/A" | ✔ |
| 8 | "Next AOS" | "The time of next AOS" | time format / "N/A" | |
| 9 | "Next LOS" | "The time of next LOS" | time format / "N/A" | |
| 10 | "SSP Lat." | "Latitude of the sub-satellite point" | `%.2f°` + N/S suffix, or signed | |
| 11 | "SSP Lon." | "Longitude of the sub-satellite point" | `%.2f°` + E/W suffix, or signed | |
| 12 | "SSP Loc." | "Sub-Satellite Point as Maidenhead grid square" | 6-character locator | ✔ |
| 13 | "Footprint" | "Diameter of the satellite footprint" | `%.0f km` / `%.0f mi` | ✔ |
| 14 | "Altitude" | "Altitude of the satellite" | `%.0f km` / `%.0f mi` | ✔ |
| 15 | "Velocity" | "Tangential velocity of the satellite" | `%.3f km/sec` / `%.3f mi/sec` | ✔ |
| 16 | "Doppler@100M" | "Doppler Shift @ 100MHz" | `%.0f Hz` | ✔ |
| 17 | "Sig. Loss" | "Signal loss @ 100MHz" | `%.2f dB` | ✔ |
| 18 | "Sig. Delay" | "Signal Delay" | `%.2f msec` | ✔ |
| 19 | "Mean Anom." | "Mean Anomaly" | `%.2f°` | ✔ |
| 20 | "Orbit Phase" | "Orbit Phase" | `%.2f°` | ✔ |
| 21 | "Orbit Num." | "Orbit Number" | `%ld` | ✔ |
| 22 | "Visibility" | "Visibility of the satellite" | "Unknown" / "Visible" / "Daylight" / "Eclipsed" | ✔ |

The default set comes from `sat-cfg.c:73-88`.

**Popup** (opened from the header button, `:467-541`):
1. The satellite name in **bold** as a menu item. It opens Satellite Info.
2. separator
3. "Show current pass" (only when El > 0), "Show next pass", "Future passes"
4. separator
5. One radio item per satellite nickname, with the current one checked. Choosing one switches the view.

There is no "Select satellite" header item in this popup.

## 8. Event list view ("Upcoming passes", `gtk-event-list.c`)

| # | Title (`:52-57`) | Hint (`:64-69`) | Format | Default visible |
|---|---|---|---|---|
| 0 | "Satellite" | "Satellite Name" | nickname | ✔ |
| 1 | "Catnum" | "Catalogue Number" | integer | |
| 2 | "Az" | "Azimuth" | `%.2f°` (`:613`) | ✔ |
| 3 | "El" | "Elevation" | `%.2f°` | ✔ |
| 4 | "Event" | "Next event type (A: AOS, L: LOS)" | renders "AOS" or "LOS"; "LOS" when El ≥ 0 (`:535`, `:539`) | |
| 5 | "AOS/LOS" | "Countdown until next event" | "MM:SS", or "HH:MM:SS" when an hour or more; "Never" when there is no event (`:567-590`) | ✔ |

- **Visible columns** are hard-coded to Satellite, Az, El and AOS/LOS (`:45-47`, `:241`). There is no preference page for this view.
- **Default sort:** the countdown column, ascending (`:212-213`). Rows with El > 0 are bold, and decayed satellites are hidden.
- **Popup** (`gtk-event-list-popup.c:60-92`):
  1. The satellite name in **bold**. It opens Satellite Info.
  2. separator
  3. The pass items: "Show current pass" (only when El > 0), "Show next pass", "Future passes".

## 9. Time controller window (`gtk-sat-module-tmg.c`)

- **Title:** "Time Controller / <module name>" (`:266`). The window is transient for the module window. Its icon is `gpredict-clock.png`.
- **Layout**, top to bottom: the controls grid, then the slider, a separator, and the button row (`:254-262`).

| Control | Label / tooltip | Range / default | Cite |
|---|---|---|---|
| Calendar | GtkCalendar with heading and day names | – | `:144-148` |
| Hour | "Hour:" / "Use this control to set the hour" | 0–23. Wraps, and the wrap carries into the calendar day (`:510-525`) | `:159-173` |
| Minute | "Min:" / "Use this control to set the minutes" | 0–59, wraps | `:176-190` |
| Second | "Sec:" / "Use this control to set the seconds" | 0–59, wraps | `:193-207` |
| Millisecond | "Msec:" / "Use this control to set the milliseconds" | 0–999, wraps | `:210-224` |
| Throttle | "Throttle:" / "Time throttle / compression factor" | 1–100, step 1, default 1 | `:227-240` |
| Slider | no label or value shown; its tooltip is commented out | −0.1…+0.1 day (≈ ±2.4 h), step 0.0001 day (≈ 8.6 s), starts at 0 | `:243-251` |
| State label (bottom-left) | "<b>Real-Time</b>" / "<b>Simulated Real-Time</b>" / "<b>Manual Control</b>" | starts as "Real-Time" | `:136`, `:725-736` |
| Button | "Reset" / tooltip "Reset to current date and time" | – | `:127-131` |
| Toggle (radio) | Icon `media-seek-backward`, tooltip "Play backwards" | – | `:111-124` |
| Toggle (radio) | Icon `media-playback-pause`, tooltip "Stop" | – | `:95-108` |
| Toggle (radio) | Icon `media-seek-forward`, tooltip "Play forward" | **active by default** | `:79-92` |

- **Button row, left to right:** state label … Reset, Backward, Stop, Forward. The buttons are packed from the right edge (`:92`, `:108`, `:124`, `:131`).
- **Behaviour:**
  - Forward runs time at +throttle, Backward at −throttle, Stop at 0. When stopped, time comes from the calendar, the spinners and the slider offset (`:333-401`, `:456-472`).
  - Moving the slider while time is running switches to Stop (`:487-498`).
  - Reset returns to the current time (`:403-425`).
  - Closing the window resets the time and sets the throttle back to 1 (`:305-321`).
  - The state label shows "Simulated Real-Time" when time is running at an offset or faster than real time, "Manual Control" when stopped, and "Real-Time" otherwise (`:725-736`).
- **No discrete speed steps:** the throttle spin button (1–100) is the only speed control.

## 10. Ground station (QTH) editor and visibility codes

The editor is the dialog "Edit ground station data", with buttons "_Clear", "_Cancel", "_OK". OK stays disabled until a valid name is entered. There are two identical implementations:
- From Preferences: `sat-pref-qth-editor.c:807-812`.
- From the Module config "Add" button: `qth-editor.c:699-705`.

Field lines below cite `sat-pref-qth-editor.c`.

| Row | Label | Widget / range | Tooltip | Cite |
|---|---|---|---|---|
| 0 | "Name" | entry, maximum 25 characters | "Enter a short name for this ground station, e.g. callsign.\nAllowed characters: 0..9, a..z, A..Z, - and _" | `:592-602` |
| 1 | "Description" | entry, maximum 256 characters | "Enter an optional description for this ground station." | `:611-619` |
| 2 | "Location" | entry, maximum 50 characters, plus button "Select" | "Optional location of the ground station, e.g. Copenhagen, Denmark." / button: "Select a location from a list" | `:623-638` |
| 3 | "Latitude (°)" | spin 0–90, 4 decimal places, plus combo "North" / "South" | "Select the latitude of the ground station in decimal degrees." | `:642-658` |
| 4 | "Longitude (°)" | spin 0–180, 4 decimal places, plus combo "East" / "West" | "Select the longitude of the ground station in decimal degrees." | `:662-678` |
| 5 | "Locator" | entry, maximum 6 characters. Kept in sync with lat/lon both ways | "Maidenhead locator grid." | `:695-702` |
| 6 | "Altitude" | spin 0–5000 m (or the equivalent in ft), plus unit label "m ASL" / "ft ASL" | "Select the altitude of the ground station in meters or feet depending on your settings" | `:706-727`; `MAX_ALT` at `:51` |
| 7 | "Weather St" | entry, maximum 4 characters, plus button "Select" | "Four letter code for weather station" / button: "Select a weather station" | `:732-745` |
| 8 * | "QTH Type" | combo "Static" / "GPSD" | "A qth can be static, ie. it does not change, or gpsd based for computers with gps attached." | `:749-762` |
| 9 * | "GPSD Server" | entry | "GPSD Server." | `:764-771` |
| 10 * | "GPSD Port" | spin 0–32768 | "Set the port for GPSD to use. Default for gpsd is 2947." | `:774-784` |

\* Rows 8–10 appear only in builds with `HAS_LIBGPS` (`:747`, `:785`).

**Ground Stations preference page** (`sat-pref-qth.c`):
- Table columns: "Name", "Location", "Lat", "Lon", "Alt\n(m)" or "Alt\n(ft)", "QRA", "Default", and in GPSD builds "GPSD\nServer", "GPSD\nPort", "QTH\nType" (`:157-270`).
- Buttons "Add new", "Edit", "Delete" (`:498-512`). Their tooltips are "Add a new ground station to the list", "Edit the selected ground station" and "Delete selected ground station".
- Deleting the last station is refused: "Can not delete ground station!\n\nYou need to have at least one ground\nstation set up, otherwise gpredict may\nnot work properly." (`:591-594`).

**Visibility codes** (`sat-vis.c:37-44`):

| Code character | Text | Meaning (logic at `sat-vis.c:82-101`) |
|---|---|---|
| `-` | "Unknown" | Undefined. Never returned by `get_sat_vis`. It is the initial cell text |
| `V` | "Visible" | The satellite is sunlit, its El ≥ 0, **and** the Sun's elevation at the station is ≤ the twilight threshold (default −6°, `sat-cfg.c:194`) |
| `D` | "Daylight" | The satellite is sunlit but the visible condition is not met |
| `E` | "Eclipsed" | The satellite is in Earth's shadow |

## 11. Preferences dialog (`sat-pref.c`)

**Structure:**
- The dialog opens with the title "Gpredict Preferences :: General" (`:148`). On page switch it becomes "GPREDICT Preferences :: General", "GPREDICT Preferences :: Modules", "GPREDICT Preferences :: Interfaces" or "GPREDICT Preferences :: Predict" (`:44-47`, `:200`). The capitalisation is inconsistent.
- Buttons "_Cancel" / "_OK".
- On the left is a vertical column of icon buttons: "General", "Modules", "Interfaces", "Predict" (`:99-125`). The notebook tabs themselves are hidden.

| Group → tab | Main settings (label → default) | Cite |
|---|---|---|
| **General** → "Number Formats" | See §4 | `sat-pref-general.c:52` |
| General → "Ground Stations" | Table plus Add new / Edit / Delete (§10) | `:55` |
| General → "TLE Update" | "<b>Auto-Update:</b>": "Check the age of TLE data:" combo "Never" / "Monthly" / "Weekly" / "Daily" → **Weekly** | `sat-pref-tle.c:73-88`; `tle-update.c:1356-1359`; `sat-cfg.c:211` |
| | "If TLEs are too old:" radio "Notify me" (**default**) / "Perform automatic update in the background" | `sat-pref-tle.c:98-105`; `sat-cfg.c:212` |
| | "<b>Update from the Internet:</b>": "Proxy server:" (empty); "TLE sources:" URL list (11 CelesTrak and AMSAT URLs) with "Add TLE source" / "Delete TLE source" | `sat-pref-tle.c:261-286`, `:204-209`; `sat-cfg.c:235-246` |
| | Check box "Add new satellites to local database" → on | `sat-pref-tle.c:328`; `sat-cfg.c:139` |
| General → "Message Logs" | "Debug level:" "Level 0: None" … "Level 4: Debug" → Level 2: Warning | `sat-pref-debug.c:171-184`; `sat-cfg.c:215` |
| | "Delete log files older than:" "Always delete" / "1 day" / "1 week" / "1 month" → shows "Always delete" (CLEAN_AGE 0) | `sat-pref-debug.c:201-209`, `:49-62`; `sat-cfg.c:214` |
| | Info text about the logs directory and `gpredict.log` | `sat-pref-debug.c:226-238` |
| **Modules** → Layout, Refresh Rates, List View, Map View, Polar View, Single Sat View | Same pages as module Properties (§3–7). Global mode adds the "Window Placements" check boxes | `sat-pref-modules.c:65-80` |
| **Interfaces** → "Radios" | Columns "Config Name", "Host", "Port", "Rig Type", "PTT Status", "VFO Up", "VFO Down", "LO Down", "LO Up", "Downlink", "Uplink", "Signal AOS", "Signal LOS", "Signal AOIQ", "Signal LOIQ". Buttons "Add new" / "Edit" / "Delete". Which columns are visible by default is **UNVERIFIED** | `sat-pref-interfaces.c:53`; `sat-pref-rig.c:524-670`, `:813-823` |
| Interfaces → "Rotators" | Columns "Config Name", "Host", "Port", "Min Az", "Max Az", "Min El", "Max El", "Azimuth Type". Buttons "**Add New**" (capital N, unlike Radios) / "Edit" / "Delete" | `sat-pref-interfaces.c:56`; `sat-pref-rot.c:344-352`, `:451-514` |
| **Predict** → "Pass Conditions" | "Minimum elevation" 1–90 "[deg]" → 5 | `sat-pref-conditions.c:161-177`; `sat-cfg.c:185` |
| | "<b>Multiple Passes:</b>": "Number of passes to predict" 5–50 → 10; "Passes should occur within" 1–14 "[days]" → 3 | `:186-224`; `sat-cfg.c:186-187` |
| | "<b>Pass Details:</b>": "Time resolution" 1–600 "[sec]" → 10; "Number of entries" 10–200 → 20 | `:233-261`; `sat-cfg.c:188-189` |
| | "<b>Satellite Visibility:</b>": "Twilight threshold" −18…0 "[deg]" → −6 | `:281-305`; `sat-cfg.c:194` |
| | Check box "Always use real time for pass predictions" → off | `:314-315`; `sat-cfg.c:141` |
| Predict → "Multiple Passes" | "<b>Visible Columns:</b>" check boxes labelled with the hint strings, in two columns: "Acquisition of signal (AOS)", "Time of Closest Approach (TCA)", "Loss of signal (LOS)", "Duration of pass", "Maximum elevation", "Azimuth at AOS", "Az at max. elevation", "Azimuth at LOS", "Orbit number", "Visibility during pass" | `sat-pref-multi-pass.c:130-139`; `sat-pass-dialogs.c:71-80` |
| | Default on: AOS, LOS, Duration, Max El, AOS Az, LOS Az. The dialog column titles are "AOS", "TCA", "LOS", "Duration", "Max El", "AOS Az", "Max El Az", "LOS Az", "Orbit", "Vis" | `sat-cfg.c:66-71`; `sat-pass-dialogs.c:57-66` |
| Predict → "Single Pass" | "<b>Visible Columns:</b>" check boxes labelled with the hints, in three columns: "Time", "Azimuth", "Elevation", "Right Ascension", "Declination", "Slant Range", "Range Rate", "Latitude", "Longitude", "Sub-Satellite Point", "Footprint", "Altitude", "Velocity", "Doppler Shift @ 100MHz", "Signal Loss @ 100MHz", "Signal Delay", "Mean Anomaly", "Orbit Phase", "Visibility" | `sat-pref-single-pass.c:134-142`; `sat-pass-dialogs.c:121-139` |
| | Default on: Time, Az, El, Range, Footp. The column titles are "Time", "Az", "El", "Ra", "Dec", "Range", "Rate", "Lat", "Lon", "SSP", "Footp", "Alt", "Vel", "Dop", "Loss", "Del", "MA", "Phase", "Vis" | `sat-cfg.c:60-64`; `sat-pass-dialogs.c:98-116` |
| Predict → "Sky at a Glance" | "<b>Time:</b>" "Find and show passes that occur within" 1–24 "hours" → 8 | `sat-pref-sky-at-glance.c:265-286`; `sat-cfg.c:195` |
| | "<b>Colours:</b>" "Satellite 1: " … "Satellite 10: " → `#3c46c8`, `#00500a`, `#d5472b`, `#d06b38`, `#cf477a`, `#bf041f`, `#688522`, `#0420bf`, `#a304bf`, `#04bdbf` | `:297-433`; `sat-cfg.c:196-205` |

Every page has a "Reset" button.

## 12. Other features (inventory)

| Feature | How it is opened | Window / title | Cite |
|---|---|---|---|
| Satellite info | "Satellite info" item in the list/map/polar popups; the bold name item in the single-sat/event popups; double-click on a satellite | "Satellite Info" with tabs "Orbit Info" and "Transponders" | `sat-info.c:520-526` |
| Next / current pass details | Satellite popup → "Show next pass" / "Show current pass" | "Pass details for %s (orbit %d)". Tabs "Data", "Polar", "Az/El". Buttons Print / Save / Close | `sat-pass-dialogs.c:447-488` |
| Future passes | Satellite popup → "Future passes" | "Upcoming passes for %s". Buttons Print / Save / Close. Row popup items: "Show details", "Polar plot", "Az/El plot" | `sat-pass-dialogs.c:1035-1044`; `pass-popup-menu.c:84-105` |
| Sky at a glance | Module popup → "Sky at a glance" | "The sky at a glance (<module>)". Time axis labelled "TIME" or "UTC" | `gtk-sat-module-popup.c:719`; `gtk-sky-glance.c:378-379` |
| Time controller | Module popup → "Time Controller" | §9 | |
| Radio control | Module popup → "Radio Control" | "Gpredict Radio Control: <module>" | `gtk-sat-module-popup.c:825` |
| Antenna (rotator) control | Module popup → "Antenna Control" | "Gpredict Rotator Control: <module>" | `gtk-sat-module-popup.c:905` |
| TLE update | Edit → "Update TLE data from network" / "Update TLE data from local files"; auto-check per Preferences | "TLE Update" / "Update TLE from files" | `menubar.c:904-909` |
| Transponders | Edit → "Update transponder data" (from the SatNOGS DB `https://db.satnogs.org/api/`, `sat-cfg.c:228`). Shown in Satellite Info → "Transponders" | "Transponder Update" | `menubar.c:914`, `:515` |
| Log browser | File → "Log browser" (Ctrl+L) | "Log Browser" | `sat-log-browser.c:478` |
| Module new / open / clone / delete | File → "New module" / "Open module"; module popup → "Clone..." / "Delete" | §2–3 | |
| Preferences | Edit → "Preferences" | §11 | |

## 13. Manual vs code differences (the code wins)

| Topic | Manual says | Code (v2.7) says |
|---|---|---|
| Module menu button | "V icon in the top right corner" plus an "X icon" to close (UM §2.2 p.11) | `open-menu-symbolic` icon, tooltip "Module menu". **No close button** (`gtk-sat-module.c:1059-1090`) |
| Time controller item | "Time controller" (UM §2.2 p.11) | "Time Controller" (`gtk-sat-module-popup.c:1182`) |
| Time slider range | "± 2.5 hours" (UM §2.2 p.11) | ±0.1 day ≈ ±2.4 h. The tooltip saying "+/- 2.5 hours" is commented out (`gtk-sat-module-tmg.c:243-247`) |
| New module menu path | "File → New Module" (UM §2.4 p.18) | "New module" (`menubar.c:862`) |
| TLE menu items | "Edit → Update TLE from the net" / "Update TLE from local files" (UM §6.2 p.43, §6.3 p.45) | "Update TLE data from network" / "Update TLE data from local files" (`menubar.c:904-909`) |
| Add ground station from module config | "+ button" (UM §2.3.1 p.13) | Button labelled "Add" (`mod-cfg.c:692`) |
| Satellite popup item names | "<SATELLITE NAME>", "Show Next Pass", "Show Current Pass", "Future Passes", "Highlight Footprint", "Sky Track", "Set Target" (UM §4.2 pp.29-34) | "Satellite info" (list/map/polar), "Show next pass", "Show current pass", "Future passes", "Highlight footprint", "Ground Track", "Sky track". Set Target is removed. Single-sat and event popups use the bold satellite name |
| Single-sat satellite picker | "Select Satellite menu item" (UM §4.2.4 p.36) | The satellite names are radio items directly in the popup (`gtk-single-sat.c:516-530`) |
| List view rules hint | "Enable Rules Hint in List Views" option (UM §4.2.1 p.29) | Config key only (`sat-cfg.c:120`). **No UI** |
| Map ground-track orbits default | "default value is 1" (UM §4.2.2 p.31) | **3** (`sat-cfg.c:170`) |
| Map colour name | "Coverage Area" (UM §4.2.2) | "Footprint:" (`sat-pref-map-view.c:1170`). The manual also omits the "Solar terminator:" and "Global shadow:" colours and the "Satellite Name / Footprint / Marker", "Solar Terminator" contents |
| Map / polar group header | "Extra Contents" | "<b>Contents:</b>" |
| Map selection | "click anywhere within its footprint area" | 10 px hit radius around the marker (`gtk-sat-map.c:814`) |
| Map "Tick Labels" colour | Configurable | Read but overridden by the grid colour (`gtk-sat-map.c:346`) |
| Polar "Extra Az Ticks" | Draws extra 30° ticks (UM §4.2.3) | Loaded but never drawn in the Cairo renderer |
| Ground Stations button | "Add New" (UM §3.3 p.25) | "Add new" (`sat-pref-qth.c:498`). The Rotators page does use "Add New" |
| TLE source button | "Add TLE Source" (UM §6.2.2 p.44) | "Add TLE source" (`sat-pref-tle.c:204`) |
| Views list | "four different views" (UM §2.1 p.9), but five are then listed | Five view types (List, Map, Polar, Single, Event list) |

**Other notable code findings:**
- There is no status bar.
- Window titles mix "GPREDICT:" and "Gpredict:" in their capitalisation.
- The log age default is CLEAN_AGE 0. A code comment calls this "Never clean", but the UI shows "Always delete".
- Several display strings are not wrapped for translation: the direction and status texts, and the map "Always in range" text.
- The `MAP_FONT` / `POLAR_FONT` config keys are unused.
