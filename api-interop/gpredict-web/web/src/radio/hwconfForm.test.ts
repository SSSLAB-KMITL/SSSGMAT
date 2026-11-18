import { describe, expect, it } from "vitest";
import {
  ADD_NEW_RADIO,
  ADD_NEW_ROTATOR,
  azTypePreset,
  BUTTON_TIPS,
  CLEAR_RADIO,
  CLEAR_ROTATOR,
  cleanName,
  clashText,
  clearRadioForm,
  clearRotatorForm,
  commitBody,
  editorToRadio,
  editorToRotator,
  findClash,
  hostError,
  hwChanged,
  initialState,
  interfacesReducer,
  nameClash,
  neighbour,
  onAzTypeChange,
  onPttChange,
  onTypeChange,
  onVfoChange,
  RADIO_COLUMNS,
  RADIO_TIPS,
  radioCells,
  radioFormFor,
  radioToEditor,
  ROTATOR_COLUMNS,
  ROTATOR_TIPS,
  rotatorCells,
  rotatorFormFor,
  rotatorToEditor,
  selectMessage,
  sortedByName,
  vfoComboIndex,
  vfoFromCombo,
} from "./hwconfForm";
import type { InterfacesState } from "./hwconfForm";
import type { HwConf, RadioConf, RotatorConf } from "./types";

const RIG: RadioConf = {
  name: "IC910",
  Host: "localhost",
  Port: 4532,
  Cycle: 1000,
  LO: 0,
  LO_UP: 0,
  DefaultUplinkFreqHz: 145_890_000,
  DefaultDownlinkFreqHz: 145_890_000,
  Type: 3,
  PTT: 1,
  VFO_UP: 3,
  VFO_DOWN: 4,
  SIGNAL_AOS: true,
  SIGNAL_LOS: false,
  SIGNAL_AOIQ: false,
  SIGNAL_LOIQ: true,
};

/** a radio of a type that has no VFO keys */
const RX: RadioConf = (() => {
  const { VFO_UP: _up, VFO_DOWN: _down, ...rest } = RIG;
  return { ...rest, name: "RX1", Type: 0, PTT: 0 };
})();

const ROT: RotatorConf = {
  name: "ROTOR-1",
  Host: "localhost",
  Port: 4533,
  Cycle: 500,
  Threshold: 3,
  AzType: 0,
  MinAz: 0,
  MaxAz: 360,
  MinEl: 0,
  MaxEl: 90,
  AzStopPos: 0,
};

describe("the Radios table (ref-R §8.1)", () => {
  it("has the 15 columns of Gpredict, in order", () => {
    expect(RADIO_COLUMNS).toEqual([
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
    ]);
  });

  it("radio table cells", () => {
    expect(radioCells(RIG)).toEqual([
      "IC910",
      "localhost",
      "4532",
      "Full-duplex",
      "PTT",
      "Main",
      "Sub",
      "0.000 MHz",
      "0.000 MHz",
      "145.890 MHz",
      "145.890 MHz",
      "YES",
      "NO",
      "NO",
      "YES",
    ]);
  });

  it("names the six radio types as the table does, FT817 manual as (man), and anything else ERROR", () => {
    const types = [0, 1, 2, 3, 4, 5, 6, -1].map((Type) => radioCells({ ...RIG, Type })[3]);
    expect(types).toEqual(["RX only", "TX only", "Half-duplex", "Full-duplex", "FT817/857/897 (auto)", "FT817/857/897 (man)", "ERROR", "ERROR"]);
    expect(radioCells({ ...RIG, Type: 5 })[3]).toBe("FT817/857/897 (man)");
  });

  it("shows PTT 1 as PTT, 2 as DCD, and None for 0 and for a code it does not know", () => {
    expect([0, 1, 2, 9].map((PTT) => radioCells({ ...RIG, PTT })[4])).toEqual(["None", "PTT", "DCD", "None"]);
  });

  it("shows the VFOs as VFO A, VFO B, Main, Sub, and a dash for none (also when the radio has no VFO keys)", () => {
    expect([1, 2, 3, 4, 0, 7].map((VFO_UP) => radioCells({ ...RIG, VFO_UP })[5])).toEqual(["VFO A", "VFO B", "Main", "Sub", "-", "-"]);
    expect(radioCells({ ...RIG, VFO_DOWN: 2 })[6]).toBe("VFO B");
    expect(radioCells(RX).slice(5, 7)).toEqual(["-", "-"]);
  });

  it("shows LO and the default frequencies in MHz with three decimals", () => {
    const cells = radioCells({ ...RIG, LO: 0, LO_UP: -125_000_000, DefaultDownlinkFreqHz: 435_123_456, DefaultUplinkFreqHz: 0 });
    expect(cells.slice(7, 11)).toEqual(["0.000 MHz", "-125.000 MHz", "435.123 MHz", "0.000 MHz"]);
  });

  it("shows each signal as YES or NO", () => {
    const all = radioCells({ ...RIG, SIGNAL_AOS: true, SIGNAL_LOS: true, SIGNAL_AOIQ: true, SIGNAL_LOIQ: true }).slice(11);
    const none = radioCells({ ...RIG, SIGNAL_AOS: false, SIGNAL_LOS: false, SIGNAL_AOIQ: false, SIGNAL_LOIQ: false }).slice(11);
    expect(all).toEqual(["YES", "YES", "YES", "YES"]);
    expect(none).toEqual(["NO", "NO", "NO", "NO"]);
  });
});

describe("the Rotators table (ref-R §8.3)", () => {
  it("has the 8 columns of Gpredict, in order", () => {
    expect(ROTATOR_COLUMNS).toEqual(["Config Name", "Host", "Port", "Min Az", "Max Az", "Min El", "Max El", "Azimuth Type"]);
  });

  it("rotator table cells", () => {
    expect(rotatorCells(ROT)).toEqual(["ROTOR-1", "localhost", "4533", "0°", "360°", "0°", "90°", "0° → 180° → 360°"]);
    expect(rotatorCells({ ...ROT, MinAz: -180, MaxAz: 180, MinEl: -10, AzType: 1 })).toEqual([
      "ROTOR-1",
      "localhost",
      "4533",
      "-180°",
      "180°",
      "-10°",
      "90°",
      "-180° → 0° → +180°",
    ]);
  });

  it("names the azimuth types, and Unknown (n) for another code", () => {
    expect([0, 1, 7].map((AzType) => rotatorCells({ ...ROT, AzType })[7])).toEqual(["0° → 180° → 360°", "-180° → 0° → +180°", "Unknown (7)"]);
  });

  it("writes the angles like %.0f: no decimals, a half goes to the even number", () => {
    const cells = rotatorCells({ ...ROT, MinAz: 0.5, MaxAz: 1.5, MinEl: 2.5, MaxEl: 89.6 });
    expect(cells.slice(3, 7)).toEqual(["0°", "2°", "2°", "90°"]);
  });
});

describe("a new radio and Clear (ref-R §8.2)", () => {
  it("add new radio defaults", () => {
    expect(ADD_NEW_RADIO).toMatchObject({ name: "", host: "localhost", port: 4532, type: 0, ptt: 0, vfo: 0, lo: 0, loUp: 0 });
    expect(ADD_NEW_RADIO.defDown).toBe(0);
    expect(ADD_NEW_RADIO.defUp).toBe(123.456);
    expect([ADD_NEW_RADIO.aos, ADD_NEW_RADIO.los, ADD_NEW_RADIO.aoiq, ADD_NEW_RADIO.loiq]).toEqual([false, false, false, false]);
  });

  it("clear radio values", () => {
    expect(CLEAR_RADIO).toMatchObject({
      name: "",
      host: "localhost",
      port: 4532,
      lo: 0,
      loUp: 0,
      defDown: 145.89,
      defUp: 145.89,
      type: 0,
      ptt: 0,
      vfo: 0,
      aos: false,
      los: false,
      aoiq: false,
      loiq: false,
    });
  });

  it("Clear keeps the Cycle that the editor does not show", () => {
    const form = { ...radioToEditor(RIG), cycle: 250, name: "X", host: "far" };
    expect(clearRadioForm(form)).toEqual({ ...CLEAR_RADIO, cycle: 250 });
  });

  it("a new rotator and Clear have the same values (ref-R §8.4)", () => {
    expect(ADD_NEW_ROTATOR).toMatchObject({ name: "", host: "localhost", port: 4533, azType: 0, minAz: 0, maxAz: 360, minEl: 0, maxEl: 90, azStop: 0 });
    expect(CLEAR_ROTATOR).toEqual(ADD_NEW_ROTATOR);
    const form = { ...rotatorToEditor(ROT), name: "X", azType: 1, minAz: -180 };
    expect(clearRotatorForm(form)).toEqual({ ...CLEAR_ROTATOR, cycle: 500, threshold: 3 });
  });
});

describe("consistency rules (ref-R §8.2)", () => {
  it("type and ptt rules", () => {
    // Half-duplex with PTT None switches PTT to Read PTT
    expect(onTypeChange({ ...ADD_NEW_RADIO, ptt: 0 }, 2)).toMatchObject({ type: 2, ptt: 1 });
    // a PTT that is not None stays
    expect(onTypeChange({ ...ADD_NEW_RADIO, ptt: 2 }, 2)).toMatchObject({ type: 2, ptt: 2 });
    // None while Half-duplex goes back to Read PTT
    expect(onPttChange({ ...ADD_NEW_RADIO, type: 2, ptt: 1 }, 0)).toMatchObject({ type: 2, ptt: 1 });
    expect(onPttChange({ ...ADD_NEW_RADIO, type: 2, ptt: 1 }, 2)).toMatchObject({ ptt: 2 });
    // None is fine for the other types
    expect(onPttChange({ ...ADD_NEW_RADIO, type: 0, ptt: 1 }, 0)).toMatchObject({ ptt: 0 });
    // both FT817 types always set Read PTT, even from Read DCD
    for (const type of [4, 5]) expect(onTypeChange({ ...ADD_NEW_RADIO, ptt: 0 }, type)).toMatchObject({ type, ptt: 1 });
    expect(onTypeChange({ ...ADD_NEW_RADIO, ptt: 2 }, 4)).toMatchObject({ ptt: 1 });
    // ... but choosing None afterwards is allowed (only Half-duplex forces Read PTT)
    expect(onPttChange({ ...ADD_NEW_RADIO, type: 5, ptt: 1 }, 0)).toMatchObject({ ptt: 0 });
    // other types leave PTT alone
    expect(onTypeChange({ ...ADD_NEW_RADIO, ptt: 0 }, 1)).toMatchObject({ type: 1, ptt: 0 });
  });

  it("Full-duplex with Not applicable switches to MAIN ↑ / SUB ↓, and Not applicable while Full-duplex goes back", () => {
    expect(onTypeChange({ ...ADD_NEW_RADIO, vfo: 0 }, 3)).toMatchObject({ type: 3, vfo: 1 });
    expect(onTypeChange({ ...ADD_NEW_RADIO, vfo: 3 }, 3)).toMatchObject({ type: 3, vfo: 3 });
    expect(onVfoChange({ ...ADD_NEW_RADIO, type: 3, vfo: 2 }, 0)).toMatchObject({ vfo: 1 });
    expect(onVfoChange({ ...ADD_NEW_RADIO, type: 3, vfo: 2 }, 4)).toMatchObject({ vfo: 4 });
    // another type may have Not applicable
    expect(onVfoChange({ ...ADD_NEW_RADIO, type: 0, vfo: 2 }, 0)).toMatchObject({ vfo: 0 });
  });

  it("vfo combo mapping", () => {
    // the combo → the VFOs stored for a Full-duplex radio
    expect(vfoFromCombo(1)).toEqual({ up: 3, down: 4 });
    expect(vfoFromCombo(2)).toEqual({ up: 4, down: 3 });
    expect(vfoFromCombo(3)).toEqual({ up: 1, down: 2 });
    expect(vfoFromCombo(4)).toEqual({ up: 2, down: 1 });
    expect(vfoFromCombo(0)).toEqual({ up: 3, down: 4 });
    // the VFOs → the combo, from VFO Up only: Main 1, Sub 2, A 3, anything else 4
    expect(vfoComboIndex({ ...RIG, VFO_UP: 3 })).toBe(1);
    expect(vfoComboIndex({ ...RIG, VFO_UP: 4 })).toBe(2);
    expect(vfoComboIndex({ ...RIG, VFO_UP: 1 })).toBe(3);
    expect(vfoComboIndex({ ...RIG, VFO_UP: 2 })).toBe(4);
    expect(vfoComboIndex({ ...RIG, VFO_UP: 0 })).toBe(4);
    // a radio that is not Full-duplex is shown with Not applicable (the editor only reads the VFOs of a Full-duplex radio)
    expect(vfoComboIndex({ ...RIG, Type: 2, VFO_UP: 3 })).toBe(0);
    expect(vfoComboIndex(RX)).toBe(0);
  });

  it("saves the VFOs of a Full-duplex radio only", () => {
    const duplex = (vfo: number) => editorToRadio({ ...ADD_NEW_RADIO, name: "R", type: 3, vfo });
    expect([1, 2, 3, 4].map((vfo) => [duplex(vfo).VFO_UP, duplex(vfo).VFO_DOWN])).toEqual([
      [3, 4],
      [4, 3],
      [1, 2],
      [2, 1],
    ]);
    for (const type of [0, 1, 2, 4, 5]) {
      const r = editorToRadio({ ...ADD_NEW_RADIO, name: "R", type, vfo: 3 });
      expect(r).not.toHaveProperty("VFO_UP");
      expect(r).not.toHaveProperty("VFO_DOWN");
    }
  });

  it("az type presets", () => {
    expect(azTypePreset(0)).toEqual({ minAz: 0, maxAz: 360, azStop: 0 });
    expect(azTypePreset(1)).toEqual({ minAz: -180, maxAz: 180, azStop: -180 });
    const f = onAzTypeChange({ ...ADD_NEW_ROTATOR, minEl: 5, maxEl: 80, minAz: 12 }, 1);
    expect(f).toMatchObject({ azType: 1, minAz: -180, maxAz: 180, azStop: -180, minEl: 5, maxEl: 80 });
    expect(onAzTypeChange(f, 0)).toMatchObject({ azType: 0, minAz: 0, maxAz: 360, azStop: 0 });
  });
});

describe("names", () => {
  it("name rules", () => {
    expect(cleanName("IC 910!")).toBe("IC910");
    expect(cleanName("a-b_C9")).toBe("a-b_C9");
    expect(cleanName("x".repeat(40))).toHaveLength(25);
    expect(cleanName("ก")).toBe("");
  });

  it("finds a clash without regard to case, and not with the one being edited", () => {
    const list = [{ name: "IC910" }, { name: "FT847" }];
    expect(nameClash(list, "ic910", null)).toBe(true);
    expect(findClash(list, "ic910", null)).toBe("IC910");
    expect(nameClash(list, "IC910", "IC910")).toBe(false); // it is the row that is being edited
    expect(nameClash(list, "ic910", "IC910")).toBe(false); // a change of case only
    expect(nameClash(list, "FT847", "IC910")).toBe(true); // another row
    expect(nameClash(list, "IC9100", null)).toBe(false);
    expect(nameClash(list, "", null)).toBe(false);
    expect(findClash(list, "new", null)).toBeNull();
  });

  it("says in Thai which device the name clashes with", () => {
    expect(clashText("radio", "IC910")).toBe("มีวิทยุ ชื่อ IC910 อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)");
    expect(clashText("rotator", "ROTOR-1")).toBe("มี rotator ชื่อ ROTOR-1 อยู่แล้ว (ชื่อไม่แยกตัวพิมพ์เล็กใหญ่)");
  });

  it("does not take an empty Host (the server refuses it): a Thai text", () => {
    expect(hostError("")).toMatch(/[฀-๿]/);
    expect(hostError("localhost")).toBeNull();
    expect(hostError(" ")).toBeNull();
  });
});

describe("the editors and the devices (ref-R §8.2, §8.4)", () => {
  it("LO is whole MHz", () => {
    expect(editorToRadio({ ...ADD_NEW_RADIO, name: "R", lo: 145.5, loUp: -10.4 })).toMatchObject({ LO: 146_000_000, LO_UP: -10_000_000 });
    expect(editorToRadio({ ...ADD_NEW_RADIO, name: "R", lo: 0, loUp: 0 })).toMatchObject({ LO: 0, LO_UP: 0 });
    // a file with an LO that is not whole MHz shows the whole MHz
    expect(radioToEditor({ ...RIG, LO: 125_400_000, LO_UP: 1_000_000 })).toMatchObject({ lo: 125, loUp: 1 });
  });

  it("writes MHz as Hz without the noise of floating point", () => {
    const r = editorToRadio({ ...ADD_NEW_RADIO, name: "R", defDown: 145.89, defUp: 123.456 });
    expect(r.DefaultDownlinkFreqHz).toBe(145_890_000);
    expect(r.DefaultUplinkFreqHz).toBe(123_456_000);
    expect(radioToEditor({ ...RIG, DefaultDownlinkFreqHz: 435_123_456, DefaultUplinkFreqHz: 0 })).toMatchObject({ defDown: 435.123, defUp: 0 });
  });

  it("a radio goes into the editor and out again unchanged", () => {
    expect(editorToRadio(radioToEditor(RIG))).toEqual(RIG);
    expect(editorToRadio(radioToEditor(RX))).toEqual(RX);
    const half: RadioConf = { ...RX, name: "HD", Type: 2, PTT: 2, Cycle: 40 };
    expect(editorToRadio(radioToEditor(half))).toEqual(half);
  });

  it("shows a port of 1023 or less as 4532 for a radio and 4533 for a rotator", () => {
    expect(radioToEditor({ ...RIG, Port: 1023 }).port).toBe(4532);
    expect(radioToEditor({ ...RIG, Port: 0 }).port).toBe(4532);
    expect(radioToEditor({ ...RIG, Port: 1024 }).port).toBe(1024);
    expect(rotatorToEditor({ ...ROT, Port: 80 }).port).toBe(4533);
    expect(rotatorToEditor({ ...ROT, Port: 4600 }).port).toBe(4600);
  });

  it("shows Read PTT for a Half-duplex radio stored with PTT None, as Gpredict's editor does (not for FT817)", () => {
    expect(radioToEditor({ ...RX, Type: 2, PTT: 0 }).ptt).toBe(1);
    expect(radioToEditor({ ...RX, Type: 5, PTT: 0 }).ptt).toBe(0);
    expect(radioToEditor({ ...RX, Type: 0, PTT: 2 }).ptt).toBe(2);
  });

  it("keeps the Cycle of a radio, and the Cycle and Threshold of a rotator (the server keeps the file's)", () => {
    expect(editorToRadio(radioToEditor({ ...RIG, Cycle: 250 })).Cycle).toBe(250);
    expect(editorToRadio({ ...ADD_NEW_RADIO, name: "N" }).Cycle).toBe(1000);
    const r = editorToRotator(rotatorToEditor(ROT));
    expect(r).toEqual(ROT);
    expect(editorToRotator({ ...ADD_NEW_ROTATOR, name: "N" })).toMatchObject({ Cycle: 1000, Threshold: 5 });
  });

  it("opens the editor with the row that is edited, or with the defaults of Add new", () => {
    const hw: HwConf = { radios: [RIG], rotators: [ROT] };
    expect(radioFormFor(hw, null)).toBe(ADD_NEW_RADIO);
    expect(radioFormFor(hw, "IC910")).toEqual(radioToEditor(RIG));
    expect(radioFormFor(hw, "GONE")).toBe(ADD_NEW_RADIO);
    expect(rotatorFormFor(hw, null)).toBe(ADD_NEW_ROTATOR);
    expect(rotatorFormFor(hw, "ROTOR-1")).toEqual(rotatorToEditor(ROT));
  });

  it("a rotator goes into the editor and out again", () => {
    const wide: RotatorConf = { ...ROT, AzType: 1, MinAz: -180, MaxAz: 180, MinEl: -10, MaxEl: 180, AzStopPos: -180 };
    expect(rotatorToEditor(wide)).toMatchObject({ azType: 1, minAz: -180, maxAz: 180, minEl: -10, maxEl: 180, azStop: -180 });
    expect(editorToRotator(rotatorToEditor(wide))).toEqual(wide);
  });
});

describe("the tooltips and buttons", () => {
  it("has the tooltips of the radio editor word for word (markup of the Gpredict tooltips removed)", () => {
    expect(RADIO_TIPS.name).toBe("Enter a short name for this configuration, e.g. IC910-1.\nAllowed characters: 0..9, a..z, A..Z, - and _");
    expect(RADIO_TIPS.host).toBe(
      "Enter the host where rigctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\nIf gpredict and rigctld are running on the same computer use localhost",
    );
    expect(RADIO_TIPS.port).toBe("Enter the port number where rigctld is listening");
    expect(RADIO_TIPS.type).toBe(
      "RX only:  The radio shall only be used as receiver. If Monitor PTT status is checked the doppler tuning will be suspended while PTT is ON (manual TX). If not, the controller will always perform doppler tuning and you cannot use the same RIG for uplink.\n\n" +
        "TX only:  The radio shall only be used for uplink. If Monitor PTT status is checked the doppler tuning will be suspended while PTT is OFF (manual RX).\n\n" +
        "Half-duplex:  The radio should be used for both up- and downlink but not at the same time. This option requires that the PTT status is monitored (otherwise gpredict cannot know whether to tune the RX or the TX).\n\n" +
        "Full-duplex:  The radio is a full-duplex radio, such as the IC910H. Gpredict will be continuously tuning both uplink and downlink simultaneously and not care about PTT setting.\n\n" +
        "FT817/857/897 (auto): This is a special mode that can be used with YAESU FT-817, 857 and 897 radios. These radios do not allow computer control while in TX mode. Therefore, TX Doppler correction is applied while the radio is in RX mode by toggling between VFO A/B.\n\n" +
        "FT817/857/897 (manual): This is similar to the previous mode except that switching to TX is done by pressing the SPACE key on the keyboard. Gpredict will then update the TX Doppler before actually switching to TX.",
    );
    expect(RADIO_TIPS.ptt).toBe(
      "Select PTT type.\n\nNone:\nDon't read PTT status from this radio.\n\nRead PTT:\nRead PTT status using get_ptt CAT command. You have to check that your radio and hamlib supports this.\n\n" +
        "Read DCD:\nRead PTT status using get_dcd command. This can be used if your radio does not support the read_ptt CAT command and you have a special interface that can read squelch status and send it via CTS.",
    );
    expect(RADIO_TIPS.vfo).toBe(
      "Select which VFO to use for uplink and downlink. This setting is used for full-duplex radios only, such as the IC-910H, FT-847 and the TS-2000.\n\nIC-910H: MAIN↑ / SUB↓\nFT-847: SUB↑ / MAIN↓\nTS-2000: B↑ / A↓",
    );
    expect(RADIO_TIPS.lo).toBe("Enter the frequency of the local oscillator  of the downconverter, if any.");
    expect(RADIO_TIPS.loUp).toBe("Enter the frequency of the local oscillator of the upconverter, if any.");
    expect(RADIO_TIPS.defDown).toBe("Enter the default downlink frequency");
    expect(RADIO_TIPS.defUp).toBe("Enter the default uplink frequency");
    expect(RADIO_TIPS.aos).toBe("Enable AOS signalling for this radio.");
    expect(RADIO_TIPS.los).toBe("Enable LOS signalling for this radio.");
    expect(RADIO_TIPS.aoiq).toBe("Enable AOIQ signalling (start IQ recording).");
    expect(RADIO_TIPS.loiq).toBe("Enable LOIQ signalling (stop IQ recording).");
  });

  it("has the tooltips of the rotator editor word for word", () => {
    expect(ROTATOR_TIPS.name).toBe("Enter a short name for this configuration,  e.g. ROTOR-1.\nAllowed characters: 0..9, a..z, A..Z, - and _");
    expect(ROTATOR_TIPS.host).toBe(
      "Enter the host where rotctld is running. You can use both host name and IP address, e.g. 192.168.1.100\n\nIf gpredict and rotctld are running on the same computer, use localhost",
    );
    expect(ROTATOR_TIPS.port).toBe("Enter the port number where rotctld is listening. Default is 4533.");
    expect(ROTATOR_TIPS.azType).toBe(
      "Select your azimuth range here. Note that gpredict assumes that 0° is at North and + direction is clockwise for both types",
    );
    expect(ROTATOR_TIPS.azStop).toBe(
      "Set the position of the azimuth end stop here, where 0° is at North, -180° is south, etc. The default for a 0° → 180° → 360° rotor is 0°, and the default for a -180° → 0° → +180° rotor is -180°.",
    );
  });

  it("has the tooltips of the buttons", () => {
    expect(BUTTON_TIPS.radio).toEqual({ add: "Add a new radio to the list", edit: "Edit selected radio", delete: "Delete selected radio" });
    expect(BUTTON_TIPS.rotator).toEqual({ add: "Add a new rotator", edit: "Edit selected rotator", delete: "Delete selected rotator" });
  });

  it("has the message boxes of Edit and Delete without a selection", () => {
    expect(selectMessage("radio", "edit")).toBe("Select the radio you want to edit\nand try again!");
    expect(selectMessage("radio", "delete")).toBe("Select the radio you want to delete\nand try again!");
    expect(selectMessage("rotator", "edit")).toBe("Select the rotator you want to edit\nand try again!");
    expect(selectMessage("rotator", "delete")).toBe("Select the rotator you want to delete\nand try again!");
  });
});

describe("sorting and the keys on the table", () => {
  it("sorts the devices by name, ignoring case and with numbers by value", () => {
    const list = [{ name: "b2" }, { name: "A10" }, { name: "a9" }, { name: "B1" }];
    expect(sortedByName(list).map((d) => d.name)).toEqual(["a9", "A10", "B1", "b2"]);
    expect(list.map((d) => d.name)).toEqual(["b2", "A10", "a9", "B1"]); // not changed
  });

  it("moves the selection by one row and stops at the ends; with none it starts at an end", () => {
    const names = ["A", "B", "C"];
    expect(neighbour(names, "A", 1)).toBe("B");
    expect(neighbour(names, "C", 1)).toBe("C");
    expect(neighbour(names, "B", -1)).toBe("A");
    expect(neighbour(names, "A", -1)).toBe("A");
    expect(neighbour(names, null, 1)).toBe("A");
    expect(neighbour(names, null, -1)).toBe("C");
    expect(neighbour([], null, 1)).toBeNull();
  });
});

const HW: HwConf = { radios: [RIG, RX], rotators: [ROT] };

/** apply the actions in turn */
function run(state: InterfacesState, ...actions: Parameters<typeof interfacesReducer>[1][]): InterfacesState {
  return actions.reduce(interfacesReducer, state);
}

describe("the page", () => {
  const start = () => initialState(HW);

  it("starts with the devices sorted by name, nothing selected, nothing open", () => {
    const s = start();
    expect(s.hw.radios.map((r) => r.name)).toEqual(["IC910", "RX1"]);
    expect(s.selected).toEqual({ radio: null, rotator: null });
    expect(s.editor).toBeNull();
    expect(s.message).toBeNull();
    expect(hwChanged(s.original, s.hw)).toBe(false);
    expect(commitBody(s)).toBeNull();
  });

  it("double click opens one editor", () => {
    let s = run(start(), { type: "open", kind: "radio", name: "RX1" });
    expect(s.editor).toEqual({ kind: "radio", editing: "RX1" });
    expect(s.selected.radio).toBe("RX1");
    // a second double click (Gpredict connects the handler twice) and the buttons do nothing while the editor is open
    const open = s;
    s = run(s, { type: "open", kind: "radio", name: "RX1" }, { type: "open", kind: "radio", name: "IC910" });
    expect(s).toBe(open);
    expect(run(s, { type: "add", kind: "radio" })).toBe(open);
    expect(run(s, { type: "edit", kind: "rotator" })).toBe(open);
    expect(run(s, { type: "delete", kind: "radio" })).toBe(open);
    expect(run(s, { type: "select", kind: "radio", name: "IC910" })).toBe(open);
    // Cancel closes it, and no second editor opens after it
    s = run(s, { type: "cancel" });
    expect(s.editor).toBeNull();
    expect(run(s, { type: "cancel" }).editor).toBeNull();
    expect(hwChanged(s.original, s.hw)).toBe(false);
  });

  it("Add new opens the editor empty; Ok adds the radio and keeps the list sorted, without selecting it (as Gpredict's list does)", () => {
    let s = run(start(), { type: "select", kind: "radio", name: "RX1" }, { type: "add", kind: "radio" });
    expect(s.editor).toEqual({ kind: "radio", editing: null });
    s = run(s, { type: "saveRadio", conf: { ...RX, name: "AB1" } });
    expect(s.editor).toBeNull();
    expect(s.hw.radios.map((r) => r.name)).toEqual(["AB1", "IC910", "RX1"]);
    expect(s.selected.radio).toBe("RX1");
    expect(hwChanged(s.original, s.hw)).toBe(true);
    expect(commitBody(s)).toBe(s.hw);
  });

  it("Cancel of Add new adds nothing", () => {
    const s = run(start(), { type: "add", kind: "rotator" }, { type: "cancel" });
    expect(s.hw.rotators).toEqual([ROT]);
    expect(hwChanged(s.original, s.hw)).toBe(false);
  });

  it("Edit opens the selected row, and Ok replaces it (also under a new name)", () => {
    let s = run(start(), { type: "select", kind: "radio", name: "IC910" }, { type: "edit", kind: "radio" });
    expect(s.editor).toEqual({ kind: "radio", editing: "IC910" });
    s = run(s, { type: "saveRadio", conf: { ...RIG, name: "ZZ9", Port: 4600 } });
    expect(s.hw.radios.map((r) => [r.name, r.Port])).toEqual([
      ["RX1", 4532],
      ["ZZ9", 4600],
    ]);
    expect(s.selected.radio).toBe("ZZ9");
    expect(s.hw.rotators).toEqual([ROT]);
    expect(hwChanged(s.original, s.hw)).toBe(true);
  });

  it("an Ok that changes nothing is no change", () => {
    const s = run(start(), { type: "open", kind: "radio", name: "IC910" }, { type: "saveRadio", conf: { ...RIG } });
    expect(hwChanged(s.original, s.hw)).toBe(false);
    expect(commitBody(s)).toBeNull();
  });

  it("a change that is undone is no change either", () => {
    let s = run(start(), { type: "open", kind: "rotator", name: "ROTOR-1" }, { type: "saveRotator", conf: { ...ROT, MaxEl: 80 } });
    expect(commitBody(s)).not.toBeNull();
    s = run(s, { type: "open", kind: "rotator", name: "ROTOR-1" }, { type: "saveRotator", conf: { ...ROT } });
    expect(commitBody(s)).toBeNull();
  });

  it("Edit and Delete without a selection say so in a message box, which Ok closes", () => {
    let s = run(start(), { type: "edit", kind: "radio" });
    expect(s.message).toBe("Select the radio you want to edit\nand try again!");
    expect(s.editor).toBeNull();
    // nothing else works while the box is open
    expect(run(s, { type: "add", kind: "radio" })).toBe(s);
    s = run(s, { type: "dismiss" });
    expect(s.message).toBeNull();
    s = run(s, { type: "delete", kind: "rotator" });
    expect(s.message).toBe("Select the rotator you want to delete\nand try again!");
    expect(s.hw.rotators).toHaveLength(1);
    s = run(s, { type: "dismiss" }, { type: "edit", kind: "rotator" });
    expect(s.message).toBe("Select the rotator you want to edit\nand try again!");
  });

  it("Edit and Delete with an empty table do nothing (Gpredict only logs an error)", () => {
    const empty = initialState({ radios: [], rotators: [] });
    expect(run(empty, { type: "edit", kind: "radio" })).toBe(empty);
    expect(run(empty, { type: "delete", kind: "rotator" })).toBe(empty);
  });

  it("Delete removes the selected row at once, without asking, and nothing is selected after", () => {
    const s = run(start(), { type: "select", kind: "radio", name: "RX1" }, { type: "delete", kind: "radio" });
    expect(s.hw.radios.map((r) => r.name)).toEqual(["IC910"]);
    expect(s.selected.radio).toBeNull();
    expect(s.message).toBeNull();
    expect(commitBody(s)).toEqual({ radios: [RIG], rotators: [ROT] });
    // the other list is left alone, and so is its selection
    expect(s.hw.rotators).toEqual([ROT]);
  });

  it("selects a row of the list it is in, and ignores a name that is not there", () => {
    let s = run(start(), { type: "select", kind: "rotator", name: "ROTOR-1" }, { type: "select", kind: "radio", name: "IC910" });
    expect(s.selected).toEqual({ radio: "IC910", rotator: "ROTOR-1" });
    const before = s;
    s = run(s, { type: "select", kind: "radio", name: "NOPE" });
    expect(s).toBe(before);
  });

  it("Delete of everything is a change: OK then writes empty lists", () => {
    const s = run(
      start(),
      { type: "select", kind: "rotator", name: "ROTOR-1" },
      { type: "delete", kind: "rotator" },
      { type: "select", kind: "radio", name: "IC910" },
      { type: "delete", kind: "radio" },
      { type: "select", kind: "radio", name: "RX1" },
      { type: "delete", kind: "radio" },
    );
    expect(commitBody(s)).toEqual({ radios: [], rotators: [] });
  });
});
