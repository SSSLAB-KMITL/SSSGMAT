# Gpredict UI reference, part 2: pass predictions

Extension of `docs/2026-11-11-gpredict-reference.md`. It records names, labels, defaults, formats and behaviour only. No code is copied.

## Sources and conventions

- Same conventions as the main reference: commit `22593781` ("Version 2.7"), `file.c:line` means `src/file.c:line`, labels are quoted exactly as written in `_("…")` / `N_("…")`, `_` is a mnemonic, `\n` is a line break, `°` is U+00B0 (`\302\260` in the source).
- **UNVERIFIED** marks anything that could not be confirmed from the code alone. The full list is in §12.
- Nothing in this part was run. Every behaviour below is read from the code.
- Rows already in main-reference §4, §8, §11 and §12 are not repeated unless they were incomplete or wrong. Corrections to the main reference are collected in §11.
- "Module time" means the module's simulated or real time (`tmgCdnum`, set by the Time Controller). "Real time" means the system clock (`time-tools.c:50-63`).

---

## 1. Entry points: "Show current pass", "Show next pass", "Future passes"

### 1.1 Where the items appear

The list, map, polar, single-sat and event-list popups all call one helper that appends the three items (`gtk-sat-popup-common.c:30-64`; callers `gtk-sat-list-popup.c:77`, `gtk-sat-map-popup.c:90`, `gtk-polar-view-popup.c:86`, `gtk-event-list-popup.c:92`, `gtk-single-sat.c:510`).

| Item | Shown when | Cite |
|---|---|---|
| "Show current pass" | Only if the satellite's elevation is **> 0** at the moment the popup is built | `gtk-sat-popup-common.c:36-45` |
| "Show next pass" | Always | `:48-54` |
| "Future passes" | Always | `:57-63` |

- The "Show current pass" callback checks El > 0 again at click time and does **nothing at all** (no dialog) if it is no longer true (`:78-79`).
- All three callbacks receive the view's own time stamp (the module time at its last refresh) as the start time (`:76`, `:92`, `:112`).

### 1.2 What each item actually does

| Item | Behaviour | Cite |
|---|---|---|
| "Show current pass" | Calls the **same** routine as "Show next pass", with the module time. It does **not** call the "current pass" routine. Consequence: the minimum elevation filter applies. If the current pass never reaches "Minimum elevation", the dialog shows the next pass that does | `gtk-sat-popup-common.c:78-79`, `:117-178`; `predict-tools.c:413-421` |
| "Show next pass" | If El < 0: start time is the module time. If El ≥ 0 (satellite is up): start time is the satellite's stored LOS + 0.007 day (about 10.1 min after the end of the current pass) | `gtk-sat-popup-common.c:94-99` |
| "Future passes" | Start time is the module time | `:114` |

The satellite's stored LOS is the module's cached next-LOS value (`gtk-sat-module.c:657-658`, `:697-700`). If that value is 0 the start time would be about 0.007 (Julian date), which is a bad start. Whether this can happen when El ≥ 0 is **UNVERIFIED**.

### 1.3 Which time is used

| Setting | Effect | Cite |
|---|---|---|
| Preferences → Predict → Pass Conditions → check box "Always use real time for pass predictions" (key `PREDICT/USE_REAL_T0`), default **off** | **On:** "Show next pass", "Show current pass" and "Future passes" ignore the module time and the start-time rule in §1.2. They start from the real clock "now" (with microsecond fraction) | `gtk-sat-popup-common.c:126-130`, `:191-198`; `predict-tools.c:364-372`, `:390-399`; `time-tools.c:50-63`; `sat-cfg.c:141` |
| | **Off:** they start from the module time (§1.2) | `gtk-sat-popup-common.c:131-135`, `:199-205` |

- With the setting **on**, "Show next pass" on a satellite that is currently up starts from "now", so the pass found is the one **in progress** (see §3.4), not the next one.
- The same setting also controls the first drawing of Sky at a glance (§7.1).

### 1.4 Every message shown when there is no pass

All are modal GTK message dialogs, transient for the toplevel window of the view (`GTK_DIALOG_MODAL | GTK_DIALOG_DESTROY_WITH_PARENT`). Each has a single "OK" button. `%s` is the satellite nickname and `%d` is "Passes should occur within" (key `PREDICT/LOOK_AHEAD`, default 3, `sat-cfg.c:187`).

| Case | Item | Icon | Exact text | Cite |
|---|---|---|---|---|
| Satellite never has an AOS (geostationary, decayed, mean motion 0, or orbit that cannot reach the ground station's latitude, see §4.1) | "Show next pass" / "Show current pass" | Error | `Satellite %s has no passes for\nthe current ground station!\n\nThis can be because the satellite\nis geostationary, decayed or simply\nnever comes above the horizon` | `gtk-sat-popup-common.c:162-172` |
| Same | "Future passes" | Error | `Satellite %s has no passes for\nthe current ground station!` | `:236-242` |
| Satellite can rise, but no qualifying pass starts within the window | "Show next pass" / "Show current pass" | Info | `Satellite %s has no passes\nwithin the next %d days` | `:144-153` |
| Same | "Future passes" | Info | `Satellite %s has no passes\nwithin the next %d days` | `:215-224` |

- The text does not handle the singular: with 1 day it reads "within the next 1 days".
- "Satellite is not above the horizon" has **no dialog**: the "Show current pass" item is simply absent, or silently ignored (§1.1).
- No explicit window title is set on these message dialogs. What the title bar shows is **UNVERIFIED** (the code passes no title; GTK's default is an empty title).
- The decision order in both dialogs is: first the "never has AOS" check, then the prediction. A satellite flagged geostationary or decayed gets the Error dialog without any prediction being run.

### 1.5 Window titles

| Window | Title (exact) | Cite |
|---|---|---|
| Pass details | `Pass details for %s (orbit %d)` (satellite nickname, orbit number of the pass) | `sat-pass-dialogs.c:477-478` |
| Future passes | `Upcoming passes for %s` (satellite nickname) | `:1035` |
| Save one pass | `Save Pass Details` | `save-pass.c:104` |
| Save pass list | `Save Passes` | `save-pass.c:251` |
| Sky at a glance | `The sky at a glance (%s)` (module name) | `gtk-sat-module-popup.c:719` |

---

## 2. Pass details window

Opened by "Show next pass" / "Show current pass", by double-click or "Show details" on a row of the Future passes window, and by a left-click on a bar in Sky at a glance.

### 2.1 Window

- Not modal, so other windows stay usable (`sat-pass-dialogs.c:501`).
- Parent: the toplevel of the caller, with `DESTROY_WITH_PARENT` (`:483-485`). From the Future passes row popup the parent is the Future passes window, so closing that window closes its detail windows. From Sky at a glance there is no parent (`gtk-sky-glance.c:444`).
- Window icon file `gpredict-sat-list.png` (`:496`). Default size: height 300, width natural (`:517`).
- Buttons, in order: "_Print" (response 10), "_Save" (response 11), "_Close". "Close" is the default response (`:486-493`).
- Content: a notebook with three tabs. A tab label is an icon plus text (`:437-474`):

| # | Tab text | Icon | Content |
|---|---|---|---|
| 1 | "Data" | theme icon `format-justify-fill` (`format-justify-fill-symbolic` on Windows) | The table, §2.2 |
| 2 | "Polar" | `gpredict-polar-small.png` | Polar plot, §5 |
| 3 | "Az/El" | `gpredict-azel-small.png` | Az/El plot, §6 |

- There is **no header or summary text** inside the window. All identity information is in the title. Header lines (AOS/LOS times, observer) exist only in the saved text file (§8.3).
- Close, or the window close button, destroys the window and frees the pass (`:548-550`, `:857-866`).

### 2.2 "Data" tab

- A plain list with a vertical scroll bar only (horizontal scroll is disabled, `:429-431`).
- Headers are centred. There are no column tooltips, no sorting, no reordering and no row popup (grep finds none in `sat-pass-dialogs.c`).
- 19 columns exist. Hidden ones are the columns whose bit is clear in the "Single Pass" preference (key `PREDICT/SINGLE_PASS_COL`, `sat-pass-dialogs.c:289`, `:313-316`). Column order is fixed.
- The "Hint" column below is **not shown in the window**. It is the label of the check box on the Single Pass preference page (§9.3).

| # | Title (`sat-pass-dialogs.c:98-116`) | Hint (`:121-139`) | Cell text | Align | Default |
|---|---|---|---|---|---|
| 0 | "Time" | "Time" | Time format preference (default `%Y/%m/%d %H:%M:%S`), UTC or local per "Show local time instead of UTC." Text `--- N/A ---` if the value is exactly 0 (`:816-844`) | centre | on |
| 1 | "Az" | "Azimuth" | `%.2f°` (`:700-717`) | right | on |
| 2 | "El" | "Elevation" | `%.2f°` | right | on |
| 3 | "Ra" | "Right Ascension" | `%.2f°`, computed from the row's Az/El, the ground station and the row time (`:364-374`, `:869-912`). Only computed if Ra or Dec is on | right | off |
| 4 | "Dec" | "Declination" | `%.2f°`, same source | right | off |
| 5 | "Range" | "Slant Range" | `%.0f`, **no unit text**. Miles if "Use Imperial units" is on (÷ 1.609344, `gpredict-utils.h:8`) (`:720-743`) | right | on |
| 6 | "Rate" | "Range Rate" | `%.3f` (km/s, or mi/s when imperial), no unit text (`:748-771`) | right | off |
| 7 | "Lat" | "Latitude" | `%.2f°` followed by one character. With "Use N/S/E/W" on, the number is made positive and the character is `N` or `S`. With it off, the number is signed and the character is a **space** (`:640-697`) | right | off |
| 8 | "Lon" | "Longitude" | Same as Lat with `E` / `W` | right | off |
| 9 | "SSP" | "Sub-Satellite Point" | 6-character Maidenhead locator from longitude and latitude (`:377-388`) | left | off |
| 10 | "Footp" | "Footprint" | `%.0f` km (or mi), no unit text. Value is the footprint diameter, 12756.33 × acos(R/(R+alt)) (`predict-tools.c:104`) | right | on |
| 11 | "Alt" | "Altitude" | `%.0f` km (or mi), no unit text | right | off |
| 12 | "Vel" | "Velocity" | `%.3f` km/s (or mi/s), no unit text | **left** | off |
| 13 | "Dop" | "Doppler Shift @ 100MHz" | `%.0f` Hz = −100e6 × range rate / 299792.458 (`:391-396`, `:774-792`). Computed from km values, never converted to miles | right | off |
| 14 | "Loss" | "Signal Loss @ 100MHz" | `%.2f` dB = 72.4 + 20·log10(range in km) (`:399-404`, `:795-812`) | **left** | off |
| 15 | "Del" | "Signal Delay" | `%.2f` ms = range / 299.792458 (`:407-412`) | **left** | off |
| 16 | "MA" | "Mean Anomaly" | `%.2f°`. The stored value is the orbit phase on a 0–256 scale (phase × 256/360, `predict-tools.c:98-99`) but it is printed with a degree sign | right | off |
| 17 | "Phase" | "Orbit Phase" | `%.2f°`, 0–360 (`predict-tools.c:100`) | right | off |
| 18 | "Vis" | "Visibility" | One character per row: `-` / `V` / `D` / `E` (§4.6, main reference §10) (`:415-421`) | centre | off |

Default visible set: Time, Az, El, Range, Footp (`sat-cfg.c:60-65`). Row alignment is the renderer's `xalign` from `SINGLE_PASS_COL_XALIGN` (`:142-162`), overridden to right for the degree and lat/lon columns.

### 2.3 How rows are sampled

Rows come from the pass engine (§4.5), not from the window.

- Let `dt` = LOS − AOS (days).
- `step = dt / Number of entries` (key `PREDICT/NUMBER_OF_ENTRIES`, default **20**, range 10–200).
- If `step` is smaller than `Time resolution` (key `PREDICT/TIME_RESOLUTION`, default **10** s, range 1–600), `step = Time resolution`. So the step is **the larger of the two**: "Time resolution" is a minimum spacing, "Number of entries" is a target maximum count (`predict-tools.c:486`, `:519-525`).
- Rows are generated at `AOS, AOS+step, AOS+2·step, …` for as long as the time is ≤ LOS (`:546-616`).
  - When `step = dt/N`, there are **N or N+1 rows**. The row exactly at LOS exists only if floating-point accumulation lands on or before LOS. Whether it does is **UNVERIFIED**.
  - When `step = Time resolution` (passes shorter than `N × resolution`, i.e. shorter than 200 s with the defaults), the count is `floor(dt/step)+1` and the last row is normally **before** LOS.
- A typical 10-minute pass with the defaults has `step` = 30 s and 21 or 20 rows. The default "Time resolution" of 10 s is therefore rarely the effective spacing.
- Max El, TCA and the Vis letters are derived from these sampled rows only (§4.6). They are not interpolated.
- The first row is at AOS and carries the pass's orbit number and AOS azimuth (`:555-559`).

### 2.4 Buttons

| Button | Action | Cite |
|---|---|---|
| "_Print" | Starts the GTK print dialog for this pass (§8.5) | `sat-pass-dialogs.c:539-543` |
| "_Save" | Opens "Save Pass Details" (§8.1) | `:544-546` |
| "_Close" (and the window close button) | Destroys the window | `:548-550` |

---

## 3. Future passes window ("Upcoming passes for %s")

### 3.1 Window

- Content is a single scrolled list (vertical scroll only). Buttons: "_Print", "_Save", "_Close" (default). Not modal. Icon `gpredict-sat-list.png`. Default height 300 (`sat-pass-dialogs.c:1027-1073`).
- **"_Print" does nothing visible.** It logs the error "%s: PRINT not implemented" (`:1094-1097`).
- "_Save" opens "Save Passes" (§8.2). "_Close" destroys the window and frees the pass list (`:1098-1128`).

### 3.2 Columns

Defined at `sat-pass-dialogs.c:56-94`, built at `:948-973`, formatted at `:1131-1209`.

| # | Title | Hint (= Multiple Passes check-box label) | Cell text | Align | Default |
|---|---|---|---|---|---|
| 0 | "AOS" | "Acquisition of signal (AOS)" | Time format; `--- N/A ---` if 0 | centre | on |
| 1 | "TCA" | "Time of Closest Approach (TCA)" | Time format; `--- N/A ---` if 0 (happens if no sample had El > 0) | centre | off |
| 2 | "LOS" | "Loss of signal (LOS)" | Time format | centre | on |
| 3 | "Duration" | "Duration of pass" | `HH:MM:SS` as `%02d:%02d:%02d` from (LOS − AOS) × 86400, seconds truncated; `- N/A -` if exactly 0 (`:1172-1209`) | centre | on |
| 4 | "Max El" | "Maximum elevation" | `%.2f°` | right | on |
| 5 | "AOS Az" | "Azimuth at AOS" | `%.2f°` | right | on |
| 6 | "Max El Az" | "Az at max. elevation" | `%.2f°` | right | off |
| 7 | "LOS Az" | "Azimuth at LOS" | `%.2f°` | right | on |
| 8 | "Orbit" | "Orbit number" | integer, no format function | right | off |
| 9 | "Vis" | "Visibility during pass" | 3-character string, §4.6 (for example `V-E`, `-D-`, `---`) | centre | off |

- Visible-column order is the order above. Default visible: AOS, LOS, Duration, Max El, AOS Az, LOS Az (`sat-cfg.c:66-71`).
- Note the data-store column order differs from the display order (AOS Az is stored before Max El). It is invisible to the user (`:976-1006`).

### 3.3 Rows, sort, mouse

- Rows are in prediction order (time ascending). The columns are not sortable (no sort set).
- Each row remembers its index, and the pass it refers to is copied on use (`:1302-1305`).
- **Double-click (row activated, which includes Enter on a focused row):** opens the Pass details window for that pass, with the Future passes window's own parent as parent (`:1329-1366`).
- **Right-click:** first selects the row under the pointer (if at most one row is selected), then opens the popup (`:1236-1278`). Shift+F10 / the menu key opens it for the current selection (`:1221-1227`). With no selection nothing happens and an error is logged (`:1310-1315`).

### 3.4 Row popup (`pass-popup-menu.c:75-124`)

| # | Item | State | What it does |
|---|---|---|---|
| 1 | "Show details" | enabled | Opens the Pass details window for the row's pass, parent = the Future passes window (`:46-55`, `:84-89`) |
| – | separator | | `:92-93` |
| 2 | "Polar plot" | **disabled** (insensitive) | Handler is an unimplemented stub (`:58-64`, `:96-102`) |
| 3 | "Az/El plot" | **disabled** | Unimplemented stub (`:67-73`, `:105-111`) |

So "Polar plot" and "Az/El plot" can never run. The polar and Az/El plots are reachable only through the tabs of the Pass details window.

### 3.5 How many passes, and over what span

Settings (Pass Conditions page, key and default in brackets):

| Setting | Key | Default | Range |
|---|---|---|---|
| "Minimum elevation" | `PREDICT/MINIMUM_ELEV` | 5 | 1–90 |
| "Number of passes to predict" | `PREDICT/NUMBER_OF_PASSES` | 10 | 5–50 |
| "Passes should occur within" | `PREDICT/LOOK_AHEAD` | 3 days | 1–14 |

(`sat-cfg.c:185-187`; ranges `sat-pref-conditions.c:164`, `:194`, `:210`.) The algorithm is in `predict-tools.c:665-714`.

Exact semantics:

1. The list holds **at most "Number of passes to predict"** passes. (A "0" would mean 100, but the UI minimum is 5, `:673-676`.)
2. A pass **qualifies** only if its maximum **sampled** elevation is ≥ "Minimum elevation" (`:628`). Passes below it are skipped silently. AOS and LOS are still the El = 0 crossings, not the minimum-elevation crossings (§4).
3. The **first** pass must have its **AOS ≤ start + N days** (N = "Passes should occur within"). Its LOS may be later (`:509-512`).
4. Each following search starts at the previous pass's LOS + 0.014 day (about 20.2 min) and again looks ahead N days **from that new start**. The "N days" window therefore slides forward with each pass (`:682-687`; the engine measures from its own start argument, `:496`, `:509`).
5. The search **stops** when a call finds nothing, or as soon as the new start time is ≥ the original start + N days (`:692-695`).
6. Net effect: the list covers the N days, **plus at most one more pass** that begins after the end of the original window, provided the previous pass ended before the window end. This is derived from reading the code and was not run, so it is **UNVERIFIED** at run time.
7. **A pass in progress counts.** If the satellite is above the horizon at the start time, the first row is that pass, with its AOS in the past (found by stepping back, §4.4). It counts toward "Number of passes", and it is subject to the minimum elevation test over the whole pass. Exception: it is only returned if the **next** AOS after it falls inside the N-day window, otherwise the result is "no passes" (`:496-503`, `:129-146`).
8. With "Always use real time" on, the start time is the real clock, otherwise the module time (§1.3).

---

## 4. Pass-finding algorithm (behaviour)

### 4.1 Can the satellite ever rise?

`has_aos` (`orbit-tools.c:134-171`) is checked before any prediction. It is false when:

- The satellite is flagged geostationary: |mean motion − 1.0027| < 0.0002 rev/day (`:73-79`; flag set at load, `gtk-sat-data.c:262`).
- The satellite has decayed at the module time: epoch + (16.666666 − mean motion) / (10 × |drag term|) is earlier than the current time (`:95-123`).
- The mean motion is 0.
- The geometry never reaches the station: true only if (arc-cosine of R/(apogee + R) + the inclination, folded to ≤ 90° as 180° − i) is greater than |station latitude| (`:156-166`).

### 4.2 `find_aos` (`predict-tools.c:129-206`)

1. Compute the position at the start time. If the satellite never has an AOS, return "none" (0.0).
2. If El > 0 at start (a pass is in progress), jump to that pass's LOS + 0.014 day, then continue from there. If the result is before JD 0.1, return "none".
3. **Coarse phase:** while El < −1°, advance the time by 0.00035 × (|El| × (altitude/8400 + 0.46) + 2) days. The farther below the horizon, the bigger the step.
4. **Fine phase:** if |El| < **0.005°** the time is the AOS. Otherwise move the time by El × sqrt(altitude) / 530000 days (El < 0 moves forward, El > 0 moves back) and repeat.
5. If a time limit is given (limit > 0), both phases stop when the time exceeds start + limit, and the function returns "none". With limit ≤ 0 there is no bound.

### 4.3 `find_los` (`predict-tools.c:226-314`)

1. If the satellite never has an AOS, return "none".
2. If El < 0 at start, first run `find_aos` and begin 0.001 day (about 1.4 min) after it. If that is "none", return "none".
3. **Coarse phase:** while El ≥ 1°, advance by cos(El − 1°) × sqrt(altitude) / 25000 days.
4. **Fine phase:** advance by El × sqrt(altitude) / 502500 days. When |El| < **0.005°**, accept it as LOS only if El one second earlier was higher (the satellite is descending). Otherwise continue.
5. The same time-limit rule as `find_aos` applies.

### 4.4 `find_prev_aos` (`predict-tools.c:326-346`)

Used when a pass is already in progress at the start time. It steps backward in **0.0005 day (43.2 s)** until El < 0. The AOS it reports is therefore up to about 43 s earlier than the true crossing.

### 4.5 `get_pass` engine (`predict-tools.c:462-645`)

Inputs: start, look-ahead limit, minimum elevation. For the dialogs the minimum elevation is the "Minimum elevation" setting (a stored 0 would be treated as 1, `:415-418`). There is also a "no minimum" variant (minimum 0) used by `get_current_pass` (`:434-438`, `:888-941`). That variant is used by the polar view and the rotator control, not by these dialogs.

Loop per candidate:

1. LOS = `find_los(t0)`. AOS = `find_aos(t0)`.
2. If AOS > LOS, a pass is in progress. Replace AOS with `find_prev_aos(t0)`.
3. If AOS is "none", stop (no pass). If a limit is set and AOS > start + limit, stop.
4. Sample the pass (§2.3). For each sample compute position, Az, El, range, range rate, sub-satellite point, altitude, MA, phase, footprint, orbit number and visibility.
5. Pass fields:

| Field | Value |
|---|---|
| AOS, LOS | The times found in steps 1–2 |
| AOS Az | Azimuth at the first sample (t = AOS) |
| LOS Az | Azimuth computed exactly at LOS (`:621-623`) |
| Max El | Largest **sampled** El. It starts at 0 and only El greater than the running maximum updates it |
| TCA | Time of that sample. It stays 0 (shown `--- N/A ---`) if no sample had El > 0 |
| Max El Az | Azimuth at that sample |
| Duration | LOS − AOS (not stored, derived on display) |
| Orbit | See §4.7 |
| Vis | See §4.6 |

6. Accept the pass if Max El ≥ minimum elevation. Otherwise discard it, set `t0 = LOS + 0.014` day and loop.

Code observation: the running maximum is declared once outside the loop and is not reset between rejected candidates (`:473`). A rejected pass's maximum is always below the minimum elevation, so the effect on the accepted pass's Max El/TCA is nil. It is a latent bug only.

Sampling consequences: Max El and TCA are only as fine as the step (§2.3). With defaults on a 10-minute pass the step is about 30 s, so the displayed Max El can be a little under the true peak.

### 4.6 The "Vis" letters

- Each sample gets a visibility class from `get_sat_vis` (main reference §10: `-` Unknown (never), `V` Visible, `D` Daylight, `E` Eclipsed).
- The pass keeps a 3-character string, initial `---`. Position 1 becomes `V` if **any** sample is Visible. Position 2 becomes `D` if any sample is Daylight. Position 3 becomes `E` if any sample is Eclipsed (`predict-tools.c:536-539`, `:587-600`).
- Possible strings: `---`, `V--`, `-D-`, `--E`, `VD-`, `V-E`, `-DE`, `VDE`. The string is shown and saved verbatim.
- Because it is built from the samples, a short visible stretch between two samples can be missed.

### 4.7 Orbit number of a pass

It is the orbit number evaluated **at the AOS sample** (`predict-tools.c:555-559`). `predict_calc` computes orbit number as the TLE's revolution number at epoch, plus the number of whole revolutions completed since epoch. That count uses the mean motion with a drag (bstar) correction and takes the mean anomaly + argument of perigee at epoch as the starting offset (`:105-110`). For a pass in progress, it is the orbit at the (backward-found) AOS.

### 4.8 `get_passes` (`predict-tools.c:665-714`)

Repeats `get_pass`, sliding the start to the previous LOS + 0.014 day (see §3.5). Used by Future passes (limit = look-ahead days, count = "Number of passes to predict") and by Sky at a glance (§7.2).

---

## 5. Polar plot widget (Pass details → "Polar" tab, `gtk-polar-plot.c`)

Size request 200 × 200 (`:55`, `:758`). Radius `r` = (min(width, height) / 2) − 20 px; centre is the middle of the area (`:676-688`).

### 5.1 What is drawn

| Layer | Drawing | Colour | Cite |
|---|---|---|---|
| Background | Fully white, always (not the polar-view background setting) | `#FFFFFF` | `:460-462` |
| Circles | Three 1 px circles at El 0° (radius r), 30° (0.6667 r), 60° (0.333 r). El 90° is the centre | Axes colour (default `0x0F0F0F7F`) | `:475-485` |
| Cross | One horizontal and one vertical 1 px line through the centre, extending **5 px** beyond the 0° circle | Axes colour | `:487-495` |
| Cardinal labels | "N", "E", "S", "W" (translatable), each 5 px outside the 0° circle at its pole. Default orientation: N above the top, S below the bottom, E to the right, W to the left | Tick-label colour (default `0x007F00FF`) | `:497-535`, `:315-382` |
| Location name | Station name, above the top-left of the 0° circle (x = centre − r − 10, y = centre − r − 5 − text height). Only if the polar-view "QTH Info" option is on (default on) | Info-text colour (default `0x00007FFF`) | `:537-547`, `:731` |
| Cursor text | Bottom-left (x = centre − r − 10, y = centre + r + 5). Text `AZ: %.0f°  EL: %.0f°` (two spaces). Always enabled in this widget | Info-text colour | `:549-558`, `:659` |
| Sky track | One 1 px polyline through every sample | Track colour (default `0x0000FFFF`) | `:560-572` |
| Time ticks | Up to 5 labels, format `%H:%M` (UTC or local), placed beside points of the track (below) | Track colour (the source colour is still the track colour) | `:574-589` |

- The widget uses the same preferences as the polar view for orientation, axes/tick/info/track colours and the QTH-info flag (`:730-741`, `sat-cfg.c:173-180`). The satellite colour is not used for the track.
- Elevation maps linearly to radius (r at 0°, 0 at 90°). A point below 0° is placed at the centre (`:160-172`).
- There are **no "AOS"/"LOS" text marks, no satellite marker, no current-position marker and no Sun or Moon**.
- The widget can also draw a target (4 × 4 px filled square), a controller position (circle of radius 7) and a rotor position (cross-hair with arms from 4 to 14 px from the point), all in the satellite colour (`:592-635`). They are only set by the rotator control window. They are never set in the Pass details tab (`gtk-rot-ctrl.c:873-1048`).
- "Extra Az Ticks" is read but never drawn (`:732`).

### 5.2 Orientation

`azel_to_xy` (`:160-201`). Orientation is the polar-view setting (key `MODULES/POLAR_CHART_ORIENT`, default N/E/S/W). Reading order is top, right, bottom, left.

| Option | Top | Right | Bottom | Left |
|---|---|---|---|---|
| "N/E/S/W" (default) | N | E | S | W |
| "N/W/S/E" | N | W | S | E |
| "S/E/N/W" | S | E | N | W |
| "S/W/N/E" | S | W | N | E |

### 5.3 Sky track and time ticks

- The first point is placed on the rim at the **AOS azimuth** (El 0). The last point is placed on the rim at the **LOS azimuth** (El 0). They replace the first and last sample positions. Samples in between use their own Az/El (`:252-307`).
- Tick count `TRACK_TICK_NUM` is **5** in this widget (`gtk-polar-plot.h:40`). The first tick is the AOS time at the first point. Four more come at every `(samples − 2) / 4` samples (integer division), using the sample's time and position (`:268`, `:282-300`).
- Label placement: if the tick point is right of the centre the text is placed to the left of the point (text right edge 5 px before it). Otherwise the text starts 5 px right of the point. Text is centred vertically on the point (`:583-587`). After the first resize, ticks 1–4 are additionally shifted 5 px toward the centre (`:425-436`).
- Passes with fewer than 5 samples give a division by zero in the tick spacing (`:268`, `:412`). The behaviour is **UNVERIFIED**. It can happen with "Time resolution" near 600 s on a short pass.

### 5.4 Mouse

Only pointer motion is handled (`:643-671`, `:760`). The pointer position is converted to Az/El using the current orientation. If El > 0 the cursor text is updated. Otherwise it is cleared. There are no clicks, no popup and no tooltip. The text is not cleared when the pointer leaves the widget (no leave handler), so the last value stays until the pointer moves to a point with El ≤ 0.

---

## 6. Az/El plot widget (Pass details → "Az/El" tab, `gtk-azel-plot.c`)

Size request 300 × 300 (`:44`, `:554`). Margins of 40 px on all four sides: the frame spans x from 40 to width − 40 and y from 40 to height − 40 (`:45-46`, `:477-480`).

### 6.1 Axes and scales

| Axis | Scale | Cite |
|---|---|---|
| X (time) | Linear from AOS (left edge) to LOS (right edge) | `:144-172` |
| Left Y (azimuth, blue) | 0° at the bottom to `maxaz` at the top. `maxaz` is **360** if any sample has Az > 180°, otherwise **180** | `:523-538` |
| Right Y (elevation, red) | 0° at the bottom to 90° at the top | `:159-172` |

### 6.2 What is drawn (back to front)

| Layer | Drawing | Colour | Cite |
|---|---|---|---|
| Background | White | – | `:271-273` |
| Frame | 1 px black rectangle | black | `:275-280` |
| Tick marks | 5 tick positions along each side (`AZEL_PLOT_NUM_TICKS` 5, `gtk-azel-plot.h:42`), at 1/6 … 5/6 of the side. Each is 5 px long, drawn **inward** from the frame on all four sides | black | `:282-304` |
| X tick labels | `%H:%M` of the time at 1/6, 2/6, …, 5/6 of AOS→LOS, centred under the frame (5 px below) (UTC or local) | black | `:238-247`, `:317-326` |
| Az tick labels | `%.0f°` at maxaz/6 × k. For 360: 60°, 120°, 180°, 240°, 300°. For 180: 30°, 60°, 90°, 120°, 150°. Right-aligned 5 px left of the frame | blue `#0000BF` | `:249-253`, `:328-337` |
| El tick labels | `%.0f°` at 90/6 × k: 15°, 30°, 45°, 60°, 75°. 5 px right of the frame | red `#BF0000` | `:254-258`, `:339-348` |
| Legends | "Az" (blue) left of the frame top, right-aligned 7 px from the frame. "El" (red) 7 px right of the frame top | blue / red | `:351-369` |
| X legend | "UTC", or "Local Time" when "Show local time instead of UTC." is on. Centred under the frame, 5 px above the bottom edge of the widget | black | `:371-383` |
| Cursor text | Top centre of the widget, 5 px from the top. Format `T: %s, AZ: %.0f°, EL: %.0f°` with time as `%H:%M:%S`. Shown only while the pointer is strictly inside the frame | black | `:385-394`, `:448-453` |
| Az curve | 1 px polyline through every sample | blue `#0000BF` | `:399-411` |
| El curve | 1 px polyline through every sample | red `#BF0000` | `:413-425` |

- The X of the first and last **Az** points is forced to the left and right edge of the frame, so the blue curve always spans the full width. The Y of the first and last **El** points is forced to El 0 (frame bottom), but their X is not changed. The red curve therefore ends at the last sample's time, which is usually before LOS (`:221-228`).
- Az is drawn as raw values with no wrap handling, so a pass crossing North (350° → 10°) draws a near-vertical line across the plot.
- The frame is drawn as black; the Axes colour setting is loaded but not used (`:512`).
- The curve colours are fixed constants (`:513-514`).
- There are no AOS/LOS marks, no station name, no current-position marker and no AOS/LOS texts.

### 6.3 Mouse

Only motion is handled. Inside the frame, time is computed from X, and "AZ" and "EL" are both computed from the pointer's **Y** (Az scale and El scale respectively). They are not read from the curves (`:175-192`, `:430-464`). Outside the frame the text is cleared. There are no clicks, popup or tooltip.

---

## 7. Sky at a glance (`gtk-sky-glance.c`)

### 7.1 How it opens

- Module popup item "Sky at a glance" (`gtk-sat-module-popup.c:1176`; position between "Select satellite" and "Time Controller", main reference §2).
- One window per module. If it is already open, the existing window is raised and nothing else happens (`:706-715`).
- A top-level window titled **"The sky at a glance (<module name>)"**, icon `gpredict-planner.png`, border 4 px, containing the chart (`:717-749`).
- If the module has no satellites, the window content is just the label "This module has no satellites!" (`gtk-sky-glance.c:737-740`).
- Start time `T0` of the time axis:
  - "Always use real time for pass predictions" **on:** real clock "now" at the moment of creation (`gtk-sat-module-popup.c:733-735`, `gtk-sky-glance.c:759`).
  - **Off:** the module time (`gtk-sat-module-popup.c:737-740`).
- The window is destroyed with the module and its reference is cleared when closed (`gtk-sat-module.c:169-171`, `gtk-sat-module-popup.c:682-690`).

### 7.2 Which satellites and passes

- **All** satellites of the module, in the module's internal hash-table order. That order is not by name or catalog number. The exact order is **UNVERIFIED** (GLib-defined) (`gtk-sky-glance.c:793`).
- For each satellite: up to **10 passes** from `get_passes` with start = T0 and limit = the axis length in days (`:635`). The "Minimum elevation" setting applies. A pass in progress at T0 is included (§3.5). Satellites that never rise or have no pass get no row and no label.
- The same "sliding window" behaviour as in §3.5 applies, so the last pass of a satellite may start after the right edge of the chart. It is then clipped (not visible), but the satellite still uses a row and a label (the label is placed off-canvas).
- The "Number of passes to predict" and "Passes should occur within" settings are **not** used here.

### 7.3 Layout and sizing

| Item | Value | Cite |
|---|---|---|
| Axis length | "Find and show passes that occur within" hours (key `SKY_AT_GLANCE/TIME_SPAN_HOURS`, default **8**, range 1–24). The axis runs from T0 to T0 + hours | `gtk-sky-glance.c:760-761`; `sat-cfg.c:195` |
| Requested size | Width **600**. Height = N × 10 + (N + 1) × 20 + 50 px, where N is the number of satellites in the module (including ones without passes) and 50 is the footer | `:56-60`, `:764-771` |
| Resizable | Yes. On resize the plot height is (allocation − 50); the bar height `pps` = (plot height − 20) / N − 20 (integer maths) | `:464-468` |
| Rows | Satellite k with passes (0-based among satellites that have passes) sits at y = k × (pps + 20) + 20. Bar height = pps (10 px at the default size). All passes of one satellite share a row | `:497-535` |
| Bars | One rectangle per pass, x from AOS to LOS | `:501-502` |
| Font | GTK default font (`gtk-font-name`) | `:744-749` |

### 7.4 Colours

Satellite number `k` (0-based, counting **every** satellite in iteration order, including those without passes) uses colour `(k mod 10) + 1` (`:550-612`, `:631`).

| Index | Pref label | Default |
|---|---|---|
| 1 | "Satellite 1: " | `#3c46c8` |
| 2 | "Satellite 2: " | `#00500a` |
| 3 | "Satellite 3: " | `#d5472b` |
| 4 | "Satellite 4: " | `#d06b38` |
| 5 | "Satellite 5: " | `#cf477a` |
| 6 | "Satellite 6: " | `#bf041f` |
| 7 | "Satellite 7: " | `#688522` |
| 8 | "Satellite 8: " | `#0420bf` |
| 9 | "Satellite 9: " | `#a304bf` |
| 10 | "Satellite 10: " | `#04bdbf` |

(`sat-cfg.c:196-205`.) Each pass box has a 1 px **opaque** border in the colour and a fill in the same colour at alpha 0xA0 (160/255, about 63%) (`:607-611`, `:276-287`). The satellite name label is drawn in the opaque colour.

### 7.5 What is drawn (`on_draw`, `:245-390`)

1. **Plot background:** white rectangle over (0, 0, width, plot height).
2. **Pass boxes** as above. There are **no texts, AOS/LOS marks, max-El marks or Vis marks** on the bars.
3. **Satellite labels:** the nickname, vertically centred on the row. Position is decided from that satellite's **first** pass:
   - If the first pass's left edge is more than 100 px from the left edge of the plot, the label's right edge is 5 px **left** of the bar.
   - Otherwise the label starts 5 px **right** of the bar's right edge (`:503-527`).
4. **Cursor line:** while the pointer has moved over the chart, a vertical line spans the plot height at the pointer's x, 0.5 px wide, black at 70% opacity. It is drawn only while the pointer x is strictly inside the plot width (`:313-320`).
5. **Cursor time label:** at the top of the plot, text `%H:%M` of the time under the pointer (UTC or local), same colour as the cursor line. It sits 5 px to the right of the line, or to the **left** of the line when the line is in the right half of the plot (x > width/2) (`:322-335`, `:392-413`).
6. **Footer:** a dark navy rectangle (RGB 0, 0, 0.25), 50 px high, directly under the plot, full width (`:338-341`).
7. **Hour ticks:** white, 1 px. For each of the `hours` ticks (the first at the first whole hour at or after T0, plus a 60 s offset, then every 1/24 day): a **major** tick 10 px long below the plot, with the label (two-digit hour `%H`, UTC or local) centred 12 px below the plot. A **minor** tick (5 px long) sits 30 minutes before the major tick, or 30 minutes after it if the major tick is less than 30 minutes after T0 (`:343-373`, `:689-721`). Ticks that fall right of the plot are clipped, so with an axis of N hours about N or N − 1 labels are visible (the first whole hour is after T0). Ticks sit on whole **UTC** hours even in local-time mode, so in a half-hour time zone the labels are not on the hour (derived from the code).
8. **Axis caption:** centred horizontally, near the bottom of the footer (5 px above the bottom): **"TIME"** when "Show local time instead of UTC." is on, **"UTC"** otherwise (`:375-384`).

### 7.6 Mouse and tooltips

- **Pointer motion** updates the cursor line and time label. There is no leave handler, so the line stays where the pointer left (`:392-413`, `:772-781`).
- **Left-button release on a bar:** opens the Pass details window for that pass (a copy of the pass), titled "Pass details for <sat> (orbit N)" (§2). It has no parent window (`:415-447`). Hit testing uses the bar rectangles, first match in creation order (`:226-243`).
- Other buttons, and left-click on empty space, do nothing (`:424-429`). **No popup menu.**
- **No tooltips.** The canvas is flagged as "has tooltip", but there is no tooltip handler (`:770`, grep finds none). So nothing is shown (the exact GTK behaviour is **UNVERIFIED**).

### 7.7 Refresh

The module rebuilds the whole chart (it throws the widget away and creates a new one) from the module's main timeout, which runs once per "Refresh data every" interval (default 300 ms) (`gtk-sat-module.c:520-540`, `:815-817`):

- When the module time differs from the time the chart was last built by more than 7.0e-4 day (about 60.5 s, in either direction), **or**
- when the ground station has moved more than 1 km from where it was at the last build.
- The rebuilt chart always starts at the **module time**, even if "Always use real time" is on. The first drawing may use real time (§7.1).
- On creation only the time of the last build is stored, not the position (`gtk-sat-module-popup.c:743`). The position starts zeroed. It looks as if the first module tick after opening the window would rebuild the chart immediately (distance to latitude 0 / longitude 0 is more than 1 km for almost any station). That is **UNVERIFIED** at run time.
- Closing the window stops the refreshes.

---

## 8. Save and Print

### 8.1 "Save Pass Details" (one pass, from the Pass details window)

`save-pass.c:82-212`. Modal, parent is the Pass details window. Buttons: "_Cancel" and "_Save" (default; reject / accept).

Layout is a two-column grid with 10 px spacing and a 10 px border:

| Row | Label | Control | Default / behaviour |
|---|---|---|---|
| 0 | "Save in folder:" | Folder chooser button; chooser title "Select a folder" | The last used folder (key `PREDICT/SAVE_DIR`, unset by default, `sat-cfg.c:248`), else the user's home directory (`:117-137`) |
| 1 | "Save using file name:" | Text entry, maximum 100 characters | `<satellite>-<orbit>`. In it, spaces become `-`, and any of `!?/\()*&%$#@[]{}=+<>,.|:;` become `_` (`:150-156`). While editing, only ASCII letters, digits, `-` and `_` are allowed. Other characters are deleted with a beep (`gpredict-utils.c:509-514`, `save-pass.c:365-388`). "Save" is disabled while the entry is empty (`:390-402`) |
| 2 | "File contents:" | Combo with three entries | "Info+header+data" / "Header + data" / "Data only". The default is the last used choice (key `PREDICT/SAVE_CONTENTS`, default 0 = "Info+header+data") (`:159-173`) |

- There is **no file-type choice**. The only format is plain text, and ".txt" is appended to the name automatically (`:65`, `:532-535`). The stored `PREDICT/SAVE_FORMAT` key (default 0) is not offered in the UI.
- On "Save": the file is written to `<folder>/<name>.txt`, **overwriting without confirmation**. The folder and the contents choice are remembered (`:185-203`).
- Errors show a modal Error dialog with a "Close" button. Texts: `Could not create file %s\n\n%s` and `An error occurred while saving data to %s\n\n%s` (filename, system message) (`:599-657`). There is no success message.
- What each content choice writes: "Info+header+data" = page header (§8.3) + table header + rows. "Header + data" = table header + rows. "Data only" = rows (`:545-578`).
- The rows use the "Single Pass" visible-column setting (`:537`).

### 8.2 "Save Passes" (pass list, from the Future passes window)

`save-pass.c:229-352`. Same layout as 8.1 with these differences:

| Item | Value |
|---|---|
| Title | "Save Passes" |
| Default file name | `<satellite>-passes` (same character replacement) |
| "File contents:" combo | "Complete report" / "Summary". Always starts on "Complete report". Not remembered |
| What is saved | Summary = page header + table header + one line per pass. Complete report = the summary **plus**, for every pass, a block (below) |
| Remembered | Folder only |

Complete-report block, appended for each pass in order (`save-pass.c:463-480`): an empty line, then ` Orbit <n>`, then that pass's table header and sample rows, which use the Single Pass columns (so each block is §8.3's table). The summary table uses the Multiple Passes columns (`:448`).

### 8.3 Text layout: one pass

Implementation in `pass-to-txt.c`. Numbers are never unit-converted (always km, km/s), lat/lon are always signed degrees without N/S/E/W or degree signs, and times use the Time format preference.

**Page header** (`pass_to_txt_pgheader`, `:116-182`), five lines:

```
Pass details for <sat> (orbit <n>)
Observer: <station name>, <station location>
LAT:<lat %.2f> LON:<lon %.2f>
AOS: <time> <UTC|Local>
LOS: <time> <UTC|Local>
```

The labels are the literal strings `Pass details for %s (orbit %d)`, `Observer: %s, %s`, `LAT:%.2f LON:%.2f`, `AOS: %s %s`, `LOS: %s %s`. The trailing word is "UTC", or "Local" if "Show local time instead of UTC." is on (the times are then local). The lat/lon are the station values as stored. The station location is the ground station's "Location" field.

**Table header** (`:184-233`): three lines, a separator, the title line and a separator. The separator is a run of `-` as long as the whole title line.

- The "Time" column is **always** present. The title is " Time" followed by (length of the formatted AOS time − 4) spaces. So the column is that length + 1 characters wide, matching the data lines that start with one space.
- For each enabled column (flag bit set), a space and the column title are appended.

| Column | Title (literal, with padding) | Width | Data format (preceded by one space) |
|---|---|---|---|
| Time | ` Time` + padding | time length + 1 | one space + time string |
| Az | `  Az  ` | 6 | `%6.2f` |
| El | `   El ` | 6 | `%6.2f` |
| Ra | `  Ra  ` | 6 | `%6.2f` |
| Dec | `  Dec ` | 6 | `%6.2f` |
| Range | `Range` | 5 | `%5.0f` |
| Rate | ` Rate ` | 6 | `%6.3f` |
| Lat | `  Lat ` | 6 | `%6.2f` |
| Lon | `  Lon  ` | 7 | `%7.2f` |
| SSP | ` SSP  ` | 6 | 6-character locator |
| Footp | `Footp` | 5 | `%5.0f` |
| Alt | ` Alt ` | 5 | `%5.0f` |
| Vel | ` Vel ` | 5 | `%5.3f` |
| Dop | ` Dop ` | 5 | `%5.0f` |
| Loss | ` Loss ` | 6 | `%6.2f` |
| Del | ` Del ` | 5 | `%5.2f` |
| MA | `  MA  ` | 6 | `%6.2f` |
| Phase | ` Pha  ` | 6 | `%6.2f` |
| Vis | `Vis` | 3 | two spaces then the single character (`-`, `V`, `D`, `E`) |

(`SPCT` `:39-59`, `COLW` `:62-82`, data `:235-458`.) Column order is fixed as in the table. Titles differ from the window: "Phase" is "Pha". If the locator cannot be computed the SSP column is skipped without padding. Separator length = (time length + 1) + Σ(width + 1).

Example, default columns, default time format (the lines are exactly as produced):

```
----------------------------------------------
 Time                  Az      El  Range Footp
----------------------------------------------
 2026/11/12 10:00:00 123.45  12.34  1234  4567
```

### 8.4 Text layout: pass list

**Page header** (`passes_to_txt_pgheader`, `:461-478`), three lines:

```
Upcoming passes for <sat>
Observer: <station name>, <station location>
LAT:<lat %.2f> LON:<lon %.2f>
```

**Table header** (`:480-533`):

- The AOS, TCA and LOS columns are **always** present, regardless of the visible-column setting (the TCA flag is ignored).
- Titles: ` AOS`, `  TCA`, `  LOS`, each followed by (length of the formatted time − 3) spaces.
- Then for each enabled column among Duration … Vis: two spaces and the title.

| Column | Title | Width | Row format (preceded by two spaces) |
|---|---|---|---|
| AOS | ` AOS` + padding | time + 1 | one space + time |
| TCA | `  TCA` + padding | time + 2 | time |
| LOS | `  LOS` + padding | time + 2 | time |
| Duration | `Duration` | 8 | `%02d:%02d:%02d` |
| Max El | `Max El` | 6 | `%6.2f` |
| AOS Az | `AOS Az` | 6 | `%6.2f` |
| Max El Az | `Max El Az` | 9 | `%9.2f` |
| LOS Az | `LOS Az` | 6 | `%6.2f` |
| Orbit | `Orbit` | 5 | `%5d` |
| Vis | `Vis` | 3 | the 3-character Vis string |

(`MPCT` `:85-96`, `MCW` `:99-110`, rows `:535-678`.) The separator is 3 × (time length + 2) + Σ(width + 2) dashes. That is one character longer than the title line.

Example, default columns, default time format:

```
-------------------------------------------------------------------------------------------------
 AOS                  TCA                  LOS                  Duration  Max El  AOS Az  LOS Az
-------------------------------------------------------------------------------------------------
 2026/11/12 10:00:00  2026/11/12 10:05:00  2026/11/12 10:10:00  00:10:00   45.67   12.34  200.00
```

Rows end with a newline. The page-header lines have no blank line after them.

### 8.5 Print

- Only the **single pass** can be printed ("_Print" in the Pass details window). In the Future passes window the button logs "PRINT not implemented" and does nothing (`sat-pass-dialogs.c:1094-1097`, `print-pass.c:176-181`).
- It opens the standard GTK print dialog (`print-pass.c:142-143`). On failure a Close-only Error dialog shows the error message.
- Content: **the table header and the rows from §8.3 only** (the separator, title, separator, then rows) split into lines. The 5-line page header from §8.3 is not printed. The visible-column setting is the Single Pass one (`:126-134`).
- Page layout (`:42-43`, `:220-297`):
  - A header band at the top: 10 mm high, filled light grey (0.8), black 1 px outline.
  - Inside it: the text `Pass details for %s (orbit %d)` centred in "sans 14" (start-ellipsised if too wide), and the page counter `n/N` right-aligned 4 px from the right edge.
  - 3 mm gap, then the body in "monospace" 12 pt, one table line per 12 pt of height.
  - Pagination: as many lines per page as fit, then more pages.
- The doc comment in the code mentions a polar and an Az/El plot on the printout. Those are **not implemented**.

---

## 9. Preferences → Predict (`sat-pref-predict.c`)

Four notebook tabs, in this order: "Pass Conditions", "Multiple Passes", "Single Pass", "Sky at a Glance" (`sat-pref-predict.c:54-65`). The page itself has a "Reset" button at the bottom right on each tab. Its tooltip is "Reset settings to the default values." on all four.

### 9.1 Pass Conditions (`sat-pref-conditions.c`)

Grid rows, with separators between groups (`:160-330`):

| Row | Label / control | Range | Unit label | Default | Tooltip |
|---|---|---|---|---|---|
| 0 | "Minimum elevation" spin | 1–90, step 1, 0 digits, no wrap | "[deg]" | 5 | `Elevation threshold for passes.\nPasses with maximum elevation below this limit will be omitted` |
| 2 | header "<b>Multiple Passes:</b>" | | | | |
| 3 | "Number of passes to predict" spin | 5–50 | none | 10 | `The maximum number of passes to predict.` |
| 4 | "Passes should occur within" spin | 1–14 | "[days]" | 3 | `Only passes that occur within the specified number of days will be shown.` |
| 6 | header "<b>Pass Details:</b>" | | | | |
| 7 | "Time resolution" spin | 1–600 | "[sec]" | 10 | `Gpredict will try to show the pass details with the specified time resolution.` |
| 8 | "Number of entries" spin | 10–200 | none | 20 | `Gpredict will try to keep the number of rows in the detailed prediction within this limit.` |
| 10 | header "<b>Satellite Visibility:</b>" | | | | |
| 11 | "Twilight threshold" spin | −18…0 | "[deg]" | −6 | `Satellites are only considered visible if the elevation of the Sun is below the specified threshold.` then three lines `  • Astronomical: -18° to -12°`, `  • Nautical: -12° to -6°`, `  • Civil: -6° to 0°` |
| 13 | Check box "Always use real time for pass predictions" | on/off | | off | `Check this box if you want Gpredict to always use the current (real) time as starting time when predicting future satellite passes.` blank line `If you leave the box unchecked and the time controller is active, Gpredict will use the time from the time controller as starting time for predicting satellite passes.` |

- Spin buttons are numeric-only integers. Row 13 is the only check box. Rows 1, 5, 9 and 12 are horizontal separators.
- The twilight tooltip uses `•` (U+2022) bullets with two leading spaces and `°` signs, exactly as written in `:290-296`.
- Real behaviour of "Time resolution" and "Number of entries": see §2.3. Both tooltips understate that "resolution" is only a minimum step.

**Apply/Reset behaviour (all four pages share it):**

- Changing any control marks the page dirty. "OK" in the Preferences dialog then writes all values of the page. "Cancel" discards them (`:41-87`, `:89-95`).
- "Reset" puts the default values into the controls at once. It also marks "reset requested" and clears "dirty". Pressing "OK" then **deletes the stored keys** so that the defaults apply, rather than writing the values (`:97-126`, `:75-86`; key removal at `sat-cfg.c:479-493`, `:710-724`). "Cancel" leaves the config unchanged.
- If a control is changed **after** pressing Reset, the page is dirty again and "OK" writes the control values.
- On this page, Reset also resets "Always use real time…" and "Twilight threshold".

### 9.2 Multiple Passes (`sat-pref-multi-pass.c`)

- Header "<b>Visible Columns:</b>" spanning two columns (`:127-131`).
- Ten check boxes in a grid of **2 columns**, filled row by row (`:30-31`, `:136-147`). The labels are the hints:

| Row | Left | Right |
|---|---|---|
| 1 | Acquisition of signal (AOS) | Time of Closest Approach (TCA) |
| 2 | Loss of signal (LOS) | Duration of pass |
| 3 | Maximum elevation | Azimuth at AOS |
| 4 | Az at max. elevation | Azimuth at LOS |
| 5 | Orbit number | Visibility during pass |

- Default on: AOS, LOS, Duration, Max El, AOS Az, LOS Az.
- No tooltips on the check boxes.
- Changing a box sets "dirty" only if the flag word differs from its value when the page was opened (`:64-73`). Reset behaves as in §9.1.

### 9.3 Single Pass (`sat-pref-single-pass.c`)

- Same header "<b>Visible Columns:</b>". Nineteen check boxes in **3 columns**, filled row by row, with a 20 px border (`:30-31`, `:125-149`):

| Row | Col 1 | Col 2 | Col 3 |
|---|---|---|---|
| 1 | Time | Azimuth | Elevation |
| 2 | Right Ascension | Declination | Slant Range |
| 3 | Range Rate | Latitude | Longitude |
| 4 | Sub-Satellite Point | Footprint | Altitude |
| 5 | Velocity | Doppler Shift @ 100MHz | Signal Loss @ 100MHz |
| 6 | Signal Delay | Mean Anomaly | Orbit Phase |
| 7 | Visibility | | |

- Default on: Time, Azimuth, Elevation, Slant Range, Footprint.
- **Code bug in Reset:** the Reset handler visually updates only the first **10** check boxes (the loop is bounded by the multi-pass column count, `:89`). Boxes 11–19 (Footprint, Altitude, Velocity, Doppler, Loss, Delay, Mean Anomaly, Phase, Visibility) keep their on-screen state. The stored flag word is still set to the defaults, so after "OK" the saved config holds the defaults regardless of what those boxes show.

### 9.4 Sky at a Glance (`sat-pref-sky-at-glance.c`)

Grid with homogeneous columns, 5 px spacing (`:258-262`). The page has these rows:

| Row | Content |
|---|---|
| 0 | "<b>Time:</b>" |
| 1 | Label "Find and show passes that occur within", spin 1–24 (default 8, no wrap), label "hours". Spin tooltip: `The passes shown on the Sky at a Glance chart\nwill begin within this number of hours.` |
| 2 | Separator |
| 3 | "<b>Colours:</b>" |
| 4–8 | Left pair: "Satellite 1: " … "Satellite 5: " (right-aligned labels), each with a colour button. Right pair: "Satellite 6: " … "Satellite 10: " |

- Colour buttons have no alpha channel. Tooltip on each is `Click to select a colour`. The chooser titles are "Select colour 1" … "Select colour 10" (`:307`, etc.).
- **Code bug:** the title for button 2 is set on button 1 (`:321`). So the chooser opened from "Satellite 1" is titled "Select colour 2", and button 2's chooser keeps GTK's default title.
- Colours are stored as 24-bit RGB (no alpha). Defaults are in §7.4.
- Reset sets the spin and all ten colours to defaults. Rules are as in §9.1.

---

## 10. Quick facts: defaults used by the pass features

| Setting | Key | Default | Cite |
|---|---|---|---|
| Minimum elevation | `PREDICT/MINIMUM_ELEV` | 5 | `sat-cfg.c:185` |
| Number of passes | `PREDICT/NUMBER_OF_PASSES` | 10 | `:186` |
| Look-ahead days | `PREDICT/LOOK_AHEAD` | 3 | `:187` |
| Time resolution (s) | `PREDICT/TIME_RESOLUTION` | 10 | `:188` |
| Number of entries | `PREDICT/NUMBER_OF_ENTRIES` | 20 | `:189` |
| Single pass columns | `PREDICT/SINGLE_PASS_COL` | Time, Az, El, Range, Footp | `:190`, `:60-65` |
| Multiple pass columns | `PREDICT/MULTI_PASS_COL` | AOS, LOS, Duration, Max El, AOS Az, LOS Az | `:191`, `:66-71` |
| Last save contents | `PREDICT/SAVE_CONTENTS` | 0 | `:193` |
| Last save format (unused in UI) | `PREDICT/SAVE_FORMAT` | 0 | `:192` |
| Last save folder | `PREDICT/SAVE_DIR` | unset | `:248` |
| Twilight threshold | `PREDICT/TWILIGHT_THRESHOLD` | −6 | `:194` |
| Real time for predictions | `PREDICT/USE_REAL_T0` | off | `:141` |
| Sky at a glance hours | `SKY_AT_GLANCE/TIME_SPAN_HOURS` | 8 | `:195` |
| Sky at a glance colours | `SKY_AT_GLANCE/COLOUR_01…10` | §7.4 | `:196-205` |

---

## 11. Corrections and additions to the main reference

| Main reference | This part says |
|---|---|
| §12 row "Future passes": row popup items "Show details", "Polar plot", "Az/El plot" | "Polar plot" and "Az/El plot" are present but **disabled and unimplemented** (`pass-popup-menu.c:58-73`, `:102`, `:111`) |
| §12 row "Next / current pass details": "Print / Save / Close" | In the Future passes window "Print" does nothing. The Pass details "Print" prints only the table (§8.5) |
| §6 polar view: 4 time ticks | That is the module polar **view** (`gtk-polar-view.h:16`). The pass-details polar **plot** has 5 (`gtk-polar-plot.h:40`) |
| §6 polar view: cursor `AZ: %.0f°   EL: %.0f°` | The pass-details polar plot uses two spaces (`gtk-polar-plot.c:659`) |
| §4 / §7 "MA … `%.2f°`" | The value is orbit phase on a 0–256 scale (`predict-tools.c:98-99`), shown with a degree sign in the pass tables |
| §12 "Sky at a glance … Time axis labelled 'TIME' or 'UTC'" | "TIME" is shown when **local** time is selected, "UTC" otherwise (`gtk-sky-glance.c:377-379`) |
| §11 "Single Pass … in three columns" | Correct. Reset only restores the first 10 boxes visually (§9.3) |

Other findings:

- "Show current pass" runs the ordinary next-pass search (§1.2).
- The "Future passes" window can contain one pass beyond the look-ahead window (§3.5).
- The pass dialogs and the pass-details plots use fixed white backgrounds, not the polar-view colours.

---

## 12. UNVERIFIED items

1. Title-bar text of the plain message dialogs in §1.4. No title is set in code.
2. Whether the last row of the Data tab is exactly at LOS (floating-point accumulation, §2.3).
3. Whether the "one pass beyond the window" in §3.5 / §7.2 occurs in practice. It is derived from reading the code.
4. Behaviour of the polar-plot time ticks for passes with fewer than 5 samples (§5.3).
5. Satellite row order and colour assignment order in Sky at a glance (GLib hash-table iteration order, §7.2).
6. Whether Sky at a glance rebuilds immediately after opening because its stored position starts zeroed (§7.7).
7. Whether a missing sky-at-glance tooltip really shows nothing in GTK (§7.6).
8. What happens in "Show next pass" if the satellite is up but its stored LOS is 0 (§1.2).
9. Letter case of the SSP locator (`longlat2locator` output was not inspected).
10. Output of the GTK print job (page breaks, fonts) beyond what the code specifies (§8.5).
