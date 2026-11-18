# Gpredict UI reference, part 3: radio control, antenna (rotator) control, interfaces and transponders

Extends `docs/2026-11-11-gpredict-reference.md` (main reference). That document already records the popup items "Radio Control" / "Antenna Control" (§2), the Interfaces rows of the Preferences table (§11) and the feature inventory (§12). This part goes into the windows, their behaviour towards hamlib, the editors, the config files and the transponder data. It records names, labels, defaults, formats and behaviour only. No code is copied.

## Sources and conventions

- **Code (authoritative):** `csete/gpredict` commit `2259378` ("Version 2.7"). Every citation is `file.c:line` under `src/`.
- Labels are quoted exactly as written inside `_("…")` / `N_("…")`. Strings that are *not* wrapped for translation are marked "(not translatable)".
- In the editor dialogs, `_` marks the keyboard mnemonic (`_Clear` shows as "Clear" with Alt+C).
- `\n` is a line break. `°` is U+00B0 (`\302\260`). `Δ` is U+0394 (`\316\224`). `↑` / `↓` are U+2191 / U+2193. `→` is U+2192. `▴` / `▾` are U+25B4 / U+25BE.
- In protocol strings, `⏎` stands for the single byte 0x0A that ends every command. Spaces are shown literally.
- **UNVERIFIED** marks anything that could not be confirmed in the code (usually runtime behaviour of GTK or hamlib).
- "Log only" means the message goes to the message log (File → Log browser) and nothing is shown in the window. Neither controller window has a status line.
- `USER_CONF_DIR` is `$XDG_CONFIG_HOME/Gpredict` on Unix, `%HOME%\Gpredict` on Windows, `~/Library/Application Support/Gpredict` on the macOS-integration build (`compat.c:245-265`). `hwconf` and `trsp` are sub-directories of it (`compat.c:294-317`).

---

## 1. Opening the controllers and module interactions

| Topic | Behaviour | Cite |
|---|---|---|
| Menu items | Module popup "Radio Control" and "Antenna Control" (main reference §2) | `gtk-sat-module-popup.c:1191`, `:1196` |
| One window per module | If the controller window for this module is already open, it is brought to the front instead of opening a second one | `gtk-sat-module-popup.c:795-800`, `:874-879` |
| Precondition: radio | The window opens only if `USER_CONF_DIR/hwconf` contains at least one `*.rig` file. The file is **not** parsed for this test | `gtk-rig-ctrl.c:627-660`, `:3225-3226` |
| Precondition: rotator | Same with at least one `*.rot` file | `gtk-rot-ctrl.c:1549-1586`, `:1685-1686` |
| No radio configured | Modal error box, window title "ERROR", one OK button: "You have no radio configuration!\nPlease configure a radio first." | `gtk-sat-module-popup.c:809-818` |
| No rotator configured | Same with "You have no rotator configuration!\nPlease configure an antenna rotator first." | `gtk-sat-module-popup.c:888-898` |
| Radio window | Top-level window titled "Gpredict Radio Control: %s" (module name), icon `gpredict-oscilloscope.png` | `gtk-sat-module-popup.c:824-835` |
| Rotator window | Top-level window titled "Gpredict Rotator Control: %s", icon `gpredict-antenna.png` | `gtk-sat-module-popup.c:904-915` |
| Closing a window | The close button closes it normally (the delete handler returns FALSE). The module forgets the window | `gtk-sat-module-popup.c:665-672`, `:772-780`, `:851-859` |
| Configure blocked | While either controller window of the module is open, "Configure" shows a modal error box with an OK button and **no title**: "A module can not be configured while the radio or rotator controller is active.\n\nPlease close the radio and rotator controllers and try again." The box has no parent window | `gtk-sat-module-popup.c:59-74` |
| Closing the module | Destroys both controller windows (radio disengages and saves, see §3.1) | `gtk-sat-module.c:158-166` |
| Module tick | On every module refresh the module calls the radio and rotator "update" with the module time (real or simulated). This refreshes the target read-outs and the Doppler values | `gtk-sat-module.c:805-809` |
| Satellite selection | When the module target changes ("Select satellite", map/list click, or Autotrack), both controllers switch their satellite combo to that satellite | `gtk-sat-module.c:1508-1513`, `:124-130` |
| Initial target | Both controllers start with the module target if one is set, otherwise with the first satellite in name order | `gtk-rig-ctrl.c:3234`, `:3262-3263`; `gtk-rot-ctrl.c:1693`, `:1737-1738` |

The controllers select the combo entry by its position in the full, unfiltered satellite list (`gtk-rig-ctrl.c:391-411`, `gtk-rot-ctrl.c:618-635`). If the user has typed a filter, the position no longer matches. This is a code observation.

## 2. Radio Control window: widgets (`gtk-rig-ctrl.c`)

### 2.1 Layout

A grid with 5 px spacing and a 10 px border (`:3246-3249`):

| Grid cell | Content | Cite |
|---|---|---|
| row 0, col 0 | "Downlink" frame (§2.2) | `:3250` |
| row 0, col 1 | "Uplink" frame (§2.2) | `:3252` |
| row 1, col 0 | "Satellite" frame (§2.4) | `:3254` |
| row 1, col 1 | "Settings" frame (§2.5) | `:3256` |
| row 2, cols 0–1 | Count-down frame (§2.6) | `:3257-3258` |

### 2.2 Downlink and Uplink frames

Both frames are built the same way. The frame label is bold and centred: "<b> Downlink </b>" (`:449-452`) and "<b> Uplink </b>" (`:516-519`). Inner border 10 px (`:455`, `:522`). Top to bottom:

| Row | Widget | Label / initial value | Tooltip | Cite (down / up) |
|---|---|---|---|---|
| 1 | Satellite frequency knob, **active** (arrows and mouse, §2.3) | starts at 145 890 000 Hz | per digit, see §2.3 | `:460-463` / `:527-530` |
| 2 left | Label + value | "Doppler:" then "---- Hz" | "The Doppler shift according to the range rate and the currently selected downlink frequency" (the Uplink frame uses the same text, including the word "downlink") | `:466-475` / `:533-542` |
| 2 right | Label + value, packed at the right edge | "LO:" then "0 MHz" | – | `:478-483` / `:545-550` |
| 3 | Label + radio frequency knob, **passive** (digits only) | "<span size='large'><b>Radio:</b></span>" (not translatable), then a knob starting at 145 890 000 Hz | – | `:486-492` / `:553-559` |

Read-out formats:
- Doppler: `%.0f Hz`, refreshed on every module tick (`:309`, `:316`).
- LO: `%.0f MHz` (translatable format), whole MHz, set when a device is selected (`:864`, `:870`, `:923`, `:947`, `:982`).

### 2.3 Frequency knob (`gtk-freq-knob.c`)

| Aspect | Behaviour | Cite |
|---|---|---|
| Digits | 10 digits from `%10.0f` of the absolute value. Leading zeros become blanks. Each digit is an xx-large label | `gtk-freq-knob.c:35`, `:73-93` |
| Grid columns | Digit 0 (GHz) in column 0, column 1 empty, digits 1–3 in columns 2–4, a separator in column 5, digits 4–6 in columns 6–8, a separator in column 9, digits 7–9 in columns 10–12, then " Hz" in column 13. So there is **no separator between the GHz digit and the hundreds-of-MHz digit**, e.g. `1435,000,000 Hz` and ` 145,890,000 Hz` | `gtk-freq-knob.c:38`, `:374-401` |
| Separator text | The locale's thousands separator. In a locale with an empty separator (e.g. C) the separator labels are empty. "." is used only if the markup buffer cannot be allocated | `gtk-freq-knob.c:304`, `:375-386`; `compat.c:394-406` |
| Arrow buttons (active knob only) | A flat "▴" button above and a flat "▾" button below each digit. Step = 10^(9−digit index), i.e. 1 GHz … 1 Hz. A step that would leave the range is ignored | `gtk-freq-knob.c:344-370`, `:95-114` |
| Mouse on a digit (active knob only) | Left click +step, right click −step, middle click nothing. Wheel up or right +step, wheel down or left −step. Out-of-range results are ignored (value unchanged) | `gtk-freq-knob.c:143-250`, `:252-259` |
| Digit tooltip (active knob only) | "Use mouse buttons and wheel to change value" | `gtk-freq-knob.c:327-329` |
| Range | 0 … 9 999 999 999 Hz | `gtk-freq-knob.c:65-71` |
| Change signal | Every user action emits "freq-changed", even an arrow click that was ignored. Values set by the program do not emit it | `gtk-freq-knob.c:110-113`, `:163`, `:174`, `:252-259` |

### 2.4 "Satellite" frame

A grid with a 5 px border and 5 px spacing. The frame label is plain text "Satellite" (`:1094-1097`, `:1219`).

| Row | Col 0–2 | Col 3 | Cite |
|---|---|---|---|
| 0 | Search entry, placeholder "Filter..." | – | `:1100-1105` |
| 1 | Satellite combo (module satellites by nickname, name-sorted), tooltip "Select target object" | Toggle "Track", tooltip "Track the satellite transponder.\nEnabling this button will apply Doppler correction to the frequency of the radio." | `:1108-1131` |
| 2 | Transponder combo, tooltip "Select a transponder". Entries are the transponder names, shown at most 30 characters wide and ellipsized at the end | Buttons "T" and "L" side by side (see below) | `:1134-1171`, `:613-621` |
| 3 | "Az:" + value (cols 0–1); " Range:" + value (cols 2–3) | | `:1174-1202` |
| 4 | "El:" + value (cols 0–1); " Rate:" + value (cols 2–3) | | `:1182-1217` |

- **"T" (button):** tooltip "Tune the radio to this transponder. The uplink and downlink will be set to the center of the transponder passband. In case of beacons, only the downlink will be tuned to the beacon frequency." (`:1142-1149`)
- **"L" (toggle):** tooltip "Lock the uplink and the downlink to each other. Whenever you change the downlink (in the controller or on the dial, the uplink will track it according to whether the transponder is inverting or not. Similarly, if you change the uplink the downlink will track it automatically.\n\nIf the downlink and uplink are initially out of sync when you enable this function, the current downlink frequency will be used as baseline for setting the new uplink frequency." (`:1151-1165`)
- **Tooltips on Range and Rate** (on both the label and the value): "This is the current distance between the satellite and the observer." (`:1197-1202`) and "The rate of change for the distance between the satellite and the observer." (`:1212-1217`).
- **Filter:** it matches the nickname as a case-insensitive substring. The combo is refilled and the first match is selected (`:1040-1082`).

| Read-out | Format | Initial | Cite |
|---|---|---|---|
| Az / El | `%7.2f°` | "   0.00°" | `:67`, `:274-279`, `:1092` |
| Range | `%.0f km`, or `%.0f mi` with Imperial units | "0 km" | `:283-292`, `:1193` |
| Rate | `%.3f km/s`, or `%.3f mi/s` | "0.0 km/s" | `:294-304`, `:1208` |

### 2.5 "Settings" frame

The frame label is plain text "Settings" (`:1426`).

| Row | Col 0 | Col 1 | Col 2 | Cite |
|---|---|---|---|---|
| 0 | "1. Device:" | Combo of all `*.rig` names (without the extension), sorted, first one selected. Tooltip "Select primary radio device.This device will be used for downlink and uplink unless you select a secondary device for uplink" (no space after "device.") | Toggle "Engage", tooltip "Engage the selected radio device" | `:1291-1349`, `:1401-1406` |
| 1 | "2. Device:" | Combo: first entry "None" (selected), then every `*.rig` whose type is not "RX only", in **directory order (not sorted)**. Tooltip "Select secondary radio device\nThis device will be used for uplink" | – | `:1352-1398`, `:1226-1261` |
| 2 | (empty) | | | |
| 3 | "Cycle:" | Spin button 10–30000, step 10, 0 decimals. Tooltip "This parameter controls the delay between commands sent to the rig." | "msec" | `:1409-1424` |

- Both device combos are greyed out while the radio is engaged (`:1016-1017`, `:1029-1030`).
- **Choosing "1. Device"** (`:828-897`):
  - Loads the file.
  - Sets Cycle to the file's value.
  - Sets the downlink "LO:" read-out from LO, and the uplink "LO:" read-out from LO_UP when no secondary device is chosen.
  - Sets the downlink satellite knob to the default downlink frequency. It sets the uplink satellite knob to the default uplink frequency only when "2. Device" is "None".
- **Choosing "2. Device"** (`:899-998`):
  - "None" restores the uplink LO and the default uplink frequency from device 1.
  - Choosing the same name as device 1 silently resets the combo to "None".
  - Otherwise the uplink "LO:" shows the LO_UP of device 2.

### 2.6 Count-down frame

| Aspect | Value | Cite |
|---|---|---|
| Initial markup | "<span size='large'><b>ΔT: 00:00:00</b></span>" (translatable) | `:1441-1444` |
| Tooltip | "The time remaining until the next AOS or LOS event" | `:1445-1447` |
| Running text | xx-large bold: "AOS in" (when El < 0) or "LOS in", then `HH:MM:SS` when an hour or more, else `MM:SS` | `:220-252` |
| Refresh | Every module tick, using module time | `:281` |

### 2.7 State right after opening

- The target is the module target or the first satellite. The transponder list is loaded and its first entry is selected **without** tuning (`:1136`, `:623-624`).
- Device 1 is loaded (see §2.5). The knobs are therefore at the device's default frequencies.
- If a module target was set, the satellite combo is switched to it. That reloads the transponder list, which **does** tune to the first transponder (`:3262-3263`, `:663-691`, `:754-771`).
- Track, Lock and Engage start off. The rig timer is not running until Engage (`:156-183`).

## 3. Radio control behaviour

### 3.1 State machine

| Event | Effect | Cite |
|---|---|---|
| Engage on | Refused (log only: "%s: Controller does not have a valid configuration", button stays pressed) if device 1 failed to load. Otherwise the device combos are greyed out, a worker thread starts, and one "cycle request" is queued | `:1000-1038` |
| First request after Engage | The worker opens the TCP connection to device 1, probes the VFO option (§4.2), opens and probes device 2 if one is chosen, and starts the cycle timer. It then runs one initial cycle. For "Full-duplex" it first sends the split set-up; for the FT817 types it first switches split on (§4.1). Then the normal AOS/LOS check and cycle also run in the same pass | `:3075-3082`, `:2964-3028` |
| Cycle timer | Fires every "Cycle" ms (default 1000) and queues one cycle request. Requests are queued, not dropped, so a slow rigctld builds a backlog. "%s missed the deadline" is logged only if a SPACE-key PTT event holds the controller lock at that moment | `:3186-3196`, `:1670-1692`, `:3208-3217` |
| Changing Cycle | Restarts the timer at once if engaged. The value is stored in the device-1 configuration | `:816-826` |
| Each cycle | (1) AOS/LOS check (§3.7). (2) If device 2 is chosen: the dual-rig cycle. Otherwise the cycle for device 1's radio type (§3.4). (3) Check the error counter | `:3098-3172` |
| Track on/off | Switches Doppler correction on or off and forces the next cycle to resend both frequencies (the "last sent" values are cleared). It does **not** depend on Engage | `:804-813` |
| Lock ("L") on | Immediately recomputes the uplink from the downlink (§3.3). While on, any user change of one satellite knob moves the other | `:793-802`, `:413-431` |
| "T" or choosing a transponder | Tunes both satellite knobs to the passband centres and forces a resend (§3.3) | `:717-779` |
| Choosing a satellite | Resets the AOS/LOS memory to the new satellite's elevation, recomputes the next pass and reloads the transponder list (which tunes to the first transponder) | `:663-701`, `:568-625` |
| Engage off (user) | Device combos become sensitive again. The worker resets its state, stops the timer, switches split off for the FT817 types, sends `q⏎` and closes device 2 and then device 1. The UI waits for the worker to finish | `:1013-1026`, `:3083-3096`, `:2940-2962` |
| 5 errors in a row | Log "%s:%s: MAX_ERROR_COUNT (%d) reached. Disengaging device!". The worker closes the sockets itself, then pops the Engage button out on the UI thread without re-running the disengage logic | `:68`, `:3141-3172`, `:3039-3052` |
| Window closed | If engaged, disengages as above. Then device 1's configuration (including the current Cycle) is written back to its `.rig` file. Device 2 is not saved | `:103-143` |

The error counter is raised by any failed frequency set or read in a cycle. It is reset to 0 by any successful frequency set (`:1716`, `:1781`, `:1807`, and the equivalents in the other cycles). **No error is ever shown in the window.** The only visible sign is the Engage button popping out.

### 3.2 Doppler and LO arithmetic

f_sat = satellite knob (Hz). f_rig = radio knob (Hz). rr = range rate in km/s (positive means receding). c = 299 792.458 km/s. LO and LO_UP are from the device file (Hz). For the uplink, the dual-rig cycle uses LO_UP of device 2.

| Quantity | Formula | When computed | Cite |
|---|---|---|---|
| Downlink Doppler `dd` | dd = −f_sat_down · rr / c | Every module tick | `:306-311` |
| Uplink Doppler `du` | du = +f_sat_up · rr / c | Every module tick | `:313-318` |
| Radio downlink, Track on | f_rig_down = f_sat_down + dd − LO | Every cycle | `:1755-1759` |
| Radio downlink, Track off | f_rig_down = f_sat_down − LO | | `:1766-1767` |
| Radio uplink, Track on | f_rig_up = f_sat_up + du − LO_UP | | `:1761-1762` |
| Radio uplink, Track off | f_rig_up = f_sat_up − LO_UP | | `:1768-1769` |
| Dial feedback, downlink | f_sat_down = f_read + LO − dd (Track on) or f_read + LO (Track off) | When the rig reports a change | `:1726-1734` |
| Dial feedback, uplink | f_sat_up = f_read + LO_UP − du (Track on) or f_read + LO_UP (Track off) | | `:1851-1859` |

So when the satellite is receding, the radio receives below and transmits above the satellite frequency. A positive LO means the converter subtracts (radio = sky − LO). A negative LO means high-side injection.

### 3.3 Transponder tune and lock

| Action | Rule | Cite |
|---|---|---|
| Tune downlink | Only if DOWN_LOW > 0 and DOWN_HIGH > 0: f_sat_down = DOWN_LOW + \|DOWN_HIGH − DOWN_LOW\| / 2 (integer division) | `:727-736` |
| Tune uplink | Only if UP_LOW > 0 and UP_HIGH > 0: same rule on the uplink. Beacons therefore tune only the downlink | `:738-747` |
| Lock: downlink → uplink | Only if DOWN_LOW > 0 and UP_LOW > 0. Δ = f_sat_down − DOWN_LOW. Normal: f_sat_up = UP_LOW + Δ. Inverting: f_sat_up = UP_HIGH − Δ | `:343-363` |
| Lock: uplink → downlink | Δ = f_sat_up − UP_LOW. Normal: f_sat_down = DOWN_LOW + Δ. Inverting: f_sat_down = DOWN_HIGH − Δ | `:369-389` |
| When the lock acts | On a user change of either satellite knob, on switching "L" on (downlink → uplink), and after dial feedback (§3.5) | `:413-431`, `:800-801`, `:1737-1740`, `:1862-1865` |
| Passband limits | **Not enforced.** The knobs can be moved outside DOWN_LOW…DOWN_HIGH and the lock keeps mapping linearly | `:343-389` |
| Mode / baud | Not used by the controller. The only transponder fields it uses are the four frequency limits, INVERT and the name | grep `gtk-rig-ctrl.c` |

### 3.4 Radio types and what each cycle sends

The type codes are in `radio-conf.h:36-43`. The labels are those of the editor (§8.2). "F/f" means set/get frequency on the current VFO. "I/i" means set/get the split (TX) frequency. Exact strings are in §4.

| Type (code, editor label) | Per-cycle behaviour | Cite |
|---|---|---|
| 0 "RX only" | **RX cycle.** If PTT reading is configured, read PTT. If the radio was tuned before and PTT is off, read the frequency (`f`). A change of ≥ 1 Hz is dial feedback (§3.5) and ends the cycle. Otherwise both radio knobs are recomputed (§3.2). If engaged, PTT is off and the new downlink differs from the last sent value by ≥ 1 Hz: send `F`, wait 5 ms, read back with `f` and remember the read value | `:1694-1815` |
| 1 "TX only" | **TX cycle.** The mirror image on the uplink. PTT counts as **on** when PTT reading is "None", so it always tunes. It acts only while PTT is on. Dial feedback updates the uplink satellite knob, and the lock then moves the downlink | `:1817-1941` |
| 2 "Half-duplex" | RX cycle, then TX cycle, in the same cycle on the same VFO (both with `F`/`f`). PTT decides which one acts. When PTT changes, the other direction's "last sent" value is cleared so the VFO is retuned and the stale read is not taken as dial feedback. The editor forces PTT reading for this type (§8.2) | `:1943-1947`, `:1793-1803`, `:1918-1929` |
| 3 "Full-duplex" | At engage: split set-up `S …` from VFO Up/Down (§4.1). Each cycle: RX cycle (`F`/`f` on the current VFO), then the duplex TX cycle. That cycle reads `i` (on a read error it uses the last value and counts an error); a change of ≥ 1 Hz is uplink dial feedback. Otherwise both radio knobs are recomputed and, if the uplink differs by ≥ 1 Hz, it sends `I`, waits 5 ms and reads back `i`. PTT is ignored on the TX side | `:3007-3012`, `:2137-2141`, `:2030-2135` |
| 4 "FT817/857/897 (auto)" | At engage: split on (`S 1 …`). Each cycle: the RX cycle. **At most every 10 s of wall-clock time** (and on the first cycle) a TX update: read PTT; if PTT is off and the uplink radio frequency differs from the last sent by ≥ **10 Hz**, send `I`. The value is remembered even if the send failed. There is no read-back and no uplink dial feedback | `:3014-3018`, `:1949-1974`, `:1993-2028` |
| 5 "FT817/857/897 (manual)" | Each cycle: the RX cycle only. The TX frequency is sent only on the SPACE key (§3.6) | `:1953-1957`, `:2835-2871` |
| any, with "2. Device" chosen | **Dual-rig cycle.** The type and PTT settings of both radios are ignored. Device 1 (downlink) gets `F`/`f`; device 2 (uplink) gets `F`/`f` on its own socket. Order: downlink dial feedback first; if the dial changed, only the uplink is retuned. Otherwise the downlink is forward-tuned, then uplink dial feedback is checked; if the uplink dial changed, the downlink is retuned, else the uplink is forward-tuned. Each set is followed by a 5 ms wait and a read-back | `:2143-2388` |
| unknown code | Treated as "RX only". Log "%s:%s: Invalid radio type %d. Setting type to RIG_TYPE_RX" | `:3021-3025`, `:3131-3137` |

- **Threshold:** frequencies are resent only when they differ by ≥ 1.0 Hz (10 Hz for the FT817 auto TX update) (`:1776`, `:1901`, `:2013`, `:2113`).
- **Read-back:** after each successful set, the radio's actual frequency is read back and becomes the comparison value. This absorbs the tuning-step rounding of radios such as the FT-817 (`:1786-1791`).

### 3.5 Dial feedback (user turns the radio's knob)

- It is active only when engaged and when the "last sent" value for that direction is non-zero. Tune, choosing a transponder, Track and disengage all clear that value, which suppresses feedback for one cycle (`:1703-1711`, `:734-746`, `:810-812`, `:2944-2947`).
- A read that differs from the last sent value by ≥ 1 Hz is treated as a user change:
  1. The radio knob shows the read value.
  2. The satellite knob is back-computed (§3.2).
  3. If Lock is on, the other direction follows (§3.3).
  4. No forward tuning is done in that cycle (`:1718-1744`).
- In the RX/TX cycles a read error only counts an error. In the duplex and dual-rig cycles the last value is used instead (`:2045-2050`, `:2152-2157`).
- There is no dial feedback for the FT817 TX side (`:1990`).

### 3.6 PTT handling

| PTT setting (code) | Command used to read PTT | Interpretation | Cite |
|---|---|---|---|
| 0 "None" | not read. The RX cycle assumes PTT off, the TX cycle assumes PTT on | | `:1697-1701`, `:1820-1826` |
| 1 "Read PTT" | `t` | The first line of the reply is parsed as an unsigned integer (base auto-detected). Exactly 1 means PTT on; anything else, including an error or no reply, means off | `:2397-2425` |
| 2 "Read DCD" | the single byte 0x8B (hamlib's short code for get_dcd) | same | `:2405-2412` |

**SPACE key (only for "FT817/857/897 (manual)")**:
- A key-press handler on the controller reacts to the space bar (`:2835-2871`, `:3231`).
- It waits up to about 0.4 s (polling every 100 ms) for the controller lock. If it cannot get the lock: log "%s: Failed to acquire controller lock; PTT event not handled" (`:2763-2829`).
- If not engaged: log "%s: Controller not engaged; PTT event ignored (Hint: Enable the Engage button)" (`:2789-2795`).
- Otherwise it reads PTT:
  - If off: it runs the FT817 TX update (send `I` if ≥ 10 Hz off) and then sends PTT on.
  - If on: it sends PTT off (`:2798-2817`).
- Whether the window actually receives the key press depends on GTK focus: **UNVERIFIED**.
- For other radio types the key is ignored, apart from a log line (`:2849-2858`).

### 3.7 AOS / LOS signalling

- It is checked once per cycle, **only while both Engage and Track are on** (`:2471`).
- AOS = the previous elevation was < 0 and the current elevation is ≥ 0. LOS = the previous elevation was ≥ 0 and the current elevation is < 0. The previous elevation is updated every cycle, even when not engaged (`:2473`, `:2504`, `:2537`).

| Event | Device-file flag | String sent (to device 1, and to device 2 if chosen and its own flag is set) | Cite |
|---|---|---|---|
| AOS | SIGNAL_AOS | `AOS⏎` | `:2476-2488` |
| AOS | SIGNAL_AOIQ | `U IQRECORD 1⏎` | `:2489-2502` |
| LOS | SIGNAL_LOS | `LOS⏎` | `:2506-2519` |
| LOS | SIGNAL_LOIQ | `U IQRECORD 0⏎` | `:2520-2533` |

- The reply is read into a 10-byte buffer and is not checked. A send failure does not count as an error (`:2468`, `:3098`).
- Whether hamlib's rigctld accepts these four commands is **UNVERIFIED**. Gpredict sends them regardless.

### 3.8 Messages (all log only)

| Message | Cite |
|---|---|
| "%s: Controller does not have a valid configuration" | `gtk-rig-ctrl.c:1008`, `:1677` |
| "%s:%s: Loaded new radio configuration %s" / "%s:%s: Failed to load radio configuration %s" | `:857`, `:888`, `:979`, `:989` |
| "%s:%s: GtkSatModule has no target satellite." | `:587` |
| "%s:%s: Satellite %d has %d transponder modes." (debug) | `:596` |
| "%s: Inconsistency detected in internal transponder data (%d,%d)" | `:775` |
| "%s: Failed to create socket" / "%s: Failed to connect to %s:%d" / "%s: Connection opened to %s:%d" (debug) | `:2882`, `:2903`, `:2910` |
| "%s:%s: sending %d bytes to rigctld as \"%s\"" (debug) / "%s:%s: Read %d bytes from rigctld" (debug) | `:1479`, `:1511` |
| "%s: SIZE ERROR %d / %d" / "%s: rigctld port closed" / "%s:%s: Got 0 bytes from rigctld" | `:1485`, `:1490`, `:1498`, `:1506` |
| "%s:%s: %s rigctld returned error (%s)" | `:1542`, `:1560` |
| "%s:%s: VFO opt=%d" / "%s:%s: VFO opt2=%d" (debug) | `:2976`, `:2985` |
| "%s:%s: Sent 2 bytes but sent %d." | `:2924` |
| "%s:%s: MAX_ERROR_COUNT (%d) reached. Disengaging device!" | `:3146` |
| "%s missed the deadline" | `:1684` |
| "%s: Detected SPACEBAR pressed event" / "%s: PTT is OFF => Set TX freq and PTT=ON" / "%s: PTT is ON = Set PTT=OFF" | `:2851`, `:2804`, `:2814` |

## 4. rigctld protocol as used by Gpredict

### 4.1 Commands

| Purpose | Without VFO option | With VFO option (§4.2) | Expected reply / check | Cite |
|---|---|---|---|---|
| Enable VFO option (probe step 1) | `\set_vfo_opt 1⏎` | same | read and ignored | `gtk-rig-ctrl.c:2681-2683` |
| Check VFO option (probe step 2) | `\chk_vfo⏎` | same | VFO option is on if the first byte of the reply is `1`. A reply starting with `RPRT` means off | `:2685-2694` |
| Set frequency | `F %10.0f⏎`, e.g. `F  145890000⏎` (the number is right-aligned in 10 characters) | `F currVFO %10.0f⏎` | must start with `RPRT 0` | `:2548-2562` |
| Get frequency | `f⏎` | `f currVFO⏎` | the first line is parsed as a decimal number of Hz. A reply starting with `RPRT` is an error | `:2638-2667` |
| Set split TX frequency | `I %10.0f⏎` | `I VFOA %10.0f⏎` (always VFOA) | must start with `RPRT 0` | `:2569-2586` |
| Get split TX frequency | `i⏎` | `i currVFO⏎` | as for `f` | `:2709-2747` |
| Full-duplex split set-up (once at engage) | VFO Up = A: `S 1 VFOA⏎`; B: `S 1 VFOB⏎`; Main: `S 1 Main⏎`; Sub: `S 1 Sub⏎` | `S VFOB 1 VFOA⏎`, `S VFOA 1 VFOB⏎`, `S Sub 1 Main⏎`, `S Main 1 Sub⏎` | must start with `RPRT 0` | `:1620-1668` |
| FT817 split on (engage) | `S 1 <n>⏎` | `S VFOA 1 <n>⏎` if VFO Down is A, else `S VFOB 1 <n>⏎` | must start with `RPRT 0` | `:2593-2609` |
| FT817 split off (disengage) | `S 0 <n>⏎` | `S VFOA 0 <n>⏎` | must start with `RPRT 0` | `:2616-2631` |
| Get PTT | `t⏎` | `t currVFO⏎` | see §3.6 | `:2397-2404` |
| Get DCD | byte 0x8B then `⏎` | byte 0x8B then ` currVFO⏎` | see §3.6 | `:2405-2412` |
| Set PTT (SPACE key only) | `T 1⏎q⏎` / `T 0⏎q⏎` | `T currVFO 1⏎q⏎` / `T currVFO 0⏎q⏎` | must start with `RPRT 0` | `:2428-2454` |
| AOS/LOS signalling | `AOS⏎`, `LOS⏎`, `U IQRECORD 1⏎`, `U IQRECORD 0⏎` | same | not checked | `:2466-2540` |
| Close | `q⏎` | same | not read | `:2917-2938` |

Notes on the table:
- `<n>` in the FT817 split commands is the **numeric** VFO Down code (1 = A, 2 = B, 3 = Main, 4 = Sub, `radio-conf.h:51-57`), not a VFO name. The device file stores VFO Down only for "Full-duplex" radios (`radio-conf.c:247-278`), so for the FT817 types the number sent is not loaded from the file: **UNVERIFIED** what is actually sent.
- The set-PTT strings append `q⏎`, which asks rigctld to close the connection. The effect on the following cycles is **UNVERIFIED**.
- The device-2 socket is formatted with **device 1's** VFO-option flag, because every formatter reads the primary configuration (`:2554`, `:2645`).
- Full-duplex uses only VFO Up for the split set-up. VFO Down is not sent (`:1628-1662`).

### 4.2 Connection and reply handling

| Topic | Behaviour | Cite |
|---|---|---|
| Transport | One TCP connection per device (IPv4, `gethostbyname`), opened at the first cycle request after Engage | `gtk-rig-ctrl.c:2873-2915`, `:3077-3078` |
| VFO option | Probed on each connect (§4.1) and kept in memory only. It is never written to the file (`radio-conf.h:80`) | `:2974-2986` |
| Request/response | Each command is one `send` followed by **one** `recv` of at most 127 bytes. There is no line framing: the reply is whatever arrives in that read | `:1470-1517` |
| Serialisation | A mutex makes sure only one command at a time is on the wire | `:1519-1532` |
| Timeouts | **None.** The receive blocks until data arrives or the peer closes. There is no connect timeout beyond the OS default | `:1495`, `:2900` |
| Set replies | Success only if the reply starts with `RPRT 0`. Anything else (another RPRT code, empty, junk) is logged and counts as a failure | `:1534-1550` |
| Get replies | A reply starting with `RPRT` is a failure. Otherwise the first line is the value | `:1552-1568`, `:2653-2655` |
| `recv` returns 0 | Logged "Got 0 bytes", but the call counts as successful with an empty reply. A following set check then fails | `:1503-1508` |
| Host cannot be resolved | The resolver result is used without a check. **UNVERIFIED** runtime effect (probably a crash) | `:2895-2896` |
| Connect fails | Logged. The socket value is reset to "none". Because the worker reopens whenever there is no socket, **every following cycle tries to reconnect**. Meanwhile the commands fail, so 5 failed cycles disengage the radio (§3.1) | `:2901-2906`, `:3077-3078` |
| Reconnect after auto-disengage | Press Engage again. A new worker and new sockets are created | `:1027-1037` |

## 5. Antenna Control window: widgets (`gtk-rot-ctrl.c`)

### 5.1 Layout

The window contents are a box with a 5 px border. Its first child is a frame holding the polar plot (expands). Its second child is a grid (no expansion, 5 px padding) (`gtk-rot-ctrl.c:1729-1732`). The box is created without an orientation, so GTK's default (horizontal) applies: plot on the left, controls on the right. That this is how it looks is **UNVERIFIED** (not checked visually).

The controls grid has homogeneous columns, 5 px spacing and no border (`:1717-1727`):

| Cell | Content | Cite |
|---|---|---|
| row 0, col 0 | Frame "Azimuth" | `:643-670` |
| row 0, col 1 | Frame "Elevation" | `:678-705` |
| row 1, col 0 | Frame "Satellite" | `:1304-1384` |
| row 1, col 1 | Frame "Settings" | `:1386-1521` |

### 5.2 Rotator knob (`gtk-rot-knob.c`)

| Aspect | Behaviour | Cite |
|---|---|---|
| Display | Column 0 is a sign ("-" for negative, else blank). Columns 1–6 hold `%6.2f` of the absolute value (hundreds, tens, units, ".", tenths, hundredths; always a "." decimal point). Column 7 is "°". All xx-large | `gtk-rot-knob.c:64-87`, `:506-532` |
| Arrow buttons | Flat "▴" above and "▾" below the hundreds, tens, units, tenths and hundredths digits: ±100, ±10, ±1, ±0.1, ±0.01. A step that overshoots the limit by more than 0.005 is ignored. A smaller overshoot is clamped to the limit | `:419-504`, `:96-120` |
| Mouse on a digit | Same steps as the arrows. Left click or wheel up/right adds, right click or wheel down/left subtracts, middle click nothing. The result is **clamped** to the range (unlike the arrows, which ignore an overshoot). Clicking the sign or the decimal point does nothing | `:34`, `:146-252`, `:299-311` |
| Tooltip on each digit | "Use mouse buttons and wheel to change value" | `:511-512` |
| Range | Set from the rotator file (Min/Max Az, Min/Max El). Limits of 1000 or more are refused | `:286-391` |
| Signals | None. The controller polls the value on its timer | – |

### 5.3 "Azimuth" and "Elevation" frames

| Frame | Knob | Read-back row | Cite |
|---|---|---|---|
| "Azimuth" | starts at 180.00, range 0–360 until a device is loaded | "Read:" + value, initially " --- " | `:649-669` |
| "Elevation" | starts at 45.00, range 0–90 until a device is loaded | "Read: " (with a trailing space) + value, initially " --- " | `:684-704` |

Read-back values:
- Engaged, no error: `%.2f°`, with the azimuth wrapped into 0–360 (`:863-884`).
- Engaged, client error: "ERROR" in both labels (`:869-872`).
- After disengage: "---", without the surrounding spaces (`:1201-1202`).

### 5.4 "Satellite" frame

| Row | Content | Cite |
|---|---|---|
| 0 | Search entry "Filter..." (cols 0–1). Same filter behaviour as the radio window | `:1320-1325`, `:707-749` |
| 1 | Satellite combo, tooltip "Select target object" (cols 0–1). Toggle "Track" in col 4, tooltip "Track the satellite when it is within range" | `:1328-1350` |
| 2 | "Az:" + `%7.2f°` | `:1353-1359`, `:63` |
| 3 | "El:" + `%7.2f°` | `:1362-1368` |
| 4 | "ΔT:" + count-down, initially "00:00:00", then `HH:MM:SS` or `MM:SS` (no "AOS in"/"LOS in" text). It counts to AOS when El < 0, else to LOS | `:1371-1376`, `:472-506` |

### 5.5 "Settings" frame

| Row | Col 0 | Col 1 | Col 2 | Cite |
|---|---|---|---|---|
| 0 | "Device:" | Combo of `*.rot` names, sorted, first selected. Tooltip "Select antenna rotator device" | Toggle "Engage", tooltip "Engage the selected rotor device" | `:1401-1464` |
| 1 | – | Check box "Monitor", tooltip "Monitor rotator but do not send any position commands" | – | `:1467-1473` |
| 2 | "Cycle:" | Spin 10–30000, step 10, 0 decimals. Tooltip "This parameter controls the delay between commands sent to the rotator." | "msec" | `:1476-1491` |
| 3 | "Threshold:" | Spin 0.01–50.00, step 0.01, 2 decimals. Tooltip "This parameter sets the threshold that triggers new motion command to the rotator.\nIf the difference between the target and rotator values is smaller than the threshold, no new commands are sent" | "deg" | `:1494-1512` |

Choosing a device (`:1109-1164`):
- Loads the file.
- Sets Cycle and Threshold from it.
- Sets the Az and El knob ranges to the device limits.
- Re-evaluates whether the current pass is a "flip" pass (§6.3).

Changing Cycle restarts the control timer. Changing Cycle or Threshold also updates the in-memory configuration, which is saved when the window closes (`:1068-1098`, `:1611-1642`).

### 5.6 Polar plot inside the window (`gtk-polar-plot.c`)

| Element | Rendering | Cite |
|---|---|---|
| Size | Requested 200 × 200 px. r = min(width, height)/2 − 20 | `gtk-polar-plot.c:55-56`, `:676-696`, `:750-759` |
| Background | Always white (not the polar-view colour setting) | `:460-462`, `:736` |
| Axes | Circles at 0°, 30° and 60° elevation (r, 0.6667r, 0.333r) and a cross extended 5 px beyond the rim, in the Polar View "Axes/Circles" colour | `:470-495` |
| Cardinal labels | "N", "E", "S", "W", placed by the Polar View orientation setting, in the tick colour | `:497-535`, `:730` |
| QTH name | Top-left, in the info colour, only if Polar View "QTH Info" is on | `:537-547`, `:731` |
| Cursor read-out | Bottom-left "AZ: %.0f°  EL: %.0f°" (two spaces), always enabled, shown only above the horizon | `:549-558`, `:643-671`, `:733` |
| Pass track | A polyline of the current or next pass in the track colour, from (AOS az, 0°) to (LOS az, 0°), with 4 time labels in `%H:%M` (the first at AOS) | `:252-307`, `:560-590` |
| Target | A filled 4 × 4 px square at the satellite position in the satellite colour. Hidden when El < 0 | `:61`, `:592-601`, `gtk-rot-ctrl.c:1030-1034` |
| Controller set-point | A circle of 7 px radius (stroke) at the knob values in the satellite colour | `:603-611`, `gtk-rot-ctrl.c:1036-1054` |
| Rotator position | A cross-hair of four 10 px strokes (from 4 to 14 px off-centre) in the satellite colour. Shown only while engaged and without error | `:613-635`, `gtk-rot-ctrl.c:873-895`, `:1023-1027` |
| Font | The GTK default font, falling back to "Sans 9" | `:466-467`, `:744-748` |

For a "−180…+180" rotator, negative azimuths are shifted by +360 before plotting (`gtk-rot-ctrl.c:886-895`, `:1039-1052`).

## 6. Rotator behaviour

### 6.1 Timers and states

| Item | Behaviour | Cite |
|---|---|---|
| Control timer | Runs from window creation, whether or not engaged, every "Cycle" ms (default 1000). It computes the set-point, updates the knobs and the plot, and hands targets to the client thread | `gtk-rot-ctrl.c:1734-1735`, `:776-1057` |
| Engage on | Refused (log "%s: Controller does not have a valid configuration") without a loaded device. Otherwise a client thread starts and "Device:" is greyed out | `:1230-1246` |
| Client thread loop | (1) If there is a new target and "Monitor" is off, send it (`P`). On failure, keep it for the next loop. (2) Wait 100 ms. (3) Read the position (`p`). (4) Publish position and error flag. (5) Sleep max(loop time, 0.7 s). So one loop takes at least about 0.8 s and talks to rotctld at most half the time, **independent of "Cycle"** | `:393-461` |
| Engage off | "Device:" becomes sensitive again and the Read labels show "---". If the client thread is running, it sends stop (`S`), stops the thread, and the thread sends `q⏎` and closes | `:1197-1229`, `:456-458` |
| Track on | The knobs are greyed out (they follow the satellite). The "Monitor" box is greyed out while Track or Engage is on, but this is only re-evaluated when Track is toggled | `:757-768` |
| Monitor on | The knobs and "Track" are greyed out. Positions are still read, but no `P` is sent | `:1171-1179`, `:429` |
| Window closed | Timer stopped, configuration saved (Cycle and Threshold persist), client thread stopped (sends `q⏎`) | `:1611-1642` |

### 6.2 Set-point computation (each timer tick)

With Track on and a target (`:798-845`):

| Situation | Set-point (Az, El) |
|---|---|
| Target El ≥ 0 | (target Az, target El), each clamped to [Min, Max] of the device |
| Target El < 0, before the stored pass's AOS | (AOS azimuth, 0°), clamped |
| Target El < 0, after the stored pass's LOS | (LOS azimuth, 0°), clamped |
| Target El < 0, no pass, or a time inside the pass window | the defaults (0°, 45°), not clamped |
| Flip pass (§6.3) **and** Max El ≥ 180 | El → 180 − El. Az → Az ± 180 (subtract if > 180, else add), then wrapped by 360 into [Min Az, Max Az] |
| Device type "−180…+180" and Az > 180 | Az → Az − 360 |
| Not engaged | The knobs are set to the set-point (preview only) |

With Track off, the set-point is simply the current knob values (`:846-851`).

### 6.3 Flip-pass detection

A pass is "flipped" when following it would make the azimuth jump across the rotator's end stop (`gtk-rot-ctrl.c:209-285`):
- The azimuth window is [0, 360] for type 0 and [−180, 180] for type 1, shifted by (AzStopPos − window minimum).
- Every point of the pass is wrapped by 360 into that window. The points are AOS azimuth, the pass-detail azimuths, and LOS azimuth.
- If two consecutive points differ by more than 180°, the pass is flipped.
- A flipped pass gets special treatment only if the rotator's Max El is ≥ 180 (an "over-the-top" elevation axis). Otherwise nothing changes and the rotator simply follows the azimuth.

### 6.4 Tolerance and lead-ahead (engaged only, `:853-992`)

1. **Read the client state** if its lock is free: the position and the error flag. The read azimuth is wrapped into 0–360 for display and for the comparison.
2. **Compare:** if |set Az − read Az| or |set El − read El| is greater than Threshold, a new command is due.
3. **Lead-ahead:** if Track is on and the target is above the horizon, the set-point is moved ahead of the satellite. A binary search over the time t + Δ is used:
   - Δ starts at LOS − t, or 20 minutes (1/72 day) when there is no pass. The first step is Δ/2, at least one Cycle.
   - The search stops when the step is below Cycle/4.
   - At each trial time it predicts Az/El (with the flip and "−180…+180" adjustments). If the satellite is below 0°, above 180°, or more than Threshold away from the current set-point, it steps back; otherwise it steps forward.
   - The result, clamped to the limits, becomes the new set-point.
4. **Command:** the knobs are set to the set-point. The new target is handed to the client thread, which sends `P`.
5. **Errors:** if the client reports an error, the error counter rises by 1 per tick. When it reaches 5 the Engage button is released (which sends `S`) and the log shows "%s: MAX_ERROR_COUNT (%d) reached. Disengaging device!". An error-free tick resets the counter to 0 (`:994-1021`).

With a "−180…+180" rotator, a negative set-point is compared with a read azimuth already wrapped into 0–360, so the threshold test always fails for negative azimuths and a command is due on every tick. This is a code observation (`:863-867`, `:900-901`).

### 6.5 Pass kept for the plot and for the below-horizon logic (`:515-615`, `:1257-1301`)

- On opening and when a satellite is chosen: the current pass if El > 0, else the next pass within 3 days.
- On every module tick:
  - Recomputed if the ground station moved more than 1.0 (distance unit **UNVERIFIED**, probably km).
  - If the time is outside the stored pass and the satellite is up, the current pass is taken.
  - If the satellite's next AOS is later than the stored AOS by more than Cycle/4, the next pass is taken.
  - If the time is inside the stored pass but the satellite is below the horizon, the next pass is taken.
- Each new pass is redrawn on the plot and re-checked for flip.

### 6.6 Messages (log only, except the Read labels)

| Message | Cite |
|---|---|
| "Failed to create rotctl socket: %s" | `gtk-rot-ctrl.c:80` |
| "Name resolution of rotctld server %s failed." | `:93` |
| "Connection to rotctld server at %s:%d failed: %s" | `:110` |
| "%s: Connection opened to %s:%d" (debug) | `:121` |
| "%s: SIZE ERROR %d / %d" / "%s: rotctld Socket Down" / "%s:%s: Got 0 bytes from rotctld" | `:169`, `:174`, `:184`, `:192` |
| "%s:%d: rotctld returned error (%s)" / "%s:%d: rotctld returned bad response (%s)" | `:320`, `:336` |
| "%s:%d: rotctld returned error %d with az %f el %f(%s)" | `:383` |
| "%s:%d: rotctld returned error %d with stop-cmd (%s)" | `:1222` |
| "%s: MAX_ERROR_COUNT (%d) reached. Disengaging device!" | `:1010` |
| "Loaded new rotator configuration %s" / "%s:%d: Failed to load rotator configuration %s" | `:1136`, `:1155` |
| stdout (not the log): "Starting rotctld client thread" / "Stopping rotctld client thread" | `:402`, `:456` |

## 7. rotctld protocol as used by Gpredict

| Purpose | String | Reply handling | Cite |
|---|---|---|---|
| Get position | `p⏎` | A reply starting with `RPRT` is an error (logged). Otherwise line 1 is the azimuth and line 2 the elevation (decimal). Fewer than two lines is a "bad response" error | `gtk-rot-ctrl.c:296-348` |
| Set position | `P %.2f %.2f⏎`, e.g. `P 180.00 45.00⏎` | The number after the first 4 characters (`RPRT`) is parsed. Non-zero is an error (logged, the target is kept and retried next loop) | `:362-390` |
| Stop | `S⏎` | Sent from the UI thread on Disengage. A non-zero RPRT code is logged | `:1208-1225` |
| Close | `q⏎` | not read | `:128-149` |
| Park | **not used** | – | grep |

- **Transport:** one TCP connection (IPv4), opened by the client thread at Engage. Each command is one `send` plus one `recv` of up to 128 bytes, with no framing and no timeout (`:69-125`, `:157-197`).
- **Decimal separator:** `P` uses `%.2f` with the process locale. Gpredict only switches `LC_NUMERIC` to "C" during a transponder update (`trsp-update.c:164`), so in a comma-decimal locale the command may contain commas. **UNVERIFIED** at runtime.
- **rotctld unreachable at Engage:**
  - The client thread logs the failure and exits. The button stays engaged and no "ERROR" appears, because the error flag is never set.
  - The Read labels show "0.00°" (the never-updated position).
  - Targets are queued but never sent.
  - Recovery is Disengage plus Engage, which retries the connection (`:404-407`, `:853-896`, `:1204-1206`). Code observation.

## 8. Preferences → Interfaces

The page is a notebook with the tabs "Radios" and "Rotators" (`sat-pref-interfaces.c:49-56`). Changes are kept in the tables and written to disk only when the Preferences dialog is closed with OK. Cancel discards them (the cancel handlers do nothing) (`sat-pref.c:170-181`, `sat-pref-rig.c:859-862`, `sat-pref-rot.c:548-550`).

### 8.1 "Radios" tab (`sat-pref-rig.c`)

A scrolled table, sorted by Config Name ascending, then a row of buttons (`:839-857`, `:71-73`). **All 15 columns are visible**; none is hidden (no visibility call in the file).

| # | Column title | Cell text | Cite |
|---|---|---|---|
| 1 | "Config Name" | file name without ".rig" | `:521-530`, `:160-178` |
| 2 | "Host" | text | `:533-537` |
| 3 | "Port" | integer | `:540-544` |
| 4 | "Rig Type" | "RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (man)", else "ERROR" | `:547-554`, `:191-234` |
| 5 | "PTT Status" | "None", "PTT", "DCD" (unknown codes show "None") | `:557-565`, `:247-274` |
| 6 | "VFO Up" | "VFO A", "VFO B", "Main", "Sub", else "-" (not translatable) | `:568-576`, `:321-360` |
| 7 | "VFO Down" | same | `:579-587` |
| 8 | "LO Down" | `%.3f MHz` | `:590-598`, `:289-307` |
| 9 | "LO Up" | `%.3f MHz` | `:601-608` |
| 10 | "Downlink" (default downlink) | `%.3f MHz` | `:611-619` |
| 11 | "Uplink" (default uplink) | `%.3f MHz` | `:622-629` |
| 12–15 | "Signal AOS", "Signal LOS", "Signal AOIQ", "Signal LOIQ" | "YES" / "NO" (not translatable) | `:632-676`, `:362-373` |

| Button | Tooltip | Behaviour | Cite |
|---|---|---|---|
| "Add new" | "Add a new radio to the list" | Opens the editor empty (§8.2). OK adds a row | `:813-815`, `:740-797` |
| "Edit" | "Edit selected radio" | Opens the editor with the selected row. Without a selection: error box "Select the radio you want to edit\nand try again!". Double-clicking a row also edits it, but the handler is connected **twice**, so the editor opens a second time after the first closes (code observation) | `:818-820`, `:384-506`, `:653-654`, `:678-679` |
| "Delete" | "Delete selected radio" | Removes the row **without confirmation**. Without a selection: "Select the radio you want to delete\nand try again!" | `:823-825`, `:688-729` |

- The buttons are never greyed out, even with an empty table (`:412-422`, `:697-707`).
- **Name checks:** no duplicate-name check. Two rows with the same name write the same file, and the last one wins (`:921-960`).

### 8.2 Radio editor dialog (`sat-pref-rig-editor.c`)

- **Title** "Edit radio configuration". **Buttons** "_Clear", "_Cancel", "_Ok" (note "Ok", not "OK"). Modal (`:596-603`).
- "_Ok" stays greyed out until Name has at least one character (`:605-607`, `:196-208`).
- "_Clear" resets the fields and keeps the dialog open. Any other response cancels (`:616-640`).

| Row | Label | Widget, range, default | Tooltip | Cite |
|---|---|---|---|---|
| 0 | "Name" | entry, max 25 characters. Illegal characters beep and are removed. Allowed: 0–9, a–z, A–Z, "-", "_" | "Enter a short name for this configuration, e.g. IC910-1.\nAllowed characters: 0..9, a..z, A..Z, - and _" | `:260-272`, `:170-195`; `gpredict-utils.c:509-514` |
| 1 | "Host" | entry, max 50, default "localhost" | "Enter the host where rigctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\nIf gpredict and rigctld are running on the same computer use localhost" | `:275-288` |
| 2 | "Port" | spin 1024–65535, default 4532. Stored ports ≤ 1023 are shown as 4532 | "Enter the port number where rigctld is listening" | `:291-301`, `:81-85` |
| 3 | "Radio type" | combo "RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (manual)". Default "RX only" | Markup text with one paragraph per type, starting "<b>RX only:</b>  The radio shall only be used as receiver. If <i>Monitor PTT status</i> is checked …" (it still refers to a "Monitor PTT status" check box that no longer exists) | `:304-356` |
| 4 | "PTT status" | combo "None", "Read PTT", "Read DCD". Default "None" | "Select PTT type.\n\n<b>None:</b>\nDon't read PTT status from this radio.\n\n<b>Read PTT:</b>\nRead PTT status using get_ptt CAT command. You have to check that your radio and hamlib supports this.\n\n<b>Read DCD:</b>\nRead PTT status using get_dcd command. This can be used if your radio does not support the read_ptt CAT command and you have a special interface that can read squelch status and send it via CTS." | `:359-378` |
| 5 | "VFO Up/Down" | combo "Not applicable", "MAIN ↑ / SUB ↓", "SUB ↑ / MAIN ↓", "A ↑ / B ↓", "B ↑ / A ↓". Default "Not applicable" | "Select which VFO to use for uplink and downlink. This setting is used for full-duplex radios only, such as the IC-910H, FT-847 and the TS-2000.\n\n<b>IC-910H:</b> MAIN↑ / SUB↓\n<b>FT-847:</b> SUB↑ / MAIN↓\n<b>TS-2000:</b> B↑ / A↓" | `:381-405` |
| 6 | "LO Down" + "MHz" | spin −10000…10000, step 1, **0 decimals** (whole MHz), default 0 | "Enter the frequency of the local oscillator  of the downconverter, if any." (two spaces) | `:408-423` |
| 7 | "LO Up" + "MHz" | same | "Enter the frequency of the local oscillator of the upconverter, if any." | `:426-441` |
| 8 | "Default downlink" + "MHz" | spin 0–10000, step 0.001, 3 decimals. **Initial 0** | "Enter the default downlink frequency" | `:444-457` |
| 9 | "Default uplink" + "MHz" | same range. **Initial 123.456** | "Enter the default uplink frequency" | `:460-473` |
| 10 | "Signalling" | check "AOS" / check "LOS" | "Enable AOS signalling for this radio." / "Enable LOS signalling for this radio." | `:476-488` |
| 11 | – | check "AOIQ" / check "LOIQ" | "Enable AOIQ signalling (start IQ recording)." / "Enable LOIQ signalling (stop IQ recording)." | `:490-498` |

**Consistency rules while editing:**
- Choosing "Half-duplex" with PTT "None" switches PTT to "Read PTT". Choosing "None" while the type is "Half-duplex" switches back to "Read PTT" (`:222-228`, `:151-161`).
- Choosing either FT817 type always sets PTT to "Read PTT" (`:230-236`).
- Choosing "Full-duplex" with VFO "Not applicable" switches to "MAIN ↑ / SUB ↓". Choosing "Not applicable" while "Full-duplex" is selected switches back (`:239-244`, `:133-143`).

**Saving:**
- VFO Up/Down is stored only for "Full-duplex": index 1 → up Main / down Sub, 2 → up Sub / down Main, 3 → up A / down B, 4 → up B / down A, anything else → Main/Sub (`:546-577`).
- When editing, the combo index is derived from VFO Up only (Main → 1, Sub → 2, A → 3, anything else → 4) (`:93-104`).
- Frequencies are stored in Hz (MHz × 10⁶) (`:526-538`).
- There is no Cycle field. Cycle is set only in the Radio Control window.

**Values in a brand-new radio:**
- "Add new" opens the dialog with Default downlink **0.000** and Default uplink **123.456** MHz. The dialog's own initial values are used because the new configuration has no name yet (`:448-449`, `:464-466`, `:500-501`).
- "_Clear" sets: Name empty, Host "localhost", Port 4532, both LOs 0, both default frequencies **145.890**, type "RX only", PTT "None", VFO "Not applicable", all four signal boxes off (`:52-70`).

### 8.3 "Rotators" tab (`sat-pref-rot.c`)

| # | Column title | Cell text | Cite |
|---|---|---|---|
| 1 | "Config Name" | name | `:449-454` |
| 2 | "Host" | text | `:457-461` |
| 3 | "Port" | integer | `:464-468` |
| 4–7 | "Min Az", "Max Az", "Min El", "Max El" | `%.0f°` | `:471-509`, `:375-391` |
| 8 | "Azimuth Type" | "0° → 180° → 360°" or "-180° → 0° → +180°" (not translatable), else "Unknown (%d)" | `:512-520`, `:402-434` |

- The az stop position is kept per row but has no column (`sat-pref-rot-data.h:40-42`, `sat-pref-rot.c:253-262`).
- The table is sorted by name. Double-click edits (connected once) (`:263-265`, `:522-523`).

| Button | Tooltip | Behaviour | Cite |
|---|---|---|---|
| "Add New" | "Add a new rotator" | Editor with defaults | `:344-346`, `:43-88` |
| "Edit" | "Edit selected rotator" | Without a selection: "Select the rotator you want to edit\nand try again!" | `:348-350`, `:90-184` |
| "Delete" | "Delete selected rotator" | No confirmation. Without a selection: "Select the rotator you want to delete\nand try again!" | `:352-354`, `:186-228` |

### 8.4 Rotator editor dialog (`sat-pref-rot-editor.c`)

- **Title** "Edit rotator configuration". **Buttons** "_Clear", "_Cancel", "_Ok". Same OK-enable and name rules as the radio editor (`:349-392`, `:92-131`).

| Row | Label | Widget, range, default | Tooltip | Cite |
|---|---|---|---|---|
| 0 | "Name" | entry, max 25 | "Enter a short name for this configuration,  e.g. ROTOR-1.\nAllowed characters: 0..9, a..z, A..Z, - and _" (two spaces) | `:171-186` |
| 1 | "Host" | entry, max 50, default "localhost" | "Enter the host where rotctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\nIf gpredict and rotctld are running on the same computer, use localhost" | `:189-202` |
| 2 | "Port" | spin 1024–65535, default 4533. Stored ports ≤ 1023 are shown as 4533 | "Enter the port number where rotctld is listening. Default is 4533." | `:205-215`, `:58-61` |
| 3 | horizontal separator | | | `:217-219` |
| 4 | "Az type" | combo "0° → 180° → 360°" / "-180° → 0° → +180°" (not translatable), default the first | "Select your azimuth range here. Note that gpredict assumes that 0° is at North and + direction is clockwise for both types" | `:222-238` |
| 5 | " Min Az" / " Max Az" (leading space) | spins −200…100 (default 0) and 0…450 (default 360), step 1, whole degrees, no wrap | – | `:241-257` |
| 6 | " Min El" / " Max El" | spins −10…180 (default 0) and −10…180 (default 90) | – | `:259-275` |
| 7 | " Azimuth end stop position" (spans cols 1–2) | spin −180…360, default 0 | "Set the position of the azimuth end stop here, where 0° is at North, -180° is south, etc. The default for a 0° → 180° → 360° rotor is 0°, and the default for a -180° → 0° → +180° rotor is -180°." | `:277-293` |

- **Changing Az type** presets Min Az / Max Az / end stop: 0 / 360 / 0 for the first type and −180 / +180 / −180 for the second (`:133-158`).
- **Validation:** none for Min < Max (`:304-334`).
- **"_Clear"** restores: Host "localhost", Port 4533, the first Az type, 0 / 360 / 0 / 90, end stop 0 (`:74-85`).

### 8.5 What OK in Preferences writes

| Step | Behaviour | Cite |
|---|---|---|
| Radios | **Every** `*.rig` in hwconf is deleted, then one file is written per table row | `sat-pref-rig.c:870-962` |
| Rotators | **Every** `*.rot` is deleted, then one file is written per row | `sat-pref-rot.c:558-641` |
| Side effect (code observation) | The table has no Cycle or Threshold column, so the rewrite stores Cycle = 0 for radios and rotators, and Threshold = 0 for rotators. On the next read these are raised to the minimums: **10 ms** cycle and **0.1°** threshold. A previously saved Cycle/Threshold is lost | `sat-pref-rig.c:880-896`; `radio-conf.c:136-137`, `:326-329`; `sat-pref-rot.c:568-578`; `rotor-conf.c:130-131`, `:150-151`, `:253-261` |

## 9. Config files

### 9.1 `USER_CONF_DIR/hwconf/<name>.rig`, key-file group "Radio" (`radio-conf.c:36-51`)

| Key | Type | Meaning | If missing on read | Written | Cite |
|---|---|---|---|---|---|
| Host | string | rigctld host | read fails | always | `:101-110`, `:317` |
| Port | integer | rigctld port | read fails | always | `:112-121`, `:318` |
| Cycle | integer (ms) | controller cycle | 1000. Values < 10 become 10 | only when ≠ 1000 | `:123-142`, `:326-329` |
| LO | double (Hz) | downconverter LO | 0 | always | `:144-161`, `:319` |
| LO_UP | double (Hz) | upconverter LO | 0 | always | `:163-180`, `:320` |
| DefaultUplinkFreqHz | double (Hz) | default uplink | 145 890 000 | always | `:182-200`, `:321` |
| DefaultDownlinkFreqHz | double (Hz) | default downlink | 145 890 000 | always | `:202-220`, `:322` |
| Type | integer | 0 RX only, 1 TX only, 2 Half-duplex, 3 Full-duplex, 4 FT817 auto, 5 FT817 manual | read fails | always | `:222-232`, `:323`; `radio-conf.h:36-43` |
| PTT | integer | 0 None, 1 Read PTT (CAT), 2 Read DCD | read fails | always | `:234-244`, `:324`; `radio-conf.h:45-49` |
| VFO_DOWN / VFO_UP | integer | 0 none, 1 A, 2 B, 3 Main, 4 Sub | read only when Type = 3. A parse error gives Sub / Main | only when Type = 3 | `:246-278`, `:331-335`; `radio-conf.h:51-57` |
| SIGNAL_AOS, SIGNAL_LOS, SIGNAL_AOIQ, SIGNAL_LOIQ | boolean | signalling flags | false | always | `:280-284`, `:337-340` |

A failed read is logged "%s: Error reading radio conf from %s (%s)." (`:104-106`).

### 9.2 `USER_CONF_DIR/hwconf/<name>.rot`, group "Rotator" (`rotor-conf.c:37-50`)

| Key | Type | If missing on read | Written | Cite |
|---|---|---|---|---|
| Host, Port | string, integer | read fails | always | `:95-115`, `:244-245` |
| Cycle | integer (ms) | 1000. Values < 10 become 10 | only when ≠ 1000 | `:117-136`, `:253-256` |
| Threshold | double (°) | 5.0. Values < 0.1 become 0.1 | only when ≠ 5.0 | `:138-156`, `:258-261` |
| AzType | integer: 0 = 0…360, 1 = −180…+180 | 0. Info log "%s: Az type not defined for %s. Assuming 0..360°" | always | `:158-167`, `:246`; `rotor-conf.h:36-39` |
| MinAz / MaxAz | double | 0 / 360 (info log) | always | `:169-187`, `:247-248` |
| MinEl / MaxEl | double | 0 / 90 (info log) | always | `:189-207`, `:249-250` |
| AzStopPos | double | equal to MinAz (info log "%s: AzStopPos not defined for %s. Assuming at minaz (%f°).") | always | `:209-217`, `:251` |

### 9.3 Who writes these files

| Writer | What | Cite |
|---|---|---|
| Preferences OK | All files rewritten from the tables (§8.5) | `sat-pref-rig.c:870-962`, `sat-pref-rot.c:558-641` |
| Closing Radio Control | Device 1's file, with the current Cycle | `gtk-rig-ctrl.c:120-127` |
| Closing Antenna Control | The selected rotator's file, with the current Cycle and Threshold | `gtk-rot-ctrl.c:1622-1630` |

## 10. Transponder data

### 10.1 File and model

- **File:** `USER_CONF_DIR/trsp/<catnum>.trsp`. It is a key file with **one group per transponder**; the group name is the transponder name. The directory is created at start-up if missing (`trsp-conf.c:85-86`, `compat.c:369-379`, `first-time.c:772-806`).
- `--clean-trsp` ("Clean the transponder data in user's configuration directory") deletes all `*.trsp` at start-up (`main.c:58-59`, `:138-139`, `:642-677`).

| Field (model) | Key | Type | If missing | Cite |
|---|---|---|---|---|
| name | (group name) | string | – | `trsp-conf.h:34`, `trsp-conf.c:126` |
| uplow / uphigh | UP_LOW / UP_HIGH | int64 Hz | 0 | `trsp-conf.c:128-143` |
| downlow / downhigh | DOWN_LOW / DOWN_HIGH | int64 Hz | 0 | `:145-161` |
| invert | INVERT | boolean | false | `:166-174` |
| mode | MODE | string | none | `:176-182` |
| baud | BAUD | double | 0 | `:184-190` |

Reading rules:
- Every missing key is logged at info level "%s: Could not read %s from %s:'%s'. Using default." (`trsp-conf.c:83`).
- **Frequency normalisation:** negative values become 0. If only one of DOWN_LOW / DOWN_HIGH is set, the other copies it; the same applies to UP (`trsp-conf.c:44-65`). A beacon is a transponder with no uplink and DOWN_LOW = DOWN_HIGH (`trsp-conf.h:32`).
- **Order:** transponders keep the group order of the file (`trsp-conf.c:103-194`).
- **Missing file:** error log "%s: Error reading %s: %s" and an empty list (`:89-100`). A file with no groups logs "%s: %s contains 0 transponders" (`:106-112`).

### 10.2 Display in Satellite Info → "Transponders" (`sat-info.c:59-189`)

- With no transponders the tab shows "No transponders" (`:70-73`).
- Otherwise a scrolled list. For each transponder:
  1. a blank line;
  2. the **bold** name and a separator;
  3. "Uplink: %.4f ‒ %.4f MHz" (the dash is U+2012) when UP_HIGH > UP_LOW, else "Uplink: %.4f MHz", shown only when UP_LOW > 0;
  4. "Downlink: …" with the same rules;
  5. "Inverting: %s" with "YES"/"NO", shown only when both up and down are ranges;
  6. "Mode: %s" if a mode is set;
  7. "Baudrate: %9.2f" if the baud rate is non-zero (`:84-177`).

### 10.3 Use by the radio controller

| Topic | Behaviour | Cite |
|---|---|---|
| List | Read again on every satellite change. The combo shows the names in file order. With no file the combo is empty and "T"/"L" do nothing | `gtk-rig-ctrl.c:568-625`, `:724-725` |
| Default choice | The first transponder | `:623-624` |
| Fields used | DOWN/UP limits (tune, lock) and INVERT (lock). MODE and BAUD are not used (§3.3) | `:343-389`, `:717-748` |
| After a transponder update | An open controller keeps its old list until a satellite is chosen again (only the satellite change re-reads the file) | `:663-691` |

`write_transponders` exists but has no caller in v2.7. It would write MODE with the transponder *name* (`trsp-conf.c:214-275`, `:255-256`).

## 11. "Update transponder data" (SatNOGS DB)

### 11.1 Menu and dialog (`menubar.c`)

| Element | Text / behaviour | Cite |
|---|---|---|
| Menu item | Edit → "Update transponder data" | `menubar.c:914-917` |
| Dialog | Title "Transponder Update", modal, a single button "_Close" that is greyed out until the update ends | `:515-521`, `:570-571` |
| Static label | "<b>Updating transponder files from network</b>" | `:528-532` |
| Activity label | "..." → "Fetching transmitters.json" (the file name is fixed) → "Finished" | `:535-537`; `trsp-update.c:594-606`; `menubar.c:567` |
| Progress bar | Jumps to 100 % once the download ends (a code comment says 50 %), and is set to 100 % again at the end | `trsp-update.c:661-674`; `menubar.c:565` |
| Statistics label | Initially "\n" and **never updated**. There are no counters for transponders (unlike the TLE update) | `menubar.c:544-545`; `trsp-update.c:553` |
| Afterwards | All modules reload their satellites | `menubar.c:574` |
| Already running | A second start logs "%s: A frequency update process is already running" and returns | `trsp-update.c:556-562` |
| "Finished" on failure | "Finished" is shown even if the download failed. Errors are log only | `menubar.c:562-567` |

### 11.2 Network

| Item | Value | Cite |
|---|---|---|
| Server | `https://db.satnogs.org/api/` (config TRSP/SERVER) | `sat-cfg.c:228` |
| Modes URL | server + `modes/?format=json` (TRSP/MODE_FILE) | `sat-cfg.c:230`; `trsp-update.c:432` |
| Transmitters URL | server + `transmitters/?format=json` (TRSP/FREQ_FILE) | `sat-cfg.c:229`; `trsp-update.c:585` |
| Proxy | TRSP/PROXY, default none | `sat-cfg.c:231`; `trsp-update.c:576-577` |
| HTTP | libcurl, User-Agent "gpredict/curl", connect timeout 10 s. On Windows a built-in fetcher with "gpredict/win32" | `trsp-update.c:423-427`, `:579-580`, `:620` |
| Order | Modes first, then transmitters | `trsp-update.c:565`, `:569-591` |
| Cache files | `USER_CONF_DIR/trsp/modes.json` and `USER_CONF_DIR/trsp/transmitters.json`. Both are truncated before the download, so a failed download leaves them empty | `trsp-update.c:441-447`, `:611-616` |
| No UI | Server, file names and proxy have no Preferences control. The auto-update frequency names ("Never", "Monthly", "Weekly", "Daily") exist but are unused | grep `SAT_CFG_STR_TRSP`; `trsp-update.c:55-62`, `:728-743` |
| Log | "%s: Ready to fetch transponder list from %s", "%s: Successfully fetched %s", "%s: Error fetching %s (%s)", "%s: Fetched %d files from network; updating...", "%s: Could not fetch frequency files from network" | `trsp-update.c:588-590`, `:646`, `:641`, `:690`, `:700` |

### 11.3 JSON → `.trsp` mapping (`trsp-update.c:142-396`)

- `LC_NUMERIC` is switched to "C" (globally) before parsing (`:163-164`).
- **modes.json:** an array of objects. `id` → mode number, `name` → mode name. Objects without `name` are skipped. Each mode is logged "MODE %d %s" (`:196-234`).
- **transmitters.json:** an array of objects, one per transmitter (`:263-386`).

| JSON field | Use | Written as | Cite |
|---|---|---|---|
| `description` | transponder name (cut to 79 characters). Objects without it are **skipped** | group header `[<description>]`, preceded by an empty line | `:276-283`, `:359` |
| `norad_cat_id` | target file `<catnum>.trsp` | – | `:284-285`, `:323-327` |
| `uplink_low` / `uplink_high` | Hz | `UP_LOW=` / `UP_HIGH=`, only if > 0 | `:286-289`, `:360-365` |
| `downlink_low` / `downlink_high` | Hz | `DOWN_LOW=` / `DOWN_HIGH=`, only if > 0 | `:290-293`, `:366-371` |
| `mode_id` | looked up in modes.json. The mode *name* (cut to **19** characters) if found, else the number as text | `MODE=` (always written) | `:295-302`, `:372` |
| `invert` | non-zero means inverting | `INVERT=true`, only if inverting | `:304-305`, `:375-376` |
| `baud` | number | `BAUD=%.0f`, only if > 0 | `:306`, `:373-374` |
| `alive` | read but **not used** (dead transmitters are written too) | – | `:307-308` |
| `uuid` | not used | – | `:310` |

File handling:
- The first time a catalogue number is met in this run, its old `.trsp` is deleted. If it did not exist, "%s: Failed to remove %s" is still logged. Its transmitters are then appended in JSON order (`:332-385`).
- **Satellites that are absent from the download keep their old file.** There is no per-satellite count and no summary.
- Two transmitters of the same satellite with the same description produce two groups with the same name. How the key-file reader merges them is **UNVERIFIED**.
- Open errors are logged "%s: Could not open trsp file for write" (`:379-385`).

## 12. Configuration defaults involved (`sat-cfg.c`)

| Key | Default | Cite |
|---|---|---|
| TRSP / SERVER | `https://db.satnogs.org/api/` | `sat-cfg.c:228` |
| TRSP / FREQ_FILE | `transmitters/?format=json` | `:229` |
| TRSP / MODE_FILE | `modes/?format=json` | `:230` |
| TRSP / PROXY | none | `:231` |

There are no global radio or rotator settings in `sat-cfg.c`. Everything is per device file (§9). The rotator window's polar plot reuses the Polar View orientation, "QTH Info" setting and colours (main reference §6) (`gtk-polar-plot.c:730-741`).

## 13. Code observations and corrections

**Corrections to the main reference:**
- §11 "Interfaces → Radios": all 15 columns are visible by default. No column is hidden (`sat-pref-rig.c:521-676`, no visibility call). This replaces that row's **UNVERIFIED** note.
- §2 item 9: the "Configure" block dialog has no window title and no parent window, unlike the two "ERROR" boxes (`gtk-sat-module-popup.c:64-71`).

**Behaviour a faithful re-implementation must reproduce or consciously fix:**

| # | Observation | Cite |
|---|---|---|
| 1 | Preferences OK resets every radio's and rotator's Cycle to 10 ms, and every rotator's Threshold to 0.1° (§8.5) | `sat-pref-rig.c:880-946`; `sat-pref-rot.c:568-625` |
| 2 | Double-clicking a radio row opens the editor twice | `sat-pref-rig.c:653-654`, `:678-679` |
| 3 | "Add new" radio defaults to downlink 0 MHz and uplink 123.456 MHz. "_Clear" uses 145.890 MHz for both | `sat-pref-rig-editor.c:448-449`, `:466`, `:59-60` |
| 4 | Radio LO spins accept whole MHz only | `sat-pref-rig-editor.c:412-414`, `:430-432` |
| 5 | The rig controller sets PTT with a trailing `q⏎` | `gtk-rig-ctrl.c:2435-2448` |
| 6 | The secondary radio's commands use the primary's VFO-option flag | `gtk-rig-ctrl.c:2554`, `:2207` |
| 7 | FT817 split commands send a VFO number that is not loaded from the file for those types | `gtk-rig-ctrl.c:2599-2604`; `radio-conf.c:247` |
| 8 | The rig socket has no read timeout. An unresolvable host is used without a check. A failed connect is retried every cycle until 5 errors disengage the radio | `gtk-rig-ctrl.c:1495`, `:2895-2896`, `:3077-3078` |
| 9 | Rig cycle requests queue up instead of being skipped when rigctld is slow | `gtk-rig-ctrl.c:3208-3217`, `:3060-3063` |
| 10 | "2. Device" lists radios in directory order, while "1. Device" is sorted | `gtk-rig-ctrl.c:1313-1334` vs `:1366-1384` |
| 11 | The rotator client polls on its own fixed ≥ 0.8 s loop, independent of "Cycle" | `gtk-rot-ctrl.c:437-453` |
| 12 | An unreachable rotctld shows no error: Read shows 0.00° and the button stays engaged | `gtk-rot-ctrl.c:404-407` |
| 13 | For "−180…+180" rotators, negative targets always exceed the threshold (the comparison mixes 0–360 and ±180) | `gtk-rot-ctrl.c:863-867`, `:900-901` |
| 14 | With a target below the horizon and no usable pass, the rotator set-point is Az 0°, El 45° | `gtk-rot-ctrl.c:780`, `:800-815` |
| 15 | The rotator "Monitor" sensitivity is updated only on Track toggles | `gtk-rot-ctrl.c:757-768`, `:1189-1247` |
| 16 | On opening, the rotator control timer is registered twice: once when Cycle is loaded into the spin button, and once more at the end of construction. The first timer ID is overwritten, so the tick may run twice per cycle (**UNVERIFIED** at runtime) | `gtk-rot-ctrl.c:1138-1139`, `:1068-1080`, `:1734-1735` |
| 17 | The uplink "Doppler:" tooltip says "downlink". The radio-type tooltip mentions a "Monitor PTT status" check box that no longer exists | `gtk-rig-ctrl.c:534-537`; `sat-pref-rig-editor.c:321-331` |
| 18 | The radio type label differs between the table ("FT817/857/897 (man)") and the editor ("FT817/857/897 (manual)"). The PTT label differs between the table ("PTT", "DCD") and the editor ("Read PTT", "Read DCD") | `sat-pref-rig.c:226`, `:265-268`; `sat-pref-rig-editor.c:317`, `:365-366` |
| 19 | The transponder update has no counters, writes dead (`alive` = false) transmitters, keeps stale files of satellites no longer in the DB, and shows "Finished" even on failure | `trsp-update.c:307-308`, `:332-353`; `menubar.c:567` |
| 20 | Transponder mode names longer than 19 characters are cut off | `trsp-update.c:73`, `:299` |
