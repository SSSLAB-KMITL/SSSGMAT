# Gpredict UI reference, part 4: data and preferences (labels, defaults, behaviour)

Extension of `docs/2026-11-11-gpredict-reference.md` ("ER" below, cited as "ER §n"). It records names, labels, defaults, formats and behaviour only. No code is copied. Facts already in ER are not repeated; where this part corrects ER, the correction is listed in §15.

## Sources and conventions

- **Code (authoritative):** `csete/gpredict`, commit `2259378` ("Version 2.7"). `file.c:line` citations are relative to `src/`. Files outside `src/` carry their repo path (for example `pixmaps/maps`).
- **Nothing was run.** All behaviour is read from the code. **UNVERIFIED** marks anything that depends on GTK/libcurl runtime behaviour or on the absence of code.
- Labels are quoted exactly as written inside `_("…")` / `N_("…")`. `_` marks a mnemonic. `\n` is a line break, `\t` a tab, `°` is U+00B0.
- **Configuration storage:** every setting is a GLib key file.
  - Global settings: `gpredict.cfg` in the user conf dir (`sat-cfg.c:275`). Booleans are `true`/`false`, integers decimal, strings plain (`sat-cfg.c:391-732`).
  - A missing or unreadable key returns the built-in default (`sat-cfg.c:409-417`).
  - User conf dir: Linux `$XDG_CONFIG_HOME/Gpredict` (normally `~/.config/Gpredict`); Windows `%USERPROFILE%\Gpredict`; macOS builds `~/Library/Application Support/Gpredict` (`compat.c:245-262`).
  - Sub-folders: `modules/` (`*.mod`), `satdata/` (`<catnum>.sat`, `*.cat`, `cache/`), `trsp/` (`<catnum>.trsp`), `hwconf/`, `logs/`. Ground stations (`<name>.qth`) sit directly in the conf dir (`compat.c:268-317`, `gtk-sat-module.c:900-901`).
- Keys are written GROUP/KEY, for example GLOBAL/USE_NSEW.

---

## 1. Preferences dialog shell (`sat-pref.c`)

| Item | Detail | Cite |
|---|---|---|
| Window | Modal, parent = main window, buttons "_Cancel" and "_OK". No Apply button. No default size is set | `:148-154` |
| Title | Created as "Gpredict Preferences :: General", but `gtk_button_clicked` on the General icon runs before the dialog is shown (`:165`), and that handler sets the title to `WINDOW_TITLE[page]` = "GPREDICT Preferences :: General" (`:44`, `:201`). The first title the user sees is therefore expected to be the **upper-case** form (see §15; **UNVERIFIED** at runtime) | `:148`, `:165`, `:194-202` |
| Left column | Four flat icon buttons, vertical, start-aligned: "General" (`gpredict-sat-pref.png`), "Modules" (`gpredict-sat-list.png`), "Interfaces" (`gpredict-oscilloscope.png`), "Predict" (`gpredict-calendar.png`) | `:99-136` |
| Notebook | Outer notebook tabs hidden. The inner notebooks have **visible tabs** | `:95`, `sat-pref-general.c:48` |
| General tabs, in order | "Number Formats", "Ground Stations", "TLE Update", "Message Logs" | `sat-pref-general.c:50-61` |
| Modules tabs, in order | "Layout", "Refresh Rates", "List View", "Map View", "Polar View", "Single Sat View" | `sat-pref-modules.c:63-80` |
| OK | Calls, in this order: General (Number Formats, Ground Stations, TLE Update, Message Logs), Modules in global mode, Interfaces, Predict, then `sat_cfg_save()` (writes `gpredict.cfg` to disk) | `:170-176`, `sat-pref-general.c:76-82` |
| Cancel / close | Anything other than OK runs each page's cancel hook. Nothing is saved, except that Imperial is restored (§2) | `:178-183` |
| Page lifetime | Every page is rebuilt from current config each time the dialog opens | `:81-93` |

The Modules, TLE Update, Message Logs and Layout pages keep their own `dirty`/`reset` flags and write on OK only what was changed (§4, §7.1, §10); the Number Formats and Ground Stations pages write on every OK.

---

## 2. General → "Number Formats" (`sat-pref-formats.c`)

**Layout:** one vertical box (border 20, spacing 10): local-time check box; time-format row; separator; N/S/E/W check box; separator; Imperial check box (`:128-140`). There is **no page-level Reset** (only the small "Reset" beside the time format) and no group header.

| Control | Label | Tooltip (exact) | Default | Key | Cite |
|---|---|---|---|---|---|
| Check box | "Show local time instead of UTC." | "Display local time instead of UTC. Note: The local time is that of your operating system and not the local time at the location, which you select as tracking reference." | off | GLOBAL/USE_LOCAL_TIME | `:31-34`, `:76-81`; `sat-cfg.c:114` |
| Row: label + entry + preview + button | "Time format:" | Entry: "Enter a format string using the following codes:\n\n\t%Y\tYear with century.\n\t%m\tMonth (01-12).\n\t%d\tDay of the month (01-31).\n\t%j\tDay of the year (001-366).\n\t%H\tHour (00-23).\n\t%M\tMinute (00-59).\n\t%S\tSeconds (00-59).\n\nSee the user manual for more codes and examples." | `%Y/%m/%d %H:%M:%S` | GLOBAL/TIME_FORMAT | `:36-42`, `:84-90`, `:102-108`; `sat-cfg.c:220` |
| Entry limit | – | – | maximum 50 characters | – | `sat-cfg.h:30`, `:85` |
| Preview label | text starts as "--/--/-- --:--:--" | none | – | – | `:92` |
| Button | "Reset" | "Reset to default value" | sets the entry to the default string only | – | `:98-100`, `:207-217` |
| Check box | "Use N/S/E/W for geographical coordinates." | "Checking this box will cause geographical coordinates to be displayed using a suffix instead of sign (eg. 23.43°W instead of -23.43°)." | off | GLOBAL/USE_NSEW | `:44-48`, `:111-116`; `sat-cfg.c:115` |
| Check box | "Use Imperial units instead of Metric." | "Display distances using Imperial units, for example miles instead of kilometres." | off | GLOBAL/USE_IMPERIAL | `:50-52`, `:119-126`; `sat-cfg.c:116` |

**Behaviour**
- **Preview:** a 1000 ms timer rewrites the label with "now" formatted by the entry text *as typed* (not yet saved), in local time or UTC according to the check box *as ticked* (not yet saved) (`:95`, `:171-194`). The first update comes after one second.
  - The preview uses GLib's date formatter, whereas live displays use C `strftime` on a `time_t` (`time-tools.c:65-81`). Codes beyond the six listed may differ across platforms (**UNVERIFIED**).
  - Live displays also cut the result to 50 characters minus one (`time-tools.c:76-79`, `gtk-sat-module.c:546`).
- **OK:** local-time, format and N/S/E/W are written on OK only (`:159-168`).
- **Imperial is applied immediately.** Toggling writes the config at once and converts the altitudes in the Ground Stations tab (`:197-204`, §3). Cancel restores the original value (`:146-152`). Because displays read the setting on each refresh, open views would switch units while the dialog is still open (inferred; **UNVERIFIED**).

### 2.1 Which displays each setting affects

**Local time vs UTC (USE_LOCAL_TIME)**; all go through `daynum_to_str` (`time-tools.c:65-81`) unless noted.

| Display | Local/UTC | Uses "Time format" string | Cite |
|---|---|---|---|
| Module header clock | yes | yes (GPSD station: "<time> GPS %0.3f seconds old") | `gtk-sat-module.c:543-562` |
| List view "Next Event" (format + " (AOS)" or " (LOS)" appended before formatting), "Next AOS", "Next LOS" | yes | yes | `gtk-sat-list.c:775-779`, `:1149-1151` |
| Single-sat "Next Event" ("AOS: "/"LOS: " prefix), "Next AOS", "Next LOS" | yes | yes | `gtk-single-sat.c:231-232`, `:249-250`, `:262-263` |
| Satellite selector time column (hidden by default, ER §3) | yes | yes | `gtk-sat-selector.c:304-305` |
| Pass dialogs time columns (Upcoming passes, Pass details) | yes | yes | `sat-pass-dialogs.c:837-838` |
| Pass print/save text: header "AOS: <time> Local\|UTC", table times | yes (`Local`/`UTC` word) | yes | `pass-to-txt.c:129-177`, `:198-263`, `:497-576` |
| Satellite Info "Epoch time:" | yes | yes | `sat-info.c:240-251` |
| Az/El plot time ticks `%H:%M` / `%H:%M:%S`; x legend "Local Time" or "UTC" | yes | no (fixed) | `gtk-azel-plot.c:244`, `:449`, `:374-376` |
| Polar view / polar plot track ticks `%H:%M` | yes | no (fixed) | `gtk-polar-view.c:1250`, `:1277`; `gtk-polar-plot.c:278`, `:297` |
| Sky at a glance hour labels `%H`, time `%H:%M`, axis label "TIME" (local) or "UTC" | yes | no (fixed) | `gtk-sky-glance.c:377-379`, `:405`, `:715` |
| Time Controller hour/min/sec spinners and calendar: shown in, and edits interpreted as, local or UTC | yes | no | `gtk-sat-module-tmg.c:697-713`, `:802-815` |

**Not affected by either time setting:** map and polar info texts (countdowns "MM:SS"), event-list countdown, and the log file (always local time, fixed format `%Y/%m/%d %H:%M:%S`, `sat-log.c:216-217`).

**N/S/E/W (USE_NSEW)**

| Display | Rendering | Cite |
|---|---|---|
| List "Lat"/"Lon" | `%.2f°` then one suffix character: N/S or E/W when on; when off the sign is kept and the suffix is a **space** (so the text ends in a trailing space) | `gtk-sat-list.c:961-1007` |
| Single-sat "SSP Lat."/"SSP Lon." | same `%.2f°%c` rule | `gtk-single-sat.c:137`, `:272-302` |
| Pass dialogs "Lat"/"Lon" columns (right-aligned) | same | `sat-pass-dialogs.c:640-697` |
| Map grid labels | `%.0f°` + suffix or space | `gtk-sat-map.c:490-545` |
| Ground Stations list "Lat"/"Lon" | `%.4f°` + suffix or space | `sat-pref-qth.c:753-809` |
| Location-selector tree (ground-station editor) | `%.4f°` + suffix | `loc-tree.c:433-477` |

Not affected: map cursor text " LON:%.0f° LAT:%.0f° " (ER §5), pass print/save text (signed `%6.2f`, `pass-to-txt.c:328`; header "LAT:%.2f LON:%.2f", `:170-177`), Satellite Info, the ground-station editor spinners.

**Imperial (USE_IMPERIAL)**; conversions are `x/1.609344` km→mi and `3.2808399·x` m→ft (`gpredict-utils.h:6-9`).

| Display | Rendering | Cite |
|---|---|---|
| List "Range", "Footp", "Alt" (`%.0f`) and "Rate", "Vel" (`%.3f`) | converted, **no unit text** in the cell | `gtk-sat-list.c:820-882`, `:1047`, `:1075` |
| Single-sat "Slant Range", "Footprint", "Altitude" `%.0f mi`; "Range Rate", "Velocity" `%.3f mi/sec` | converted, unit text shown | `gtk-single-sat.c:203-210`, `:320-337` |
| Pass dialogs "Range", "Alt", "Footp" (`%.0f`), "Rate", "Vel" (`%.3f`) | converted, no unit text | `sat-pass-dialogs.c:586-602`, `:720-771` |
| Radio-control window range `%.0f mi`, rate `%.3f mi/s` | converted | `gtk-rig-ctrl.c:283-300` |
| Ground-station altitude: "Alt\n(ft)" column, "ft ASL" label, spinner range | m→ft | `sat-pref-qth.c:199-213`, `:448-455`; `sat-pref-qth-editor.c:706-727` |

Not affected: map and polar views (no distances drawn), pass print/save text (always km and km/s, `pass-to-txt.c:310-378`), the module-config "Add" editor's saved altitude (§3).

---

## 3. General → "Ground Stations" (beyond ER §10)

**List** (`sat-pref-qth.c`)
- Source: every `*.qth` file directly in the conf dir (`:318-325`). The station name is the file name without `.qth` (`qth-data.c:83-85`). Rows are sorted by Name ascending (`:312-314`).
- Columns and cell formats: "Name"; "Location"; "Lat"/"Lon" `%.4f°` + suffix or space (§2.1); "Alt\n(m)" or "Alt\n(ft)" (chosen when the page is built, `:199-213`); "QRA" (6-character locator computed from lat/lon, `:405-424`); "Default" (check box). GPSD columns exist only in libgps builds (`:247-274`). A "WX" column is commented out (`:225-231`).
- Double-clicking a row = Edit (`:244-245`, `:535-544`). Buttons and tooltips are in ER §10.

**Default station**
- Stored as the basename `<name>.qth` in GLOBAL/DEFAULT_QTH, default `sample.qth` (`sat-cfg.c:221`, `data/sample.qth`: "Copenhagen, Denmark", lat 55.6167, lon 12.65, alt 5 m, WX EKCH).
- Written on OK only (`sat-pref-qth.c:852-861`). Cancel discards everything done in the tab.
- A row is marked default when its file path **ends with** the stored name (`:427-436`), so "xsample.qth" would also match "sample.qth" (quirk).
- Ticking another row's "Default" check box sets it and clears all others. **Unticking the default is ignored**: only an INFO log line, no dialog (`:657-706`).
- Stations created with "Add new" are never default. The editor never touches the flag (`sat-pref-qth-editor.c:284-298`).

**Editing and deleting (still in the list model until OK)**
- Editing can rename (the name field is editable); there is **no duplicate-name check**. Two rows with the same name write the same file; the later one wins (`:812-871`).
- "Delete" removes the row from the list only. With fewer than two rows an error dialog "Can not delete ground station!\n\nYou need to have at least one ground\nstation set up, otherwise gpredict may\nnot work properly." appears (`:581-598`). Deleting the default makes the **first row in sorted order** the new default (`:621-639`).
- OK first deletes **every** `*.qth` file in the conf dir (`:879-930`), then rewrites one file per list row (`:134-140`). Cancel undoes it all.
- With Imperial on, the list holds feet. On save they are converted back with the integer truncation `FT_TO_M` (`:844-847`). Each OK therefore loses up to 1 m (for example 100 m → 328 ft → 99 m; derived by reading, not run).

**What happens to modules**
- A module stores `QTHFILE=<name>.qth`. Choosing "** DEFAULT **" in the module dialog **removes** the key (`mod-cfg.c:774-787`).
- A module resolves its station only when it is created: key value, else GLOBAL/DEFAULT_QTH (`gtk-sat-module.c:896-904`).
  - Modules using "** DEFAULT **" therefore follow whichever station is default when they are next opened.
  - Open modules keep the in-memory station. `qth_data_read` is called only at module creation (grep), so a new default or edited coordinates reach an open module only after it is re-created: restart, close and reopen, or "Configure" → OK, which closes and re-creates the module (`gtk-sat-module.c:1238-1300`).
- **Deleted or renamed station in use:** reading `<conf dir>/<file>` fails, the ERROR is logged, the `QTHFILE` key is removed and the module file is saved immediately (`:904-916`). Then DEFAULT_QTH is tried (`:919-922`). If that fails too, built-in "safe" coordinates are used (`:929-930`).
- Renaming the default station keeps its "Default" flag; OK writes the new basename to DEFAULT_QTH (`:852-861`).

**Module-config "Add" editor (`qth-editor.c`) differs from the Preferences editor**
- It writes `<conf dir>/<name>.qth` **immediately** on OK (`:196-199`); on failure the error dialog reads "An error occurred while trying to save\nground station data to %s.qth!\nPlease try again using a different name." (`:740-742`).
- Altitude tooltip is "Select the altitude of the ground station" (`:598-600`). Preferences uses "…in meters or feet depending on your settings" (ER §10).
- With Imperial on the label becomes "ft ASL" (`:603-606`) but the spinner range stays 0–5000 and the typed value is saved **unconverted** (`:159`, `:193`).

---

## 4. General → "TLE Update" (`sat-pref-tle.c`)

**Layout:** vertical box, border 20, spacing 10: "Auto-Update" block, separator, "Update from the Internet" block, separator, one check box, then a right-aligned "Reset" (`:506-527`).

| Control | Label | Tooltip / notes | Default | Key | Cite |
|---|---|---|---|---|---|
| Header | "<b>Auto-Update:</b>" | – | – | – | `:73` |
| Combo | "Check the age of TLE data:" with items "Never", "Monthly", "Weekly", "Daily" (values 0–3) | – | Weekly | TLE/AUTO_UPDATE_FREQ = 2 | `:78-95`; `tle-update.c:1355-1368`; `sat-cfg.c:211` |
| Label | "If TLEs are too old:" | – | – | – | `:98` |
| Radio | "Notify me" | – | selected | TLE/AUTO_UPDATE_ACTION = 1 | `:101`, `:109-113`; `sat-cfg.c:212` |
| Radio | "Perform automatic update in the background" | – | – | action = 2 | `:103-106` |
| Header | "<b>Update from the Internet:</b>" | – | – | – | `:260-261` |
| Entry | "Proxy server:" (right-aligned label; entry spans 5 grid columns) | "Enter URL for local proxy server. e.g.\nhttp://my.proxy.com" | empty (no key) | TLE/PROXY | `:271-283` |
| List | "TLE sources:" (right-aligned label). The list has **no header row**, one editable text column, and is scrollable (5 columns × 3 rows) | "List of files with TLE data to retrieve from the Internet\nClick twice on a row to edit" | 11 URLs below | TLE/URLS (joined by `;`) | `:286-322`, `:299-305` |
| Button | "Add TLE source" | "Add a new TLE source to the list" | appends row "http://server.com/file.txt", selects and scrolls to it; **does not start editing** (code TODO) | – | `:204-207`, `:134-155` |
| Button | "Delete TLE source" | "Delete the selected TLE source" | removes the selected row. With fewer than two rows: error dialog "Can not delete TLE source!\n\nYou should have at least one TLE source configured, otherwise Gpredict may not work correctly.\n\nIf you want to modify the TLE source, click twice on the row to edit it." | – | `:209-211`, `:158-198` |
| Check box | "Add new satellites to local database" | "Note that selecting this option may cause previously deleted satellites to be re-added to the database." | on | TLE/ADD_NEW_SATS | `:328-337`; `sat-cfg.c:139` |
| Button | "Reset" | "Reset settings to the default values." | – | – | `:402-418` |

**Default TLE sources, literally** (`sat-cfg.c:235-246`; 1 AMSAT + 10 CelesTrak, separated by `;`):
1. `https://www.amsat.org/amsat/ftp/keps/current/nasabare.txt`
2. `https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle`
3. `https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle`
4. `https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle`
5. `https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle`
6. `https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tlet` (**sic**, `tlet`, typo in the default)
7. `https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle`
8. `https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle`
9. `https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=tle`
10. `https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle`
11. `https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle`

**Persistence**
- OK writes only if some control changed ("dirty"). It stores frequency, action, proxy (an empty entry **removes** the key) and the URL list joined by `;` in row order (`:428-492`). A `;` inside a URL cannot be represented (derived).
- "Reset" loads defaults into the widgets. If nothing is changed afterwards, OK removes the five keys (frequency, action, proxy, URLs, add-new) from the config (`:352-392`, `:493-503`). If any control is changed after Reset, the normal save branch runs instead.
- **The "Add new satellites to local database" check box is never written on OK.** A grep finds no `sat_cfg_set_bool` for TLE/ADD_NEW; the box is only read, reset to default, or removed by Reset. In v2.7 un-ticking it has no lasting effect: the update engine reads the config value (default true) at update time (`tle-update.c:312`, `:376`).
- Other TLE keys: TLE/LAST_UPDATE (unix seconds, default 0, `sat-cfg.c:213`); TLE/FILE_DIR (last "local files" directory, no default, `:247`); legacy TLE/SERVER `https://celestrak.org/NORAD/elements/` and TLE/FILES `amateur.txt;cubesat.txt;visual.txt;weather.txt` (`:232-233`), used only to migrate configs older than 1.4 (`sat-cfg.c:309-346`). TLE/SERVER_AUTH, TLE/PROXY_AUTH are defined (false) but have no UI.

---

## 5. TLE update flows

### 5.1 Age check and auto-update (`main.c`)

- **There is no check at start-up.** `main.c:163` registers a repeating timer of **600000 ms (10 min)**. The first check runs ten minutes after launch, then every ten minutes (`:441-540`, returns TRUE). The timer is removed at exit (`:337-338`, `:543-557`).
- Age = now − TLE/LAST_UPDATE. Thresholds (`:464-482`):

| "Check the age of TLE data:" | Threshold |
|---|---|
| Never | none (infinite): the check never fires |
| Monthly | 2592000 s (30 days) |
| Weekly | 604800 s |
| Daily | 86400 s |

  A fresh install has LAST_UPDATE 0, so the first tick after ten minutes is already "too old" (unless Never). The comment "just warn after one week" for Never (`tle-update.h:40`) is **not** implemented.
- When due:
  - **"Perform automatic update in the background":** starts a thread (named "gpredict_tle_update") running the network update with no dialog; afterwards it reloads the satellites of all modules on the main loop (`:498-515`, `:568-590`). No message is shown.
  - **"Notify me":** shows a non-modal info dialog with one "OK" button that closes on any response. No title is set. Text (Pango markup): "Your TLE files are getting out of date.\nYou can update them by selecting\n<b>Edit -> Update TLE</b>\nin the menubar." (`:516-536`).
  - The notice appears **once per program run** (flag never reset, `:74`, `:535`). The text says "Update TLE", but the menu items are "Update TLE data from network" / "Update TLE data from local _files" (ER §1).
- LAST_UPDATE is stored only when a run changed something (updated > 0 or new satellites > 0, `tle-update.c:396-403`). If all data is already current, the age does not reset and the background update re-runs at every ten-minute tick.
- Quitting while a background update runs waits for it to finish (`main.c:558-564`).
- CLI: `--clean-tle` deletes all `satdata/*.sat`; `--clean-trsp` deletes all `trsp/*.trsp` (`main.c:56-59`, `:599-675`).

### 5.2 Edit → "Update TLE data from network" (`menubar.c:578-653`)

| Widget | Text |
|---|---|
| Dialog | Modal, title "TLE Update", one button "_Close" (disabled until finished) |
| Heading | bold, centred "<b>Updating TLE files from network</b>" |
| Activity label | "..." initially; then "Fetching <url>" per source, "Reading data from <file>" per file read, "Updating data...", finally "Finished" |
| Progress bar | downloads fill 0–50 %, merging fills 50–100 % (`tle-update.c:626-629`, `:330-345`), set to 100 % at the end |
| Statistics label | initially "Satellites updated:\t 0\nSatellites skipped:\t 0\nMissing Satellites:\t 0\n"; after the run see §5.4 |

- No confirmation; starts at once. Afterwards modules reload their satellites even though the dialog is still open (`menubar.c:652`).
- Download loop (`tle-update.c:552-641`): each URL is fetched in order with libcurl (user agent "gpredict/curl", 10 s connect timeout, redirects followed, proxy if set) into `satdata/cache/file-<i>.tle`. Failures are logged only ("Error fetching …"). If at least one fetch succeeded, the cache is processed as in §5.3; otherwise the ERROR "Could not fetch TLE files from network. Aborting." is logged and the dialog simply ends with "Finished" (`:647-665`). The cache files are deleted afterwards (`:675-701`).
- With zero sources the activity label reads "No files to fetch from network" (`:523-533`). A second concurrent update is refused with a logged ERROR (`:499-506`).
- There is no HTTP status check, so an error page would be saved as `file-N.tle` and then fail validation ("No valid TLE data found in …"); this relies on libcurl defaults (**UNVERIFIED**).

### 5.3 Engine: reading, matching, updating (`tle-update.c`)

| Step | Rule | Cite |
|---|---|---|
| Files read | Regular files directly in the directory (not recursive) whose name, compared case-insensitively, ends in `.tle` or `.txt`. The `filter` argument is unused | `:738-757`, `:122` |
| Formats | 3-line sets (name + line 1 + line 2) **and** bare 2-line sets, mixed freely. A sliding window skips junk lines (headers, trailing text) | `:771-1096` |
| Line limits | Lines read up to 79 characters, whitespace stripped, TLE lines cut to 69 characters | `:864`, `:920-923`, `:992-993` |
| Validity | Line 1 starts with `1`, line 2 with `2`, both mod-10 checksums good (`:932-952`), same catalogue number on both lines, decimal points at fixed columns, ephemeris-type field " 0 ", well-formed epoch | `:932-952`; `sgpsdp/sgp_in.c:52-147` |
| Name from 3-line set | First 25 characters of the name line, `&` replaced by `/`, trailing spaces trimmed. A trailing status tag ` [+]`, `[-]`, `[P]`, `[B]`, `[S]`, `[X]` is stripped and stored as status: Operational, Non-operational, Partially operational, Backup/Standby, Spare, Extended Mission; none = Unknown | `sgp_in.c:287-358` |
| Name for 2-line set | Synthesised as "<year>-<launch id>" from the international designator (for example "1998-067A"): two-digit year ≥ 57 → 19xx, else 20xx | `:958-975` |
| Key | Catalogue number = line 1 columns 3–7 | `:995-1001` |
| Same satellite twice (across files) | Keep the entry with the larger epoch (the number YYDDD.dddd). Equal epoch: a known status replaces an unknown or different one (warning logged). A "computer generated" name is replaced by a real one | `:1021-1090`; `sgp_in.c:179` |
| "Computer generated" name | matches `\d{4,}-\d{3,}` (CelesTrak id style) or contains "OBJECT" (Space-Track) | `:1380-1393` |
| Category side effect | If `satdata/<file basename up to the first dot>.cat` exists (for example `amateur.cat` for `amateur.txt`), that file is **rewritten** with its first line (the category name) followed by the catalogue numbers of every valid TLE in the input file. The comment "not effective since 1.4" notwithstanding, this code path is active | `:810-858`, `:1013-1019`, `:1098-1102` |
| Local update | Loop over every `satdata/*.sat`. Catalogue number = file name before `.sat` | `:254-283`, `:1162-1163` |
| No data for a local satellite | counted as **Missing Satellites**; file untouched (INFO "No new TLE data found for %d. Satellite might be obsolete.") | `:1171-1182` |
| Data newer than stored | Stored TLE1, TLE2 and STATUS are replaced → **updated** | `:1298-1313` |
| Same epoch | Only a changed, non-unknown status is written → updated; otherwise skipped | `:1314-1327` |
| Older epoch, or nothing to change, or file unreadable or write failed | **Satellites skipped** | `:1196`, `:1329-1339` |
| Names | If the new name is real and the stored NAME is computer generated, NAME is replaced; same for NICKNAME. Counts as updated | `:1262-1293` |
| Bad stored TLE | warning logged, its epoch treated as 0 so it gets overwritten | `:1243-1250` |
| Add new | Only when the config value TLE/ADD_NEW is true (see the §4 persistence note): every satellite in the input that matched no local `.sat` file gets `satdata/<catnum>.sat` with [Satellite] keys VERSION "1.1", NAME and NICKNAME (both the TLE name), TLE1, TLE2, STATUS | `:376-394`, `:418-460` |

`updated`, `skipped` and `nodata` are summed per file; the "total" is their sum. If ADD_NEW is on, the statistics label is replaced at the end by the four-line text in §5.4. The log gets INFO "Added %d new satellites to local database" and "TLE elements updated." (`:391-409`).

### 5.4 Result texts (network and local)

| Condition | Statistics label |
|---|---|
| During and after the run, add-new off | "Satellites updated:\t %d\nSatellites skipped:\t %d\nMissing Satellites:\t %d\n" (`:298-304`) |
| Add-new on, after the run | "Satellites updated:\t %d\nSatellites skipped:\t %d\nMissing Satellites:\t %d\nNew Satellites:\t\t %d" (`:380-389`) |
| Directory cannot be opened | activity label (markup): "<b>ERROR</b> opening directory %s\n%s" with the path and the system message (`:148-155`) |
| Another update running | nothing shown; ERROR logged "A TLE update process is already running. Aborting." (`:124-131`) |

---

## 6. Edit → "Update TLE data from local _files" (`menubar.c:656-798`)

**Step 1: directory dialog**

| Widget | Text | Notes |
|---|---|---|
| Dialog | Modal, title "Update TLE from files", buttons "_Cancel", "_OK" | `:697-702` |
| Label | "Select TLE directory:" | `:687` |
| Chooser | folder-chooser button titled "Select directory" (select-folder mode) | preselected: TLE/FILE_DIR if set, else the user's home directory (`:672-683`) |
| Layout | horizontal box, label and chooser both expanding, 30 px around | `:690-705` |

- OK: logs INFO "Running TLE update from %s", stores the chosen directory in TLE/FILE_DIR (persisted with the next config save, not at once), and opens step 2 (`:720-726`). Cancel: nothing runs.
- After either choice `mod_mgr_reload_sats()` is called (`:796-797`), even after Cancel.

**Step 2: progress dialog.** Modal "TLE Update", button "_Close" (disabled until done), heading "<b>Updating TLE files from files</b>" (the only text that differs from the network dialog, `:746-747`), activity "...", progress bar, statistics label as in §5.2. Sequence: "Reading data from <file>" for each `.tle`/`.txt` found, "Updating data...", then "Finished"; the progress bar runs 0–100 % over the local satellite files (`tle-update.c:308-348`). Counters, matching and add-new behaviour are as in §5.3 and §5.4. No special message appears when the directory has no valid TLE data: everything is counted as "Missing Satellites" and each file logs "No valid TLE data found in <file>".

---

## 7. General → "Message Logs" and File → "_Log browser"

### 7.1 Preferences tab (`sat-pref-debug.c`)

| Control | Label | Tooltip | Default | Key | Cite |
|---|---|---|---|---|---|
| Combo | "Debug level:" with items "Level 0: None", "Level 1: Error", "Level 2: Warning", "Level 3: Info", "Level 4: Debug" | "Select the debug level. The higher the level, the more messages will be logged." (on the combo button) | Level 2: Warning | LOG/LEVEL = 2 | `:171-194`; `sat-cfg.c:215` |
| Combo | "Delete log files older than:" with items "Always delete", "1 day", "1 week", "1 month" | "Select how often gpredict should delete old log files." | Always delete | LOG/CLEAN_AGE = 0 | `:201-217`; `sat-cfg.c:214` |
| Stored ages | 86400 s, 604800 s, **18144000 s** (= 210 days, labelled "1 month"); any other stored value displays as "Always delete" | – | – | – | `:31-33`, `:43-64`, `:82-98` |
| Info text (wrapped label, below a separator) | "Gpredict stores all run-time messages in the <conf dir>/logs/\ndirectory. The current log file is called gpredict.log and the file is\nalways kept until the next execution, so that you can examine it in case\nof a failure. If old log files are kept, they are called gpredict-XYZ.log\nwhere XYZ is a unique timestamp." | – | – | – | `:225-238` |
| Button | "Reset" | "Reset settings to the default values." | – | – | `:241-249` |

- Saving: only if a combo changed; Reset then OK removes both keys (`:72-110`, `:120-150`).
- **The level takes effect at the next program start.** `sat_log_set_level` is called once, from `main.c:133`, right after the config is loaded. Nothing applies the new level during the session.

### 7.2 Logger (`sat-log.c`)

- **File:** `<conf dir>/logs/gpredict.log` (`:90-105`). The directory is created if needed (mode 0755). An existing `gpredict.log` from the previous run is deleted at start-up and a new file is opened for writing (`:104-120`).
- **Line format**, one message per line (a multi-line message is split, trailing newline trimmed; `:171-189`, `:225-226`):

```
YYYY/MM/DD HH:MM:SS|<level 0-4>|<function>: <message>
```

  Time is local time with that fixed format regardless of the Preferences time settings; the level is the numeric value (`sat-log.h:32-38`).
- **Levels:** 0 none, 1 ERROR, 2 WARN, 3 INFO, 4 DEBUG. A message is written only if its level is ≤ the configured level (`:166`). Level 0 therefore writes nothing.
  - Before the config is read the filter is DEBUG (`:55`), so the first line of every log is the INFO "Session started" (`:136`), whatever the level.
  - If the file could not be opened, messages go to stderr (`:243-247`). The stderr echo option is permanently off (`:56`).
- **What is logged** (examples): config read problems, QTH and satellite file loads, module add/remove/restore, TLE and transponder downloads and results, radio and rotator controller activity (`gtk-rig-ctrl.c`, `gtk-rot-ctrl.c` call the logger), window-state errors.
- **Exit and cleanup (`:141-154`, `:253-339`):** on exit "Session ended" is logged at INFO level (so it appears only when the level is 3 or higher), then:
  1. If CLEAN_AGE > 0, `gpredict.log` is renamed `gpredict-<unix time>.log` (kept).
  2. Every `*.log` file whose middle name part (the timestamp) is not greater than (now − CLEAN_AGE) is deleted (string comparison of the numbers). With "Always delete" (0) that is every rotated `gpredict-*.log`; `gpredict.log` itself stays until the next start (where it is deleted).
  3. The comment "0 = Never clean" in `sat-cfg.c:214` is wrong: the UI and code mean "keep nothing but the latest log".

### 7.3 Log browser window (`sat-log-browser.c`)

| Item | Detail | Cite |
|---|---|---|
| Open | File → "_Log browser" (Ctrl+L). Only one window: if it is already open the menu item does nothing | `:459-467` |
| Window | Non-modal dialog, title "Log Browser" (becomes "Log Browser: <full path>" when a file was read), parent = main window, default size 600 × 300 | `:478-486`, `:511-523` |
| Buttons (left to right) | "_Open", "Clear" (no mnemonic), "_Close" | `:481-483` |
| Layout | horizontal box: message list (expands) and, at the right, a "summary" frame (does not expand) | `:469-473` |
| List columns | "Time" (header centred), "Level" (centred), "Message" (left). Plain text, **no sorting, no filters, no search, no live refresh** | `:43-51`, `:425-437` |
| Level text | "NONE", "ERROR", "WARNING", "INFO", "DEBUG" (indexed by the numeric level) | `:53-59`, `:543` |
| Summary frame | Title " Summary " (with spaces, centred). Rows: "Errors", "Warnings", "Info", "Debug", separator, bold "Total"; counts right-aligned, start at "0" | `:299-371` |
| On open | Reads the current `<conf dir>/logs/gpredict.log` once. Messages logged later are not shown | `:504-526` |
| "_Open" | File chooser "Select Log File", buttons "_Cancel"/"_Open", starts in `<conf dir>/logs`, no file filter. On accept: clears the list, reads the file, sets the title (or resets it to "Log Browser" on failure) | `:224-273` |
| "Clear" | Empties the list and zeros the labels (see counter quirk below) | `:97-112` |
| "_Close" | Destroys the window | `:283-285` |
| File parsing | Each line split at `\|` into at most 4 parts: 3 parts = time, level, message; 4 parts = pre-1.4 format (time, source, level, message); 1 part = time "", level ERROR, message = the line; anything else = row "Log file is corrupt" at level ERROR. A message containing `\|` is therefore mis-parsed as the old 4-field format (not run; **UNVERIFIED**) | `:140-181` |
| Counter quirk | "Clear" resets the error/warning/debug counters but **not** the info counter (`:103-105`), so later loads continue from the old info count while the label shows 0 | `:97-112` |

---

## 8. Satellite Info dialog (`sat-info.c`)

**Window:** title "Satellite Info"; one button "_OK" (default response); non-modal; closes on any response; parent = the calling window, or none (`:525-542`). A notebook with two tabs in order: "Orbit Info", "Transponders" (`:518-523`). Any number of dialogs may be open at once.

### 8.1 "Orbit Info" tab

Grid: label column left-aligned, value column left-aligned, column and row spacing 5, border 10 (`:286-289`). Rows top to bottom:

| Row | Label (exact) | Value format | Source | Cite |
|---|---|---|---|---|
| 0 | "<b>Satellite name:</b>" (bold) | bold nickname, markup-escaped | satellite nickname | `:291-302` |
| 1 | "Operational Status:" | "Operational", "Non-operational", "Partially operational", "Backup/Standby", "Spare", "Extended Mission", "Unknown" (translatable here) | TLE status (name tag `[+]` … `[X]` or the stored STATUS) | `:304-343` |
| 2 | "Catalogue number:" | `%d` | line 1 cols 3–7 | `:345-354`; `sgp_in.c:158-160` |
| 3 | "International designator:" | raw 8 characters of line 1 columns 10–17, trailing spaces included (for example "98067A  ") | `idesg` | `:356-363`; `sgp_in.c:163-164` |
| 4 | "Element set number:" | `%d` | line 1 cols 65–68 | `:365-374`; `sgp_in.c:229-232` |
| 5 | "Epoch time:" | the global Time format (§2) in UTC or local time, second resolution (fraction of day floored), at most 50 characters. The year is always read as 2000 + two digits | epoch fields | `:376-385`, `:198-262`; `sgp_in.c:187-201` |
| 6 | "Orbit number @ epoch:" | `%d` | revolution number | `:387-396` |
| – | horizontal separator | | | `:400-403` |
| 8 | "Inclination:" | `%.4f°` | | `:405-414` |
| 9 | "RAAN:" | `%.4f°` | | `:416-425` |
| 10 | "Eccentricity:" | `%.7f` (values below 1e-6 are clamped to 1e-6 when the TLE is read) | | `:427-436`; `sgp_in.c:250-251` |
| 11 | "Arg. of perigee:" | `%.4f°` | | `:438-447` |
| 12 | "Mean anomaly:" | `%.4f°` | | `:449-458` |
| 13 | "Mean motion:" | `%.8f [rev/day]` | TLE value (rev/day) | `:460-469` |
| 14 | "½ d/dt (mean motion):" (U+00BD) | `%.5e [rev/day²]`; the 2 is a Pango superscript | first derivative / 2 | `:471-482` |
| 15 | "1/6 d²/dt² (mean motion):" (superscripts via markup) | `%.5e [rev/day³]` | second derivative / 6 | `:484-497` |
| 16 | "B* drag term:" | `%.5e [R_E^-1]` (markup: subscript E, superscript −1); value = B* × ae, with ae = 1.0 | | `:499-510`; `sgp4sdp4.h:213` |

**Not shown:** orbital period, current orbit number, decay/decayed state, orbit type, next event and ephemeris type. The code has empty "Orbit type" and "Next Event" placeholder comments (`:398`, `:512-514`).

### 8.2 "Transponders" tab

- **No data:** a single label "No transponders". This applies when `trsp/<catnum>.trsp` is missing, unreadable (ERROR logged) or has zero groups (`:69-73`; `trsp-conf.c:88-112`).
- **With data:** a vertical scrolled list (horizontal scroll never, vertical automatic, `:182-185`; box spacing 3, border 10). For each transponder, in file order:
  1. a spacer label " ";
  2. bold name, the group name = the SatNOGS description (`:89-93`; `trsp-update.c:359`). The name is inserted into markup **without escaping**, so `&` or `<` in a description would break the label;
  3. a horizontal separator;
  4. "Uplink: %.4f ‒ %.4f MHz" (the dash is U+2012, bytes E2 80 92) when the lower frequency is above 0 and the upper is greater than the lower; "Uplink: %.4f MHz" for a single frequency; omitted when the lower value is 0 (`:100-122`);
  5. "Downlink: …" with the same rules (`:124-146`);
  6. "Inverting: YES" or "Inverting: NO" (values not translatable), **only** when both uplink and downlink are ranges (`:148-159`);
  7. "Mode: %s" when a mode string exists (`:161-169`);
  8. "Baudrate: %9.2f" when the baud rate is non-zero (`:170-177`).
- Frequencies are stored in Hz and shown in MHz (÷ 1e6). Negative values become 0, and if only the low or only the high value exists it is copied to the other, so the transponder shows as a single frequency (`trsp-conf.c:44-65`).
- **Data source:** Edit → "Update transponder data" (ER §1, §12) downloads the SatNOGS database and writes `trsp/<catnum>.trsp`: a group named by the description with keys UP_LOW, UP_HIGH, DOWN_LOW, DOWN_HIGH (only if > 0), MODE (SatNOGS mode name, or the numeric id if unknown), BAUD (`%.0f`, only if > 0), INVERT=true (only if inverting) (`trsp-update.c:296-302`, `:355-377`). The SatNOGS "alive" flag is read but never used to filter (`:307-308`).

---

## 9. Detach, Attach, Full screen, window memory and start-up restore

State values stored in the module file `[GLOBAL]`: **STATE** 0 = docked, 1 = window, 2 = full screen (never written, see below); **WIN_POS_X**, **WIN_POS_Y**, **WIN_WIDTH**, **WIN_HEIGHT** (`config-keys.h:77-81`).

| Action | Window result | Config effect | Cite |
|---|---|---|---|
| "Detach module" (docked → window) | New top-level window titled "GPREDICT: <module> (<station>)" (icon `gpredict-icon.png`). **Size:** stored WIN_WIDTH × WIN_HEIGHT, else the module's current docked size. **Position:** moved to the stored WIN_POS only if the global "Restore position of module windows" is on **and** both keys exist; otherwise the window manager places it. A configure hook is installed. The module leaves the notebook (tabs hidden if one page remains; main title refreshed). An open Time Controller is made transient for the new window | STATE = 1 in memory | `gtk-sat-module-popup.c:343-454`; `mod-mgr.c:533-605` |
| "Attach module" (window or full screen → docked) | Window destroyed; module **appended as the last notebook page** (not made current). Time Controller is made transient for the main window again | STATE = 0 in memory. Stored geometry is kept | `:456-489`; `mod-mgr.c:464-514` |
| "Full screen" from docked | New window (title as above, **no** size or position restore, **no** configure hook), full-screened at once | module state = full screen; STATE in the file is **not changed** | `:516-565` |
| "Full screen" from window | Same window is full-screened, then `set_default_size(800, 600)` | file STATE unchanged | `:567-573` |
| "Exit full screen" | Un-fullscreens; module becomes a **window** (not docked). Default size = stored WIN_WIDTH × WIN_HEIGHT, else 800 × 600; moved to the stored position under the same preference rule | STATE = 1 | `:575-632` |

Whether the size set after un-fullscreening takes effect on an already-mapped GTK window, and whether configure events during full screen overwrite the stored geometry (platform dependent), are **UNVERIFIED**.

**Geometry is remembered continuously.** The hook on each detached window (`module_window_config_cb`, `:1019-1070`) writes x, y, width and height into the module's in-memory key file on every configure event while the window is visible, except when the window has negative coordinates or does not fit inside the primary monitor's work area. The values reach disk when the module is saved: on module close (`gtk-sat-module.c:1133`) and at application exit (`mod-mgr.c:349-355`, called from `main.c:341`).

**Full screen is never restored.** STATE is written only by Detach, Attach and Exit full screen, never with the value 2. A module that was full screen at quit comes back docked or as a window, according to the last stored STATE.

**Main window** (`main.c`): size is always saved (configure events, only if fully inside the work area, `:369-426`) and always restored (`:251-253`); position is restored only if "Restore position of main window" is on (`:256-261`).

**Start-up restore (`mod-mgr.c:85-188`)**
- GLOBAL/OPEN_MODULES (`;`-joined names, default "Amateur", `sat-cfg.c:222`) and GLOBAL/CURRENT_PAGE (notebook index, default −1) are read. They are written at exit in the order of the internal module list, i.e. creation order, **not** the current tab order after drag-reordering, together with the current page index (derived from `:349-380`). With no open modules the key is removed (`:339-347`).
- Duplicate names are skipped (INFO "Skipping duplicate module %s"). A module that fails to load logs ERROR "Failed to restore %s" and the page index to select is decremented (`:109-127`, `:151-158`). The saved page is selected at the end (`:164-166`).
- A module's STATE is honoured only if the global "Restore the state of modules when reopened (docked or window)" is on; otherwise the module is docked (`gtk-sat-module.c:1035-1048`, `mod-mgr.c:138-149`). Docked → notebook tab. Window → a window built by `mod-mgr.c:655-745`.
  - Title there is "Gpredict: <module> (<station>)" (note the case difference from "GPREDICT: " at Detach, ER §1).
  - Size is stored WIN_WIDTH × WIN_HEIGHT, else the module's current allocation, which is not yet realised at that point (value **UNVERIFIED**).
  - Position uses the same rule as Detach.
- If every module is a window, the notebook is empty and the main window title reads "Gpredict: (none)" (`mod-mgr.c:591-594`).
- File → "Open module" of an already-open module selects or raises it instead of opening a second copy (`menubar.c:412-423`, `mod-mgr.c:432-448`). Otherwise it applies the same docked/window decision (`menubar.c:453-465`, window builder `:112-197` with title "GPREDICT: …").
- **Configure → OK** closes and re-creates the module in the same state (`gtk-sat-module.c:1238-1362`). Re-created windows are titled with the bare module name, size = the size just before, and **no** configure hook, so their later geometry is not recorded (`:1326-1362`).

---

## 10. Modules group: global settings vs per-module settings

**Two storage levels**
- *Global:* `gpredict.cfg`, group MODULES (plus GLOBAL for window placements), edited in Preferences → Modules (`sat-pref.c:86`).
- *Per module:* `<conf dir>/modules/<name>.mod`, sections GLOBAL, LIST, MAP, POLAR, SINGLE_SAT, EVENT_LIST (`config-keys.h:64-153`), edited via the module's "Configure" → "Properties" (ER §3).
- The same page widgets serve both; a `GKeyFile` argument selects local mode, NULL selects global mode (`sat-pref-modules.c:43-57`).

**Inheritance rule.** A view reads a key from the module file if it exists; otherwise from the global config; otherwise from the built-in default (`mod-cfg-get-param.c:62-156`; `sat_cfg_get_*` fallback `sat-cfg.c:409-417`). There is **no "use global" check box**: "using the global value" simply means the key is absent from the `.mod` file. A new module stores only SATELLITES and (unless "** DEFAULT **") QTHFILE (`mod-cfg.c:769-824`), so it follows the global settings.

**Pages loaded in module mode** show the module's value, falling back to the global value (for example `sat-pref-map-view.c:762-770`, `:845-849`).

**What OK writes.** A page writes only when one of its controls was changed ("dirty"), and then it writes **all of the page's keys**, pinning even values left at the global setting.
- Layout page: layout code only in module mode (`sat-pref-layout.c:92-99`).
- Map, Polar: any edit sets dirty permanently (`sat-pref-map-view.c:381-501`).
- List and Single Sat: dirty means "flags differ from the starting flags", so toggling back clears it (`sat-pref-list-view.c:115-124`, `sat-pref-single-sat.c:90-99`).
- Nothing changed: nothing written (the module keeps inheriting).

**Reset**

| Mode | Button tooltip | Effect on the widgets | Effect of OK afterwards | Cite |
|---|---|---|---|---|
| Global | "Reset settings to the default values." (Map page: "Reset settings to default values") | loads built-in defaults | deletes the page's keys from `gpredict.cfg` | `sat-pref-layout.c:392-461` |
| Module | "Reset module settings to the global values." (Map page: "Reset module to global settings") | loads current global values | deletes the page's keys from the `.mod` file (re-inherit) | same |

- Reset sets `reset=TRUE`, `dirty=FALSE`; Cancel discards it. If any control is changed after Reset, the dirty branch wins, so the reset turns into explicit values (the OK handlers test dirty first, for example `sat-pref-layout.c:92-136`).
- The Layout page's global Reset also resets the three Window Placements check boxes (`:426-437`, `:117-129`).
- The Map page's Reset omits the "Solar terminator:" and "Global shadow:" colours in both modes (§11).

**When global changes take effect.** Views read their settings when they are created (for example `gtk-sat-map.c:327-358`), and the Preferences OK path only saves (`sat-pref.c:170-176`); the map's `reconf` hook is an empty stub (`gtk-sat-map.c:1195-1199`). So changes on the global Layout, Refresh Rates, List, Map, Polar and Single Sat pages reach a module only when it is next created (restart, reopen, or "Configure" → OK). The number formats of §2 apply at once. Inferred from the absence of any refresh call (**UNVERIFIED**).

**Module "Properties" dialog.** Title "Module properties", buttons "_Cancel"/"_OK" (`mod-cfg.c:847-852`). Its OK writes straight into the module's live key file (`:870`), which the outer "Configure"/"New module" dialog's own Cancel does not undo (derived; saved to disk at the next module save).

**Layout page details** (`sat-pref-layout.c`)
- Choosing a preset (ER §3) fills the layout code and disables the entry. "Custom" enables it. Typing in the entry switches the combo to "Custom" (`:166-236`).
- The entry accepts only digits and `;`; other characters beep (display bell) and are deleted (`:184-199`).
- An invalid code (empty, or its length not a multiple of five) is replaced by the built-in default preset with the ERROR "Module layout is invalid: %s. Using default." (`gtk-sat-module.c:950-964`).

**Window Placements** (global Layout page only, below the layout table and above "Reset", `sat-pref-layout.c:326-379`, `:495-497`)

| Check box (exact label) | Tooltip (exact) | Default | Key |
|---|---|---|---|
| header "<b>Window Placements:</b>" | – | – | – |
| "Restore position of main window" | "If you check this button, gpredict will try to place the main window at the position it was during the last session.\nNote that window managers can ignore this request." | off | GLOBAL/MAIN_WIN_POS |
| "Restore position of module windows" | "If you check this button, gpredict will try to place the module windows at the position they were the last time.\nNote that window managers can ignore this request." | off | GLOBAL/MOD_WIN_POS |
| "Restore the state of modules when reopened (docked or window)" | "If you check this button, gpredict will restore the states of the modules from the last time they were used." | off | GLOBAL/MOD_STATE |

Defaults: `sat-cfg.c:117-119`. Consumers: main window `main.c:256`; module windows `gtk-sat-module-popup.c:407`, `mod-mgr.c:717`, `menubar.c:165`; state `gtk-sat-module.c:1039`, `mod-mgr.c:141`, `menubar.c:456`. They are saved with the Layout page (only when it is dirty: toggling a box counts, `:319-324`, `:101-115`).

---

## 11. Map View page: background map and colours (`sat-pref-map-view.c`, `map-selector.c`)

**Page structure.** Scrolled window (horizontal never, vertical automatic), border 20, five blocks separated by separators: Background Map, Contents, Colours, orbit and centre rows, Reset (`:1467-1508`). Labels are in ER §5; this section adds layout, tooltips and semantics.

**Background Map block.** Header "<b>Background Map:</b>"; a 100 × 50 thumbnail (the image scaled with hyper interpolation, or the icon `image-missing` if the file cannot be read) at the left; button "Select map" (tooltip "Click to select a map") beside it, vertically centred; column gap 15 (`:736-808`).

**"Select map" dialog (`map-selector.c`)** is a plain GTK file chooser, **not** a custom list with thumbnails:

| Item | Detail | Cite |
|---|---|---|
| Title / buttons | "Select Map"; "_Cancel", "_Open"; single selection; no parent window | `:242-250` |
| Filter | one filter named "Image files" = all image formats GdkPixbuf supports | `:256-260` |
| Shortcut folder | the stock maps directory (`<data dir>/pixmaps/maps`) | `:253`; `compat.c:88-107` |
| Preselection | the current map (relative name = stock map; absolute path = custom) | `:262-273` |
| Preview pane | the picture scaled to 160 × 80 plus a caption "<w>x<h> pixels\n<size>", where size reads `%0.1f GB`, `%0.1f MB`, `%0.1f kB` or `%lu B` (thresholds are strict ">" at 1024 powers). Unreadable file: icon `image-missing` and the preview is deactivated | `:46-67`, `:69-211` |
| Result | file inside the stock maps dir → the **basename** is stored; any other file → the **absolute path** is stored (GLOBAL/MAP_FILE or MAP/MAP_FILE) | `:288-312`; `config-keys.h:94` |

- Stock maps shipped (repo `pixmaps/maps`): `earth_800.png`, `nasa-bmng-01_1024.jpg`, `nasa-bmng-01_2048.jpg`, `nasa-bmng-03_1024.jpg`, `nasa-bmng-03_2048.jpg`, `nasa-bmng-05_1024.jpg`, `nasa-bmng-05_2048.jpg`, `nasa-bmng-07_1024.jpg` (default), `nasa-bmng-07_2048.jpg`, `nasa-bmng-08_1024.jpg`, `nasa-bmng-08_2048.jpg`, `nasa-topo_800.png`, `nasa-topo_1024.jpg`, `nasa-topo_1600.jpg`, `nasa-topo_2048.jpg`.
- Choosing a map only marks the page dirty and refreshes the thumbnail; it is saved on OK (`:712-733`).
- A missing configured file is logged and replaced by the default name, but that bare name is not joined with the maps directory, so the load is expected to fail and a flat 400 × 200 grey image is drawn instead (`gtk-sat-map.c:1225-1255`; runtime result **UNVERIFIED**).

**Contents block.** Header "<b>Contents:</b>"; 4 columns × 2 rows, column gap 10, row gap 3 (`:832-837`).

| Position | Label | Tooltip (exact) | Default |
|---|---|---|---|
| row 0 col 0 | "Satellite Name" | "Show the satellite name on the map" | on |
| row 0 col 1 | "Satellite Footprint" | "Show the satellite footprint on the map" | on |
| row 0 col 2 | "Satellite Marker" | "Show the satellite marker on the map" | on |
| row 0 col 3 | "QTH Info" | "Show location information on the map" | on |
| row 1 col 0 | "Next Event" | "Show which satellite comes up next and at what time" | on |
| row 1 col 1 | "Cursor Position" | "Show the latitude and longitude of the mouse pointer" | off |
| row 1 col 2 | "Grid Lines" | "Show horizontal and vertical grid lines" | on |
| row 1 col 3 | "Solar Terminator" | "Show solar Terminator" | off |

Cite `:840-1001`; defaults `sat-cfg.c:121-128`.

**Colours block.** Header "<b>Colours:</b>"; every swatch is a GTK colour button with **alpha enabled** (`gtk_color_chooser_set_use_alpha`, so the chooser offers an opacity control); the page is marked dirty only when the user confirms a colour ("color-set") (`:1013-1274`). Grid, three label/button pairs per row (label right-aligned):

| Row | Pair 1 | Pair 2 | Pair 3 |
|---|---|---|---|
| 0 | "Ground Station:" – tooltip "Select the ground station colour" | "Grid:" – "Select the grid colour" | "Tick Labels:" – "Select a colour for tick labels" |
| 1 | "Satellite:" – "Select the satellite colour" | "Selected Sat.:" – "Select colour for selected satellites" | "Ground Track:" – "Select ground track colour" |
| 2 | "Footprint:" – "Select colour for satellite footprint area.\nHint: Make it transparent" | "Info Text FG:" – "Select info text foreground colour" | "Info Text BG:" – "Select info text background colour" |
| 3 | "Solar terminator:" – "Select solar terminator colour" | "Global shadow:" – "Select Earth shadow colour" | – |
| 4 | "Shadow:" label, "<i>Transp.</i>" (right-aligned) at col 1, slider cols 2–4, "<i>Opaque</i>" at col 5 | | |

Cites: `:1035`, `:1057`, `:1079`, `:1101`, `:1123`, `:1147`, `:1170`, `:1195`, `:1219`, `:1243`, `:1268`, `:1292-1324`.

- **Shadow slider:** integer 0–255, step 1, value not drawn. Default 0xDD (221). Tooltip: "Shadow transparency under the satellite marker.\n\nThe shadow improves the visibility of the satellites where the colour of the background is light, e.g. the South Pole. Fully transparent is the same as no shadow." (`:1303-1324`). In the map the stored integer is used as the alpha of a **black** shadow (it is passed through the RGBA converter as `0x000000AA`, `gtk-sat-map.c:355-358`, `:691-694`).
- **Colour storage:** one integer per colour, `0xRRGGBBAA` (red in the top byte, alpha in the low byte), written in decimal. Converting from the chooser truncates each channel (`(uint)(x·255)`, no rounding) (`gpredict-utils.c:517-550`). Alpha 0xFF is opaque; defaults are in ER §5 (for example footprint `0xFFFFFF1F` ≈ 12 % opaque).
- **Info background** is the only colour that loses alpha: it is turned into a six-digit-style hex string for Pango markup by `rgba2html`, which drops alpha and does **not** zero-pad each component (`gtk-sat-map.c:327-331`, `gpredict-utils.c:406-426`). A component below 0x10 therefore yields a hex string shorter than six digits (how Pango reads it is **UNVERIFIED**).
- "Tick Labels" is stored but the map draws tick labels in the grid colour (`gtk-sat-map.c:346`, ER §5).
- The Sky-at-a-Glance colours (ER §11) use plain `0xRRGGBB` without alpha (`gpredict-utils.c:554-587`).

**Orbit and centre rows** (each its own row, gap 10):
- "Display ground track for" [spin 1–10, 0 digits, numeric] "orbit(s)" (`:1349-1374`). Default 3 (ER §13 corrects the manual).
- "Center map at longitude" [spin −180…180, 0 digits, numeric, tooltip "Select longitude. West is negative."] "[deg]" (`:1397-1423`). Default 0.

**Reset** (right-aligned): tooltips in §10. **Gap:** in both global and module mode the OK-after-Reset key lists omit TERMINATOR_COLOUR and GLOBAL_SHADOW_COLOUR, so those two colours are **not** reset in storage (`:599-658`, `:677-693`).

---

## 12. Polar View page extras (`sat-pref-polar-view.c`)

Labels, defaults and group headers are in ER §6 and §11. Additions:

| Block | Layout | Tooltips (exact) | Cite |
|---|---|---|---|
| "<b>Orientation:</b>" | four radio buttons in one **homogeneous** row, in this order | "N/E/S/W": "\tN\nW\t\tE\n\tS". "N/W/S/E": "\tN\nE\t\tW\n\tS". "S/E/N/W": "\tS\nW\t\tE\n\tN". "S/W/N/E": "\tS\nE\t\tW\n\tN". (Drawn as a compass: the two N/S lines centred, E/W on the middle line) | `:300-326` |
| "<b>Contents:</b>" | grid 3 columns × 2 rows: row 0 "Satellite Name", "Satellite Marker", "QTH Info"; row 1 "Next Event", "Cursor Position", "Extra Az Ticks" | "Show the satellite name on the polar plot"; "Show the satellite marker on the polar plot"; "Show location information on the polar plot"; "Show which satellites comes up next and at what time"; "Show the azimuth and elevation of the mouse pointer"; "Show extra tick marks for every 30°" | `:413-534` |
| "<b>Colours:</b>" | grid, three label/button pairs per row, alpha-enabled colour buttons: row 0 "Background:", "Axes/Circles:", "Tick Labels:"; row 1 "Satellite:", "Selected Sat.:", "Sky Track:"; row 2 "Info Text:" | "Click to select background colour"; "Click to select the axis colour"; "Click to select the colour for tick labels"; "Click to select satellite colour"; "Click to select colour for selected satellites"; "Click to select track colour"; "Click to select background colour" (the "Info Text:" button has this copy-paste tooltip) | `:567-729` |
| "<b>Miscellaneous:</b>" | one check box "Show the sky tracks automatically" | "Automatically show the sky track of a satellite when it comes in range. You can always turn the sky track OFF for each individual object" | `:746-775` |
| "Reset" | – | tooltips as §10 | `:786-806` |

- Colour defaults are in ER §6; they use the same `0xRRGGBBAA` encoding as §11 (`sat-cfg.c:174-180`).
- Reset covers every polar key (orientation, six content flags, seven colours, auto-track), unlike the Map page (`:972-1045`).

---

## 13. List View and Single Sat View page extras

Column titles, hints and defaults are in ER §4 and §7. Additions for the two pages (`sat-pref-list-view.c`, `sat-pref-single-sat.c`):

- Header "<b>Visible Fields:</b>" spans two grid columns. Check boxes fill a **3-column** grid row by row in enum order (index *i* at column *i* mod 3, row 1 + *i* div 3), so the order reads left to right, top to bottom, not column by column (`:32-33`, `:184-194`).
- List View page shows 27 boxes (the internal "BOLD" column is excluded); Single Sat shows all 23 fields.
- Each box's tooltip is the hint string from ER §4/§7.
- Visibility is stored as one integer bit mask, bit *i* = column *i* in the ER tables: GLOBAL-level key MODULES/LIST_COLUMNS (module: LIST/COLUMNS) and MODULES/SINGLE_SAT_FIELDS (module: SINGLE_SAT/FIELDS). By enum order the default values work out to **8454813** for the list (columns Satellite, Az, El, Dir, Range, Next Event, Alt, Orbit) and **8384739** for single-sat (derived arithmetic from `sat-cfg.c:51-88` and the enums in `gtk-sat-list.h`, `gtk-single-sat.h`).
- Cancel writes nothing on either page; the Single Sat page also clears its dirty/reset markers (`sat-pref-list-view.c:46-49`, `sat-pref-single-sat.c:46-52`).
- The module-mode list also stores SORT_COLUMN and SORT_ORDER and the single-sat view stores SELECTED, but neither has a Preferences control (ER §4, §7).

---

## 14. Defaults and config keys touched by this part

| Setting | Group/Key | Default | Cite |
|---|---|---|---|
| Local time | GLOBAL/USE_LOCAL_TIME | false | `sat-cfg.c:114` |
| N/S/E/W | GLOBAL/USE_NSEW | false | `:115` |
| Imperial | GLOBAL/USE_IMPERIAL | false | `:116` |
| Time format | GLOBAL/TIME_FORMAT | `%Y/%m/%d %H:%M:%S` | `:220` |
| Main window position / module position / module state | GLOBAL/MAIN_WIN_POS, MOD_WIN_POS, MOD_STATE | false, false, false | `:117-119` |
| Main window geometry | GLOBAL/WINDOW_POS_X, WINDOW_POS_Y, WINDOW_WIDTH, WINDOW_HEIGHT | 0, 0, 700, 700 | `:206-209` |
| Open modules / current page | GLOBAL/OPEN_MODULES, CURRENT_PAGE | "Amateur", −1 | `:222`, `:153` |
| Default ground station | GLOBAL/DEFAULT_QTH | "sample.qth" | `:221` |
| Module layout code | MODULES/GRID | `1;0;2;0;1;2;0;1;1;2;3;1;2;1;2` | `:224` |
| Module data timeout | MODULES/DATA_TIMEOUT | 300 | `:148` |
| Map file | MODULES/MAP_FILE | "nasa-bmng-07_1024.jpg" | `:225` |
| Map ground-track orbits / centre / shadow alpha | MODULES/MAP_TRACK_NUM, MAP_CENTER, MAP_SHADOW_ALPHA | 3, 0, 0xDD | `:170`, `:157`, `:171` |
| TLE auto-update freq / action / last update | TLE/AUTO_UPDATE_FREQ, AUTO_UPDATE_ACTION, LAST_UPDATE | 2 (weekly), 1 (notify), 0 | `:211-213` |
| TLE URLs / proxy / add new / last dir | TLE/URLS, PROXY, ADD_NEW_SATS, FILE_DIR | §4 list, none, true, none | `:235-247`, `:139` |
| Transponder server / files | TRSP/SERVER, FREQ_FILE, MODE_FILE, PROXY | "https://db.satnogs.org/api/", "transmitters/?format=json", "modes/?format=json", none | `:228-231` |
| Log level / clean age | LOG/LEVEL, CLEAN_AGE | 2, 0 | `:214-215` |
| Config version | VERSION/MAJOR, MINOR | 1, 4 | `:146-147` |

---

## 15. Corrections to ER and code anomalies

**Corrections to ER**

| ER | ER says | This part (code) |
|---|---|---|
| §11 Structure | The dialog opens with the title "Gpredict Preferences :: General" | The initial title is replaced before display by "GPREDICT Preferences :: General" (`sat-pref.c:165`, `:201`); **UNVERIFIED** at runtime |
| §10 | Two identical ground-station editor implementations | They differ in save timing, altitude tooltip and imperial handling (§3) |
| §11 TLE Update | "11 CelesTrak and AMSAT URLs" | Exactly 1 AMSAT + 10 CelesTrak; source 6 ends in `FORMAT=tlet` (typo) (§4) |
| §11 TLE Update | "Add new satellites to local database" → on | The check box is never saved; only the default (true) is used (§4) |
| §4 / §3 | Lat/Lon `%.2f°` + suffix if N/S/E/W is on, else signed | The suffix slot is a space when off, so there is a trailing space (§2.1) |
| §11 Message Logs | "1 month" listed as an age | It stores 18144000 s = 210 days (§7.1) |
| §11 General | Auto-check described as a start-up check | The first check runs 10 minutes after launch (§5.1) |
| §12 Log browser | (window only named) | Layout, buttons, columns and parsing in §7.3 |

**Anomalies worth reproducing or deliberately fixing**
1. Ground Stations: toggling Imperial in the open Preferences dialog renames the **"Lon"** column header to "Alt (ft)" / "Alt (m)" (it retitles column index 3, which is Lon, while Alt is index 4; `sat-pref-qth.c:967`, `:986`).
2. Ground Stations: altitudes lose up to 1 m per OK when Imperial is on (§3).
3. Default station match uses a suffix test (`sat-pref-qth.c:429`).
4. Module-config "Add" editor saves feet as metres under Imperial (§3).
5. Auto-update repeats every 10 minutes when nothing changes, because LAST_UPDATE is not refreshed (§5.1).
6. "Never" has no "warn after one week" behaviour despite the header comment.
7. Log level changes apply only after a restart (§7.1); "1 month" is 210 days; the "0 = Never clean" comment is wrong (§7.2).
8. Log browser: info counter not reset by "Clear"; messages containing a `\|` are mis-parsed (§7.3).
9. Map page Reset leaves "Solar terminator:" and "Global shadow:" colours untouched in storage (§11).
10. The Polar "Info Text:" colour button has the "background colour" tooltip (§12).
11. Local-files update rewrites a matching `.cat` category file despite the "not effective since 1.4" comment (§5.3).
12. Satellite Info shows no period, decay, orbit type or current orbit number; the transponder name is inserted into markup unescaped (§8).
13. `tle-tools.c` (`twoline2tle`, `tle2twoline`) are empty stubs that only return success and are never called (`tle-tools.c:63-111`); the TLE parsing the program uses is `sgpsdp/sgp_in.c`.
