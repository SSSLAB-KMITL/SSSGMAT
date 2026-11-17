// Preferences → Interfaces (ref-R §8, spec §6): the cells of the Radios and Rotators tables, the forms of the two editors with their
// consistency rules, and the state of the page (which row is selected, which editor or message box is open, what OK would write).
// Pure; InterfacesPages.tsx, RadioEditor.tsx and RotatorEditor.tsx show it.

import { sanitizeModuleName } from "../moduleName";
import { roundTo } from "../spin";
import { compareNames } from "../views/cells";
import type { ControllerKind, HwConf, RadioConf, RotatorConf } from "./types";

// ---------------------------------------------------------------- codes of the .rig and .rot files (ref-R §9)

/** `Type` of a radio. */
const RX_ONLY = 0;
const HALF_DUPLEX = 2;
const FULL_DUPLEX = 3;
const FT817_AUTO = 4;
const FT817_MANUAL = 5;

/** `PTT` of a radio. */
const PTT_NONE = 0;
const PTT_READ = 1;

/** `VFO_UP` and `VFO_DOWN`. */
const VFO_A = 1;
const VFO_B = 2;
const VFO_MAIN = 3;
const VFO_SUB = 4;

/** What a new device starts with: the ports of rigctld and rotctld (ref-R §8.2, §8.4), and the Cycle and Threshold the server gives a new device. */
const RIG_PORT = 4532;
const ROT_PORT = 4533;
const CYCLE_DEFAULT_MS = 1000;
const THRESHOLD_DEFAULT_DEG = 5;

/** The longest name and host of the editors (ref-R §8.2). */
export const NAME_MAX = 25;
export const HOST_MAX = 50;

/** The ranges of the spin buttons of the editors (ref-R §8.2, §8.4): the same ranges the server checks. */
export const RANGES = {
  port: { min: 1024, max: 65535 },
  lo: { min: -10000, max: 10000 },
  freq: { min: 0, max: 10000 },
  minAz: { min: -200, max: 100 },
  maxAz: { min: 0, max: 450 },
  el: { min: -10, max: 180 },
  azStop: { min: -180, max: 360 },
} as const;

// ---------------------------------------------------------------- labels

/** The radio type combo of the editor. The table shows the last one as "(man)". */
export const RADIO_TYPE_LABELS = ["RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (manual)"] as const;
const RADIO_TYPE_CELLS = ["RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (man)"] as const;
export const PTT_LABELS = ["None", "Read PTT", "Read DCD"] as const;
const PTT_CELLS = ["None", "PTT", "DCD"] as const;
/** The VFO Up/Down combo; the arrows are Gpredict's (U+2191, U+2193). */
export const VFO_LABELS = ["Not applicable", "MAIN ↑ / SUB ↓", "SUB ↑ / MAIN ↓", "A ↑ / B ↓", "B ↑ / A ↓"] as const;
const VFO_CELLS: Readonly<Record<number, string>> = { [VFO_A]: "VFO A", [VFO_B]: "VFO B", [VFO_MAIN]: "Main", [VFO_SUB]: "Sub" };
/** The azimuth type combo and its column (not translatable in Gpredict). */
export const AZ_TYPE_LABELS = ["0° → 180° → 360°", "-180° → 0° → +180°"] as const;

export const RADIO_COLUMNS = [
  "Config Name",
  "Host",
  "Port",
  "Rig Type",
  "PTT Status",
  "VFO Up",
  "VFO Down",
  "LO Down",
  "LO Up",
  "Downlink",
  "Uplink",
  "Signal AOS",
  "Signal LOS",
  "Signal AOIQ",
  "Signal LOIQ",
] as const;

export const ROTATOR_COLUMNS = ["Config Name", "Host", "Port", "Min Az", "Max Az", "Min El", "Max El", "Azimuth Type"] as const;

/** `%.3f MHz` of a frequency in Hz. */
const mhz = (hz: number): string => `${(hz / 1e6).toFixed(3)} MHz`;

/** `%.0f`: C rounds a half to the even number (`toFixed` goes up). */
function printf0(x: number): string {
  const floor = Math.floor(x);
  const rest = x - floor;
  return String(rest < 0.5 ? floor : rest > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1);
}

const degrees = (x: number): string => `${printf0(x)}°`;
const yesNo = (on: boolean): string => (on ? "YES" : "NO");

/** The cells of a row of the Radios table, in the order of RADIO_COLUMNS (ref-R §8.1). */
export function radioCells(r: RadioConf): string[] {
  return [
    r.name,
    r.Host,
    String(r.Port),
    RADIO_TYPE_CELLS[r.Type] ?? "ERROR",
    PTT_CELLS[r.PTT] ?? "None",
    VFO_CELLS[r.VFO_UP ?? 0] ?? "-",
    VFO_CELLS[r.VFO_DOWN ?? 0] ?? "-",
    mhz(r.LO),
    mhz(r.LO_UP),
    mhz(r.DefaultDownlinkFreqHz),
    mhz(r.DefaultUplinkFreqHz),
    yesNo(r.SIGNAL_AOS),
    yesNo(r.SIGNAL_LOS),
    yesNo(r.SIGNAL_AOIQ),
    yesNo(r.SIGNAL_LOIQ),
  ];
}

/** The cells of a row of the Rotators table, in the order of ROTATOR_COLUMNS (ref-R §8.3). The azimuth end stop has no column. */
export function rotatorCells(r: RotatorConf): string[] {
  return [
    r.name,
    r.Host,
    String(r.Port),
    degrees(r.MinAz),
    degrees(r.MaxAz),
    degrees(r.MinEl),
    degrees(r.MaxEl),
    AZ_TYPE_LABELS[r.AzType] ?? `Unknown (${r.AzType})`,
  ];
}

// ---------------------------------------------------------------- tooltips

/** Gpredict's tooltips of the editors are Pango markup (<b> and <i>); a browser tooltip is plain text, so the tags go and the words stay. */
const plain = (markup: string): string => markup.replace(/<\/?[bi]>/g, "");

/** The tooltips of the radio editor (sat-pref-rig-editor.c). */
export const RADIO_TIPS = {
  name: "Enter a short name for this configuration, e.g. IC910-1.\nAllowed characters: 0..9, a..z, A..Z, - and _",
  host:
    "Enter the host where rigctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\n" +
    "If gpredict and rigctld are running on the same computer use localhost",
  port: "Enter the port number where rigctld is listening",
  type: plain(
    "<b>RX only:</b>  The radio shall only be used as receiver. If <i>Monitor PTT status</i> is checked the doppler tuning will be " +
      "suspended while PTT is ON (manual TX). If not, the controller will always perform doppler tuning and you cannot use the same " +
      "RIG for uplink.\n\n" +
      "<b>TX only:</b>  The radio shall only be used for uplink. If <i>Monitor PTT status</i> is checked the doppler tuning will be " +
      "suspended while PTT is OFF (manual RX).\n\n" +
      "<b>Half-duplex:</b>  The radio should be used for both up- and downlink but not at the same time. This option requires that " +
      "the PTT status is monitored (otherwise gpredict cannot know whether to tune the RX or the TX).\n\n" +
      "<b>Full-duplex:</b>  The radio is a full-duplex radio, such as the IC910H. Gpredict will be continuously tuning both uplink " +
      "and downlink simultaneously and not care about PTT setting.\n\n" +
      "<b>FT817/857/897 (auto):</b> This is a special mode that can be used with YAESU FT-817, 857 and 897 radios. These radios do " +
      "not allow computer control while in TX mode. Therefore, TX Doppler correction is applied while the radio is in RX mode by " +
      "toggling between VFO A/B.\n\n" +
      "<b>FT817/857/897 (manual):</b> This is similar to the previous mode except that switching to TX is done by pressing the SPACE " +
      "key on the keyboard. Gpredict will then update the TX Doppler before actually switching to TX.",
  ),
  ptt: plain(
    "Select PTT type.\n\n" +
      "<b>None:</b>\nDon't read PTT status from this radio.\n\n" +
      "<b>Read PTT:</b>\nRead PTT status using get_ptt CAT command. You have to check that your radio and hamlib supports this.\n\n" +
      "<b>Read DCD:</b>\nRead PTT status using get_dcd command. This can be used if your radio does not support the read_ptt CAT " +
      "command and you have a special interface that can read squelch status and send it via CTS.",
  ),
  vfo: plain(
    "Select which VFO to use for uplink and downlink. This setting is used for full-duplex radios only, such as the IC-910H, FT-847 " +
      "and the TS-2000.\n\n" +
      "<b>IC-910H:</b> MAIN↑ / SUB↓\n<b>FT-847:</b> SUB↑ / MAIN↓\n<b>TS-2000:</b> B↑ / A↓",
  ),
  lo: "Enter the frequency of the local oscillator  of the downconverter, if any.",
  loUp: "Enter the frequency of the local oscillator of the upconverter, if any.",
  defDown: "Enter the default downlink frequency",
  defUp: "Enter the default uplink frequency",
  aos: "Enable AOS signalling for this radio.",
  los: "Enable LOS signalling for this radio.",
  aoiq: "Enable AOIQ signalling (start IQ recording).",
  loiq: "Enable LOIQ signalling (stop IQ recording).",
} as const;

/** The tooltips of the rotator editor (sat-pref-rot-editor.c). The Min/Max spins have none. */
export const ROTATOR_TIPS = {
  name: "Enter a short name for this configuration,  e.g. ROTOR-1.\nAllowed characters: 0..9, a..z, A..Z, - and _",
  host:
    "Enter the host where rotctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\n" +
    "If gpredict and rotctld are running on the same computer, use localhost",
  port: "Enter the port number where rotctld is listening. Default is 4533.",
  azType: "Select your azimuth range here. Note that gpredict assumes that 0° is at North and + direction is clockwise for both types",
  azStop:
    "Set the position of the azimuth end stop here, where 0° is at North, -180° is south, etc. The default for a 0° → 180° → 360° " +
    "rotor is 0°, and the default for a -180° → 0° → +180° rotor is -180°.",
} as const;

/** The tooltips of the buttons under the tables (the rotator one says "Add New"). */
export const BUTTON_TIPS = {
  radio: { add: "Add a new radio to the list", edit: "Edit selected radio", delete: "Delete selected radio" },
  rotator: { add: "Add a new rotator", edit: "Edit selected rotator", delete: "Delete selected rotator" },
} as const;

/** The message box of Edit and Delete when no row is selected (sat-pref-rig.c, sat-pref-rot.c). */
export const selectMessage = (kind: ControllerKind, what: "edit" | "delete"): string =>
  `Select the ${kind} you want to ${what}\nand try again!`;

// ---------------------------------------------------------------- forms of the editors

/**
 * What the radio editor shows: the units of its widgets (frequencies in MHz, the VFO as an index of the combo). `cycle` is not a
 * widget (there is no Cycle field, ref-R §8.2): the radio's Cycle goes through the editor unchanged.
 */
export interface RadioForm {
  name: string;
  host: string;
  port: number;
  /** index of the radio type combo = `Type` */
  type: number;
  /** index of the PTT combo = `PTT` */
  ptt: number;
  /** index of the VFO Up/Down combo: 0 Not applicable, 1 MAIN/SUB, 2 SUB/MAIN, 3 A/B, 4 B/A */
  vfo: number;
  /** LO Down and LO Up: whole MHz */
  lo: number;
  loUp: number;
  /** default downlink and uplink: MHz with 3 decimals */
  defDown: number;
  defUp: number;
  aos: boolean;
  los: boolean;
  aoiq: boolean;
  loiq: boolean;
  cycle: number;
}

/** The radio editor of "Add new": the dialog's own initial values, so the default downlink is 0 and the default uplink 123.456 (ref-R §8.2). */
export const ADD_NEW_RADIO: RadioForm = {
  name: "",
  host: "localhost",
  port: RIG_PORT,
  type: RX_ONLY,
  ptt: PTT_NONE,
  vfo: 0,
  lo: 0,
  loUp: 0,
  defDown: 0,
  defUp: 123.456,
  aos: false,
  los: false,
  aoiq: false,
  loiq: false,
  cycle: CYCLE_DEFAULT_MS,
};

/** What Clear sets: the same, but both default frequencies 145.890 (ref-R §8.2). */
export const CLEAR_RADIO: RadioForm = { ...ADD_NEW_RADIO, defDown: 145.89, defUp: 145.89 };

/** Clear on the form of a radio: the fields go back, the Cycle that is not a field stays. */
export const clearRadioForm = (form: RadioForm): RadioForm => ({ ...CLEAR_RADIO, cycle: form.cycle });

export interface RotatorForm {
  name: string;
  host: string;
  port: number;
  /** index of the Az type combo = `AzType` */
  azType: number;
  minAz: number;
  maxAz: number;
  minEl: number;
  maxEl: number;
  azStop: number;
  /** not widgets: the rotator's Cycle and Threshold go through the editor unchanged */
  cycle: number;
  threshold: number;
}

/** A new rotator and Clear start from the same values (ref-R §8.4). */
export const ADD_NEW_ROTATOR: RotatorForm = {
  name: "",
  host: "localhost",
  port: ROT_PORT,
  azType: 0,
  minAz: 0,
  maxAz: 360,
  minEl: 0,
  maxEl: 90,
  azStop: 0,
  cycle: CYCLE_DEFAULT_MS,
  threshold: THRESHOLD_DEFAULT_DEG,
};

export const CLEAR_ROTATOR: RotatorForm = ADD_NEW_ROTATOR;

export const clearRotatorForm = (form: RotatorForm): RotatorForm => ({ ...CLEAR_ROTATOR, cycle: form.cycle, threshold: form.threshold });

// ---------------------------------------------------------------- consistency rules of the radio editor (ref-R §8.2)

/** The type was chosen: Half-duplex with PTT None gets Read PTT, both FT817 types always get Read PTT, Full-duplex with VFO Not applicable gets MAIN ↑ / SUB ↓. */
export function onTypeChange(form: RadioForm, type: number): RadioForm {
  let { ptt, vfo } = form;
  if (type === HALF_DUPLEX && ptt === PTT_NONE) ptt = PTT_READ;
  if (type === FT817_AUTO || type === FT817_MANUAL) ptt = PTT_READ;
  if (type === FULL_DUPLEX && vfo === 0) vfo = 1;
  return { ...form, type, ptt, vfo };
}

/** PTT was chosen: None while the type is Half-duplex goes back to Read PTT. */
export function onPttChange(form: RadioForm, ptt: number): RadioForm {
  return { ...form, ptt: ptt === PTT_NONE && form.type === HALF_DUPLEX ? PTT_READ : ptt };
}

/** VFO Up/Down was chosen: Not applicable while the type is Full-duplex goes back to MAIN ↑ / SUB ↓. */
export function onVfoChange(form: RadioForm, vfo: number): RadioForm {
  return { ...form, vfo: vfo === 0 && form.type === FULL_DUPLEX ? 1 : vfo };
}

/**
 * The index of the VFO Up/Down combo for a radio, from VFO Up only (Main 1, Sub 2, A 3, anything else 4). Gpredict's editor reads the
 * VFOs of a Full-duplex radio only; for any other the combo stays at Not applicable.
 */
export function vfoComboIndex(r: RadioConf): number {
  if (r.Type !== FULL_DUPLEX) return 0;
  return r.VFO_UP === VFO_MAIN ? 1 : r.VFO_UP === VFO_SUB ? 2 : r.VFO_UP === VFO_A ? 3 : 4;
}

/** The VFOs a combo index stands for; anything but 1 to 4 (Not applicable cannot be saved for Full-duplex) is Main / Sub. */
export function vfoFromCombo(index: number): { up: number; down: number } {
  switch (index) {
    case 2:
      return { up: VFO_SUB, down: VFO_MAIN };
    case 3:
      return { up: VFO_A, down: VFO_B };
    case 4:
      return { up: VFO_B, down: VFO_A };
    default:
      return { up: VFO_MAIN, down: VFO_SUB };
  }
}

// ---------------------------------------------------------------- consistency rule of the rotator editor (ref-R §8.4)

/** Min Az, Max Az and the azimuth end stop that choosing an Az type sets. */
export function azTypePreset(type: 0 | 1): { minAz: number; maxAz: number; azStop: number } {
  return type === 0 ? { minAz: 0, maxAz: 360, azStop: 0 } : { minAz: -180, maxAz: 180, azStop: -180 };
}

/** The Az type was chosen: it presets Min Az, Max Az and the end stop. */
export function onAzTypeChange(form: RotatorForm, type: 0 | 1): RotatorForm {
  return { ...form, azType: type, ...azTypePreset(type) };
}

// ---------------------------------------------------------------- names

/** What the name entry keeps of the text: 0..9, a..z, A..Z, - and _, at most 25 characters (the rule of module names). */
export const cleanName = sanitizeModuleName;

/** The name in `list` that `name` clashes with, ignoring case, not counting the row that is being edited (`editing`); null if none. */
export function findClash(list: readonly { name: string }[], name: string, editing: string | null): string | null {
  const lower = name.toLowerCase();
  return list.find((d) => d.name !== editing && d.name.toLowerCase() === lower)?.name ?? null;
}

export const nameClash = (list: readonly { name: string }[], name: string, editing: string | null): boolean => findClash(list, name, editing) !== null;

/** (ของเรา) Gpredict lets two devices have one name and the last wins; the server refuses it, so the editor says so before. */
export const clashText = (kind: ControllerKind, existing: string): string =>
  `${kind === "radio" ? "มีวิทยุ" : "มี rotator"} ชื่อ ${existing} อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)`;

/** (ของเรา) The server takes no empty Host, Gpredict's entry does. Null if the Host is fine. */
export const hostError = (host: string): string | null => (host === "" ? "ต้องใส่ Host" : null);

// ---------------------------------------------------------------- the editors and the devices

const toHz = (mhzValue: number, digits: number): number => Math.round(roundTo(mhzValue, digits) * 1e6) + 0;

/** The radio the editor's form makes: MHz are Hz again, the VFOs are kept for a Full-duplex radio only. */
export function editorToRadio(form: RadioForm): RadioConf {
  const r: RadioConf = {
    name: form.name,
    Host: form.host,
    Port: form.port,
    Cycle: form.cycle,
    LO: toHz(form.lo, 0),
    LO_UP: toHz(form.loUp, 0),
    DefaultUplinkFreqHz: toHz(form.defUp, 3),
    DefaultDownlinkFreqHz: toHz(form.defDown, 3),
    Type: form.type,
    PTT: form.ptt,
    SIGNAL_AOS: form.aos,
    SIGNAL_LOS: form.los,
    SIGNAL_AOIQ: form.aoiq,
    SIGNAL_LOIQ: form.loiq,
  };
  if (form.type === FULL_DUPLEX) {
    const { up, down } = vfoFromCombo(form.vfo);
    r.VFO_UP = up;
    r.VFO_DOWN = down;
  }
  return r;
}

/**
 * What the radio editor shows for a radio (update_widgets): a port of 1023 or less shows as 4532, the LOs as whole MHz, and PTT None of
 * a Half-duplex radio as Read PTT (the editor's rule runs on it).
 */
export function radioToEditor(r: RadioConf): RadioForm {
  return onPttChange(
    {
      name: r.name,
      host: r.Host,
      port: r.Port > 1023 ? r.Port : RIG_PORT,
      type: r.Type,
      ptt: r.PTT,
      vfo: vfoComboIndex(r),
      lo: roundTo(r.LO / 1e6, 0),
      loUp: roundTo(r.LO_UP / 1e6, 0),
      defDown: roundTo(r.DefaultDownlinkFreqHz / 1e6, 3),
      defUp: roundTo(r.DefaultUplinkFreqHz / 1e6, 3),
      aos: r.SIGNAL_AOS,
      los: r.SIGNAL_LOS,
      aoiq: r.SIGNAL_AOIQ,
      loiq: r.SIGNAL_LOIQ,
      cycle: r.Cycle,
    },
    r.PTT,
  );
}

/** The form the radio editor opens with: the radio named `editing`, or the dialog's own initial values (Add new) for null. */
export function radioFormFor(hw: HwConf, editing: string | null): RadioForm {
  const row = editing === null ? undefined : hw.radios.find((r) => r.name === editing);
  return row === undefined ? ADD_NEW_RADIO : radioToEditor(row);
}

export function editorToRotator(form: RotatorForm): RotatorConf {
  return {
    name: form.name,
    Host: form.host,
    Port: form.port,
    Cycle: form.cycle,
    Threshold: form.threshold,
    AzType: form.azType,
    MinAz: form.minAz,
    MaxAz: form.maxAz,
    MinEl: form.minEl,
    MaxEl: form.maxEl,
    AzStopPos: form.azStop,
  };
}

/** What the rotator editor shows for a rotator: a port of 1023 or less shows as 4533. */
export function rotatorToEditor(r: RotatorConf): RotatorForm {
  return {
    name: r.name,
    host: r.Host,
    port: r.Port > 1023 ? r.Port : ROT_PORT,
    azType: r.AzType,
    minAz: r.MinAz,
    maxAz: r.MaxAz,
    minEl: r.MinEl,
    maxEl: r.MaxEl,
    azStop: r.AzStopPos,
    cycle: r.Cycle,
    threshold: r.Threshold,
  };
}

/** The form the rotator editor opens with: the rotator named `editing`, or the default values for null. */
export function rotatorFormFor(hw: HwConf, editing: string | null): RotatorForm {
  const row = editing === null ? undefined : hw.rotators.find((r) => r.name === editing);
  return row === undefined ? ADD_NEW_ROTATOR : rotatorToEditor(row);
}

// ---------------------------------------------------------------- the page

/** The devices sorted by name as the tables are (ignoring case, numbers by value); the same name in another case comes in a fixed order. */
export function sortedByName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => compareNames(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The name of the row `delta` rows from `current` (stopping at the ends); with no row selected the first (down) or last (up). */
export function neighbour(names: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (names.length === 0) return null;
  const at = current === null ? -1 : names.indexOf(current);
  if (at < 0) return (delta > 0 ? names[0] : names[names.length - 1]) ?? null;
  return names[Math.max(0, Math.min(names.length - 1, at + delta))] ?? null;
}

const LIST = { radio: "radios", rotator: "rotators" } as const;

export interface InterfacesState {
  /** the devices the server had when the page was opened */
  original: HwConf;
  /** the devices as the window has them now (sorted by name): what OK writes */
  hw: HwConf;
  /** the selected row of each table, by name */
  selected: Record<ControllerKind, string | null>;
  /** the editor that is open: `editing` is the row it edits, null for "Add new". At most one editor. */
  editor: { kind: ControllerKind; editing: string | null } | null;
  /** the message box that waits for its OK */
  message: string | null;
}

export const initialState = (hw: HwConf): InterfacesState => ({
  original: hw,
  hw: { radios: sortedByName(hw.radios), rotators: sortedByName(hw.rotators) },
  selected: { radio: null, rotator: null },
  editor: null,
  message: null,
});

export type InterfacesAction =
  | { type: "select"; kind: ControllerKind; name: string }
  | { type: "add"; kind: ControllerKind }
  | { type: "edit"; kind: ControllerKind }
  /** a double click on a row (row-activated): selects it and edits it */
  | { type: "open"; kind: ControllerKind; name: string }
  | { type: "delete"; kind: ControllerKind }
  | { type: "saveRadio"; conf: RadioConf }
  | { type: "saveRotator"; conf: RotatorConf }
  /** Cancel of the editor */
  | { type: "cancel" }
  /** OK of the message box */
  | { type: "dismiss" };

/** `list` with `conf` in place of the row `editing` (appended for null), sorted. */
function replaceDevice<T extends { name: string }>(list: readonly T[], editing: string | null, conf: T): T[] {
  return sortedByName([...(editing === null ? list : list.filter((d) => d.name !== editing)), conf]);
}

/** The selection after an editor's Ok: an edited row stays selected under its new name; a new row is not selected (GTK adds a row to the list store without selecting it). */
function afterSave(selected: InterfacesState["selected"], kind: ControllerKind, editing: string | null, name: string): InterfacesState["selected"] {
  return editing === null ? selected : { ...selected, [kind]: name };
}

/**
 * The page: Add new, Edit, Delete and a double click as Gpredict's callbacks do them, except that a double click opens one editor (ref-R
 * §8.1: Gpredict connects its handler twice, so the editor opened a second time after the first closed). The editor and the message
 * box are modal: while one is open only its own answer (Ok, Cancel) does anything. Edit and Delete with an empty table do nothing
 * (Gpredict only logs an error), with a table and no selection they open the message box.
 */
export function interfacesReducer(s: InterfacesState, a: InterfacesAction): InterfacesState {
  switch (a.type) {
    case "dismiss":
      return s.message === null ? s : { ...s, message: null };
    case "cancel":
      return s.editor === null ? s : { ...s, editor: null };
    case "saveRadio":
      return s.editor?.kind !== "radio"
        ? s
        : {
            ...s,
            hw: { ...s.hw, radios: replaceDevice(s.hw.radios, s.editor.editing, a.conf) },
            selected: afterSave(s.selected, "radio", s.editor.editing, a.conf.name),
            editor: null,
          };
    case "saveRotator":
      return s.editor?.kind !== "rotator"
        ? s
        : {
            ...s,
            hw: { ...s.hw, rotators: replaceDevice(s.hw.rotators, s.editor.editing, a.conf) },
            selected: afterSave(s.selected, "rotator", s.editor.editing, a.conf.name),
            editor: null,
          };
  }
  if (s.editor !== null || s.message !== null) return s;

  const list: readonly { name: string }[] = s.hw[LIST[a.kind]];
  const chosen = s.selected[a.kind];
  switch (a.type) {
    case "select":
      return chosen === a.name || !list.some((d) => d.name === a.name) ? s : { ...s, selected: { ...s.selected, [a.kind]: a.name } };
    case "add":
      return { ...s, editor: { kind: a.kind, editing: null } };
    case "edit":
      if (list.length === 0) return s;
      return chosen === null ? { ...s, message: selectMessage(a.kind, "edit") } : { ...s, editor: { kind: a.kind, editing: chosen } };
    case "open":
      return list.some((d) => d.name === a.name)
        ? { ...s, selected: { ...s.selected, [a.kind]: a.name }, editor: { kind: a.kind, editing: a.name } }
        : s;
    case "delete":
      if (list.length === 0) return s;
      if (chosen === null) return { ...s, message: selectMessage(a.kind, "delete") };
      return {
        ...s,
        hw:
          a.kind === "radio"
            ? { ...s.hw, radios: s.hw.radios.filter((d) => d.name !== chosen) }
            : { ...s.hw, rotators: s.hw.rotators.filter((d) => d.name !== chosen) },
        selected: { ...s.selected, [a.kind]: null },
      };
  }
}

const sameDevice = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
};

const sameList = (a: readonly { name: string }[], b: readonly { name: string }[]): boolean =>
  a.length === b.length &&
  a.every((d) => {
    const other = b.find((e) => e.name === d.name);
    return other !== undefined && sameDevice(d, other);
  });

/** The devices differ from the ones the server had (a change that was undone is none). */
export const hwChanged = (original: HwConf, now: HwConf): boolean => !(sameList(original.radios, now.radios) && sameList(original.rotators, now.rotators));

/** What OK writes (PUT /api/hwconf, both lists), or null when the user has changed nothing and there is nothing to send. */
export const commitBody = (s: InterfacesState): HwConf | null => (hwChanged(s.original, s.hw) ? s.hw : null);
