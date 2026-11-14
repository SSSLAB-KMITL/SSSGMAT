// The pages of the "Module properties" notebook (ref §3-§7), which Preferences → Modules shows too (ref-D §10). Every control is
// Gpredict's, with its label, range, unit label and tooltip; the Map View and Polar View pages have the colour buttons and the
// background map (ref-D §11, §12). The Window Placements of the Layout page are only in Preferences, which gives them to the page (`extra`).

import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import { coloursOf, MAP_COLORS, POLAR_COLORS } from "../colors";
import { gridFor, parseLayout, VIEW, VIEW_LABELS } from "../layout";
import { layoutCodeError, presetIndexOf, sanitizeLayoutCode, withFlag, withVisible } from "../moduleProps";
import type { ModuleProps, Rates } from "../moduleProps";
import { MAP_COLOUR_BUTTONS, POLAR_COLOUR_BUTTONS, SHADOW_ROW } from "../rgba";
import type { Meta } from "../types";
import { ColourButton } from "./ColourButton";
import { Check } from "./formParts";
import { MapImage, MapSelector } from "./MapSelector";
import { SpinButton } from "./SpinButton";

/** What every page gets. `set` replaces the draft; Reset is the page's own button, which the shell handles. `uid` makes the ids of the
 * page's controls its own (Module properties and Preferences → Modules can both be open). */
export interface PageProps {
  props: ModuleProps;
  meta: Meta;
  set: (props: ModuleProps) => void;
  uid: string;
}

/** The page's "Reset" button at the bottom right (sat-pref-*.c create_reset_button). */
export function ResetButton({ title, onReset }: { title: string; onReset: () => void }) {
  return (
    <div className="props-reset">
      <button type="button" className="button" title={title} onClick={onReset}>
        Reset
      </button>
    </div>
  );
}

const Header = ({ children }: { children: ReactNode }) => <b className="props-header">{children}</b>;
const Separator = () => <hr className="props-separator" />;

// ---------------------------------------------------------------- Layout

const THUMB_COLOURS: Record<number, string> = {
  [VIEW.List]: "#c4d7ee",
  [VIEW.Map]: "#bfdcc4",
  [VIEW.Polar]: "#f2dfb2",
  [VIEW.SingleSat]: "#e3cbe9",
  [VIEW.EventList]: "#eadfa0",
};

/** The preview of a layout under the combo (Gpredict shows a picture): the cells on their grid, one colour for each kind of view. */
export function LayoutThumb({ code }: { code: string }) {
  let grid;
  try {
    grid = layoutCodeError(code) === null ? gridFor(parseLayout(code)) : null;
  } catch {
    grid = null;
  }
  if (grid === null) {
    return (
      <div className="layout-thumb empty" role="img" aria-label="Custom">
        ?
      </div>
    );
  }
  return (
    <div
      className="layout-thumb"
      role="img"
      aria-label="Layout"
      style={{ gridTemplateColumns: `repeat(${grid.columns}, 1fr)`, gridTemplateRows: `repeat(${grid.rows}, 1fr)` }}
    >
      {grid.areas.map((a, i) => (
        <div
          key={i}
          title={VIEW_LABELS[a.type]}
          style={{ gridColumn: a.gridColumn, gridRow: a.gridRow, background: THUMB_COLOURS[a.type] }}
        />
      ))}
    </div>
  );
}

interface LayoutPageProps extends PageProps {
  /** the combo says Custom: the layout code can be typed */
  custom: boolean;
  setCustom: (custom: boolean) => void;
  onReset: () => void;
  resetTip: string;
  /** below the layout and above Reset: Preferences' "Window Placements" (sat-pref-layout.c:495-497); none in module mode */
  extra?: ReactNode;
}

export function LayoutPage({ props, meta, set, uid, custom, setCustom, onReset, resetTip, extra }: LayoutPageProps) {
  const presets = meta.layout_presets;
  const selected = custom ? presets.length : presetIndexOf(props.layout_code, presets);
  const problem = custom ? layoutCodeError(props.layout_code) : null;

  const choose = (index: number) => {
    const preset = presets[index];
    if (preset === undefined) {
      setCustom(true); // Custom keeps the code that is there, and lets it be edited
      set(props); // choosing any entry is a change of the page (sat-pref-layout.c layout_selected_cb: dirty = TRUE)
    } else {
      setCustom(false);
      set({ ...props, layout_code: preset.code });
    }
  };

  return (
    <div className="props-page-body">
      <div className="layout-grid">
        <label htmlFor={`${uid}-layout`} className="right">
          Select layout:
        </label>
        <select id={`${uid}-layout`} className="dialog-entry" value={selected} onChange={(e) => choose(Number(e.target.value))}>
          {presets.map((p, i) => (
            <option key={p.code} value={i}>
              {p.name}
            </option>
          ))}
          <option value={presets.length}>Custom</option>
        </select>
        <span />
        <LayoutThumb code={props.layout_code} />
        <label htmlFor={`${uid}-layout-code`} className="right">
          Layout code:
        </label>
        <input
          id={`${uid}-layout-code`}
          className="dialog-entry"
          type="text"
          value={props.layout_code}
          disabled={!custom}
          spellCheck={false}
          autoComplete="off"
          title={
            "This entry holds the layout code for the module.\nConsult the user manual for how to create custom layouts using layout codes."
          }
          onChange={(e) => {
            setCustom(true);
            set({ ...props, layout_code: sanitizeLayoutCode(e.target.value) });
          }}
        />
      </div>
      {problem !== null && (
        <p className="dialog-error" role="alert">
          {problem}
        </p>
      )}
      {extra !== undefined && (
        <>
          <Separator />
          {extra}
        </>
      )}
      <ResetButton title={resetTip} onReset={onReset} />
    </div>
  );
}

// ---------------------------------------------------------------- Refresh Rates

const RATE_ROWS: { key: keyof Rates; unit: string }[] = [
  { key: "data_ms", unit: "[msec]" },
  { key: "list", unit: "[cycle]" },
  { key: "map", unit: "[cycle]" },
  { key: "polar", unit: "[cycle]" },
  { key: "single", unit: "[cycle]" },
];

export function RefreshPage({ props, meta, set, uid, onReset, resetTip }: PageProps & { onReset: () => void; resetTip: string }) {
  return (
    <div className="props-page-body">
      <div className="refresh-grid">
        {RATE_ROWS.map(({ key, unit }, i) => {
          const [min, max] = key === "data_ms" ? meta.refresh_ranges.data_ms : meta.refresh_ranges.cycle;
          return (
            <Fragment key={key}>
              {i === 1 && <hr className="props-separator wide" />}
              <label htmlFor={`${uid}-refresh-${key}`}>{meta.refresh_labels[key]}</label>
              <SpinButton
                id={`${uid}-refresh-${key}`}
                value={props.refresh[key]}
                min={min}
                max={max}
                page={key === "data_ms" ? 100 : 5}
                title=""
                onChange={(value) => set({ ...props, refresh: { ...props.refresh, [key]: value } })}
              />
              <span>{unit}</span>
            </Fragment>
          );
        })}
      </div>
      <ResetButton title={resetTip} onReset={onReset} />
    </div>
  );
}

// ---------------------------------------------------------------- List View and Single Sat View: "Visible Fields:"

interface FieldsPageProps {
  /** the fields in Gpredict's order, with the hints that are their tooltips */
  fields: readonly { name: string; hint: string }[];
  visible: readonly string[];
  onChange: (visible: string[]) => void;
  onReset: () => void;
  resetTip: string;
}

export function FieldsPage({ fields, visible, onChange, onReset, resetTip }: FieldsPageProps) {
  const canonical = fields.map((f) => f.name);
  return (
    <div className="props-page-body">
      <Header>Visible Fields:</Header>
      <div className="check-grid three">
        {fields.map((f) => (
          <Check
            key={f.name}
            checked={visible.includes(f.name)}
            title={f.hint}
            onChange={(on) => onChange(withVisible(canonical, visible, f.name, on))}
          >
            {f.name}
          </Check>
        ))}
      </div>
      <ResetButton title={resetTip} onReset={onReset} />
    </div>
  );
}

// ---------------------------------------------------------------- Map View

const MAP_TIPS: Record<string, string> = {
  "Satellite Name": "Show the satellite name on the map",
  "Satellite Footprint": "Show the satellite footprint on the map",
  "Satellite Marker": "Show the satellite marker on the map",
  "QTH Info": "Show location information on the map",
  "Next Event": "Show which satellite comes up next and at what time",
  "Cursor Position": "Show the latitude and longitude of the mouse pointer",
  "Grid Lines": "Show horizontal and vertical grid lines",
  "Solar Terminator": "Show solar Terminator",
};

export function MapPage({ props, meta, set, uid, onReset, resetTip }: PageProps & { onReset: () => void; resetTip: string }) {
  const { map } = props;
  const [selecting, setSelecting] = useState(false);
  const [looked, setLooked] = useState(0); // the thumbnail asks the server again after the dialog: the map it shows may have been uploaded there
  const colours = coloursOf(MAP_COLORS, map.colours);
  return (
    <div className="props-page-body">
      <Header>Background Map:</Header>
      <div className="map-pick">
        <MapImage key={looked} file={map.file} width={100} height={50} className="map-thumb" />
        <button type="button" className="button" title="Click to select a map" onClick={() => setSelecting(true)}>
          Select map
        </button>
      </div>
      {selecting && (
        <MapSelector
          current={map.file}
          onOpen={(file) => {
            setSelecting(false);
            setLooked((n) => n + 1);
            set({ ...props, map: { ...map, file } }); // a map is chosen for the page; it is saved with the page (OK)
          }}
          onCancel={() => {
            setSelecting(false);
            setLooked((n) => n + 1);
          }}
        />
      )}
      <Separator />
      <Header>Contents:</Header>
      <div className="check-grid four">
        {meta.map_contents.map((name) => (
          <Check
            key={name}
            checked={map.contents[name] ?? false}
            title={MAP_TIPS[name]}
            onChange={(on) => set({ ...props, map: { ...map, contents: withFlag(map.contents, name, on) } })}
          >
            {name}
          </Check>
        ))}
      </div>
      <Separator />
      <Header>Colours:</Header>
      <div className="colour-grid">
        {MAP_COLOUR_BUTTONS.map((b) => (
          <ColourButton
            key={b.key}
            label={b.label}
            tooltip={b.tooltip}
            value={colours[b.key]}
            onChange={(value) => set({ ...props, map: { ...map, colours: { ...colours, [b.key]: value } } })}
          />
        ))}
      </div>
      <div className="shadow-row">
        <span className="right">{SHADOW_ROW.label}</span>
        <i>{SHADOW_ROW.low}</i>
        <span title={SHADOW_ROW.tooltip} className="shadow-slider">
          <input
            type="range"
            min={0}
            max={255}
            step={1}
            value={map.shadow_alpha}
            aria-label="Shadow"
            onChange={(e) => set({ ...props, map: { ...map, shadow_alpha: Number(e.target.value) } })}
          />
        </span>
        <i>{SHADOW_ROW.high}</i>
      </div>
      <Separator />
      <div className="inline-row">
        <label htmlFor={`${uid}-orbits`}>Display ground track for</label>
        <SpinButton
          id={`${uid}-orbits`}
          value={map.track_orbits}
          min={meta.map_track_orbits.min}
          max={meta.map_track_orbits.max}
          title=""
          onChange={(track_orbits) => set({ ...props, map: { ...map, track_orbits } })}
        />
        <span>orbit(s)</span>
      </div>
      <div className="inline-row">
        <label htmlFor={`${uid}-center`}>Center map at longitude</label>
        <SpinButton
          id={`${uid}-center`}
          value={map.center_lon}
          min={meta.map_center_lon.min}
          max={meta.map_center_lon.max}
          title="Select longitude. West is negative."
          onChange={(center_lon) => set({ ...props, map: { ...map, center_lon } })}
        />
        <span>[deg]</span>
      </div>
      <Separator />
      <ResetButton title={resetTip} onReset={onReset} />
    </div>
  );
}

// ---------------------------------------------------------------- Polar View

const POLAR_TIPS: Record<string, string> = {
  "Satellite Name": "Show the satellite name on the polar plot",
  "Satellite Marker": "Show the satellite marker on the polar plot",
  "QTH Info": "Show location information on the polar plot",
  "Next Event": "Show which satellites comes up next and at what time",
  "Cursor Position": "Show the azimuth and elevation of the mouse pointer",
  "Extra Az Ticks": "Show extra tick marks for every 30°",
};

/** Where N, E, S and W are for each orientation (sat-pref-polar-view.c), as the tooltip of its radio button. */
const ORIENTATION_TIPS: Record<string, string> = {
  "N/E/S/W": "\tN\nW\t\tE\n\tS",
  "N/W/S/E": "\tN\nE\t\tW\n\tS",
  "S/E/N/W": "\tS\nW\t\tE\n\tN",
  "S/W/N/E": "\tS\nE\t\tW\n\tN",
};

export function PolarPage({ props, meta, set, uid, onReset, resetTip }: PageProps & { onReset: () => void; resetTip: string }) {
  const { polar } = props;
  const colours = coloursOf(POLAR_COLORS, polar.colours);
  return (
    <div className="props-page-body">
      <Header>Orientation:</Header>
      <div className="radio-row">
        {meta.polar_orientations.map((o) => (
          <label key={o} className="check" title={ORIENTATION_TIPS[o]}>
            <input
              type="radio"
              name={`${uid}-orientation`}
              checked={polar.orientation === o}
              onChange={() => set({ ...props, polar: { ...polar, orientation: o } })}
            />
            {o}
          </label>
        ))}
      </div>
      <Header>Contents:</Header>
      <div className="check-grid three">
        {meta.polar_contents.map((name) => (
          <Check
            key={name}
            checked={polar.contents[name] ?? false}
            title={POLAR_TIPS[name]}
            onChange={(on) => set({ ...props, polar: { ...polar, contents: withFlag(polar.contents, name, on) } })}
          >
            {name}
          </Check>
        ))}
      </div>
      <Header>Colours:</Header>
      <div className="colour-grid">
        {POLAR_COLOUR_BUTTONS.map((b) => (
          <ColourButton
            key={b.key}
            label={b.label}
            tooltip={b.tooltip}
            value={colours[b.key]}
            onChange={(value) => set({ ...props, polar: { ...polar, colours: { ...colours, [b.key]: value } } })}
          />
        ))}
      </div>
      <Header>Miscellaneous:</Header>
      <Check
        checked={polar.auto_skytrack}
        title="Automatically show the sky track of a satellite when it comes in range. You can always turn the sky track OFF for each individual object"
        onChange={(on) => set({ ...props, polar: { ...polar, auto_skytrack: on } })}
      >
        Show the sky tracks automatically
      </Check>
      <ResetButton title={resetTip} onReset={onReset} />
    </div>
  );
}
