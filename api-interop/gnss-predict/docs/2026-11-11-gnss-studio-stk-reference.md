# GNSS Studio: STK UI reference (verified)

- Date: 2026-11-11
- Source: Ansys STK help at https://help.agi.com, current release "v2026 R1 (STK 13.1.0)" unless a page is marked otherwise
- Method: every page below was fetched and read; about 15 claims were re-checked against saved page text
- Purpose: GNSS Studio copies STK's UI wording. Use only the terms in this file for menus, buttons, windows and property pages.
  Where STK documents nothing, the design marks the choice as **ours**.

Legend: **OK** = confirmed as written; **STK** = STK differs from our first draft and this is STK's term; **NF** = not found in the help.

Base URL for relative links: `https://help.agi.com/stk/Content/`

## A. Workspace

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| Menu bar | STK | File, Edit, View, Insert, Analysis, *(menu named after the selected object)*, Utilities, Window, Help. Order comes from a 2009 screenshot only. | gettingstarted/GetStart_7_Keyboard.htm, gettingstarted/GetStart_ToolbarsAndDocking.htm |
| Toolbars | STK | Predefined: STK Tools, Default, 2D Graphics, Web Browser Controls, 3D Graphics, Animation, Data Providers. **Insert Object** is on Default. Graphics windows carry 2D Window Defaults / 3D Window Defaults. No "Standard" toolbar. | gettingstarted/Toolbars.htm |
| Window modes | OK | Dockable, Floating, Integrated; dock markers; pin/unpin (auto-hide); tabbed groups; right-click the window top to change mode | gettingstarted/Docking.htm |
| Window menu | OK | Windows... (Activate / Integrate / Center / Close), Cascade, Tile Horizontally, Tile Vertically, close, close all, numbered window list | gettingstarted/Docking.htm, gettingstarted/GetStart_7_Keyboard.htm |
| Default placement | OK | 2D and 3D Graphics windows are Integrated; Timeline View at the bottom; Object Browser on the left (screenshot only) | training/StartCoverage.htm |
| Layout persistence | STK | Layout is saved with the scenario in a **Workbook** file; Auto Save does not save layouts | gettingstarted/GetStart_7_ScenarioOV.htm, gettingstarted/GetStart_SaveLoadTable.htm |
| Startup | OK | **Welcome to STK**: Create a Scenario / Open a Scenario; Insert STK Objects opens after a new scenario | training/L1_BuildScenarios.htm |
| Message Viewer | OK | Tabs All Messages / Errors / Infos / Warnings; Details; Clear this Tab; Clear all Tabs | gettingstarted/GetStart_7_MessageViewer.htm |
| Status Bar | OK | Message Viewer icon, Active Object, Lat/Lon, Animation Time, Time Step, Frame Rate, progress bar with Stop | gettingstarted/GetStart_StatusBarTable.htm |
| Files | OK | Scenario Files (*.sc), one folder per scenario, recent list in File menu | gettingstarted/GetStart_7_ScenarioOV.htm |
| Shortcuts | OK | Ctrl+S, Ctrl+Q (close scenario), Ctrl+P, Ctrl+X/C/V, Delete, F5 (refresh report); no animation keys; Shift + mouse wheel in 3D changes animation time | gettingstarted/GetStart_7_Keyboard.htm, gettingstarted/GetStart_7_Mouse.htm |

## B. Object Browser and Insert

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| Tree | OK | Scenario is the root; objects are flat under it; nesting only for sub-objects | gettingstarted/GetStart_ObjectBrowser.htm |
| Constellation | OK | A separate object; members set on **Basic - Definition** (Available Objects → Assigned Objects) | chains/constellation-01.htm |
| Object Browser toolbar | OK | Properties, Graphics Color Selectors, Graphics On/Off Toggles, New Group, Cut, Copy, Paste, Delete, Print, Find, Expand/Collapse | gettingstarted/GetStart_ObjectBrowser.htm |
| Color box / checkbox | OK | Double-click color box → Select color; unchecked = hidden in graphics but still used in analysis | gettingstarted/GetStart_ObjectBrowser.htm |
| Right-click menu | STK | Properties, Access..., Report & Graph Manager..., Zoom To (3D only), Rename, Delete, Analysis Workbench..., *(class submenu)*. No Show/Hide or Copy/Paste here. Full list not documented. | training/L1_AccessReports.htm, training/WhereisISS.htm |
| Groups / Find | OK | New Group, "Create a new Group", Find dialog. Filter: **NF** | gettingstarted/GetStart_ObjectBrowser.htm |
| Insert STK Objects | OK | "Select An Object To Be Inserted" / "Select A Method": Define Properties, Insert Default, From Standard Object Database (→ Search Standard Object Data; Data Sources Online/Local; Create Constellation from Selected). Satellite extras: Load GPS Constellation, From GPS Almanac, From SP3 File, From TLE File, From External Ephemeris File. CelesTrak method: **NF** | stk/NewObjectTool.htm, stk/toolsdb-03.htm |

## C. Properties Browser

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| Layout | OK | Page list on the left; Apply / OK / Cancel / Help; open by right-click Properties, double-click, or Properties button | training/L1_ObjectProperties.htm |
| Page naming | STK | "Group - Page", e.g. "Basic - Units" | stk/ObjectProperties.htm |
| Scenario groups | STK | Basic, 2D Graphics, 3D Graphics, RF, LASER, Aviator (no Constraints) | stk/ObjectMap_Scenario.htm |
| Scenario Basic - Time | STK | One page holds the Analysis Period and the Animation section: Start Time; Time Update Mode = Real Time / Time Step / X Real-Time / Time Array; Animation Cycle Off / Stop at Time / Loop at Time | training/L1_ObjectProperties.htm, stk/sc-01.htm |
| Scenario Basic - Units | OK | DateFormat UTCG, LCLG, **LTZG** (Local Time Zone Gregorian, accepts ±hh:mm), EpSec, JDate, GPSG, TAIG… | stk/sc-03.htm |
| Scenario 2D Graphics - Global Attributes | OK | Show Labels | stk/2DGraphicsGlobalAttributes.htm |
| Facility groups | STK | Basic, 2D Graphics, 3D Graphics, Constraints, RF, Laser | stk/ObjectMap_FacilityAndTarget.htm |
| Facility pages | STK | Basic - Position (Position Type Geodetic…; Latitude, Longitude, Altitude), Basic - AzElMask, **Constraints - Active** (add Elevation Angle from "Select Constraints to Add"), Constraints - Settings. No "Constraints - Basic". | stk/fac-01.htm, stk/fac-02.htm, stk/AccessConstraintsOverview.htm |
| Facility 2D Graphics | STK | Attributes, AzElMask, Range, Display Times, Radar Cross Section. No elevation contours. | stk/ObjectMap_FacilityAndTarget.htm |
| Satellite groups | STK | Basic, 2D Graphics, 3D Graphics, Constraints, RF | stk/ObjectMap_Vehicle_Satellite.htm |
| Satellite Basic - Orbit | OK | Propagator SGP4; TLE Source; Identification (SSC number) | stk/vehSat_orbitProp_msgp4.htm |
| Satellite 2D Graphics - Pass | OK | Lead Type / Trail Type = Time, Percent, Quarter, Half, Full, All, None, One Pass, Current Interval (+ Same As Lead); Visible Sides; Show Pass Labels; Show Path Labels | stk/vehSat_gfx_pass.htm, stk/gfx_leadRes.htm |
| Satellite 2D Graphics - Attributes | OK | Color, Line Style, Line Width, Marker Style, Inherit from Scenario | stk/2DGraphicsAttributes.htm |
| Satellite 2D Graphics - Swath | OK | Ground Elevation / Vehicle Half Angle / Swath Half Width; Edge Limits / Filled Limits (footprint without a sensor) | stk/veh_gfx_swath.htm |
| Satellite 3D Graphics - Orbit System | OK | Fixed by Window / Inertial by Window | vo/orbitframe.htm |
| Constellation groups | STK | Basic, Constraints only; **no 2D/3D Graphics pages** | stk/ObjectMap_Constellation.htm |

## D. Animation and Timeline

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| Animation toolbar | OK (names), NF (tooltips) | Reset, Step Backward, Reverse, Pause, **Start**, Step Forward, Decrease Time Step, Increase Time Step, Normal Animation Mode, Real-Time Animation Mode, X Real-Time Animation Mode; fields Current Scenario Time, Time Step, X Real Time Multiplier | training/L1_BuildScenarios.htm, stk/map-01a.htm |
| Default time step | conflict | Tutorial: 10 s. Step table: **60.00 (default)**. Fixed list of step values for Increase/Decrease. | training/L1_BuildScenarios.htm, stk/map-01a.htm |
| Current time display | OK | Current Scenario Time field (paste + Enter to jump), Status Bar Animation Time, 3D Annotation Show Time, 2D Time Display page | training/L1_ObjectProperties.htm, stk/map-04.htm |
| Timeline View | OK | Global Time Bar, Global Time Scale, Time Display, View Port; right-click **Set Animation Time to Here**; interval right-click Set Animation Time to Interval Start/Stop Time | gettingstarted/GetStart_7_TimelineView.htm |
| Sync | STK | All 2D/3D windows follow animation. Static reports do not; Dynamic Display and Strip Chart do. | stk/report.htm |

## E. 3D and 2D Graphics windows

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| 3D Graphics toolbar | OK (icons only) | Home View, View From/To, 3D Measure, stored views…; most buttons have no published text name | vo/votoolbar.htm |
| 3D Window Defaults toolbar | OK | Properties, Grab Globe, Zoom In, Snap Frame, Snap Properties | Printed Manual – Comprehensive (13.1.0) |
| Zoom To | STK | Object Browser right-click, not a 3D toolbar button | training/WhereisISS.htm |
| Fixed/Inertial | STK | No single toggle: 3D uses the Orbit System page; 2D uses Projection → Display Coordinate Frame (ECF/ECI) | vo/orbitframe.htm, stk/map-06.htm |
| View from a facility | STK | View From/To window, From Position = facility | vo/3DViewPosition.htm |
| 3D Graphics Window Properties | OK | Lighting (Enable Lighting; Sun Lighting Ambient Level, Sun Level, Night Lights Level), Details (Lat/Lon Lines, Label Declutter), Annotation (Show Time, Compass) | vo/VOProperties.htm, vo/vowindow-04a.htm |
| 2D Graphics Window Properties | OK | Projection (Equidistant Cylindrical, Mercator, …; Display Coordinate Frame), Details (Lat/Lon Lines), Lighting (Subsolar Point, Show Outline, Shading), Time Display, Annotation | stk/2Dgfxproperties.htm, stk/map-06.htm, stk/map-05.htm, stk/map_lighting.htm |

## F. Access and Report & Graph Manager

| Item | Verdict | STK term / behavior | Page |
|---|---|---|---|
| Access tool buttons | STK | Access For + Select Object...; Associated Objects; **Compute, Clear, Clear All, Remove, Remove All**; Advanced... | stk/tools-01.htm |
| Access time period | STK | Use Object Time Period / Use Time Intervals / Specify Time Period | stk/tools-01.htm |
| Access reports/graphs | OK | Reports: Access..., AER...; Graphs: Access..., AER...; Report & Graph Manager...; **Add Timeline** + Auto Add to Timeline (on by default) | stk/tools-01.htm |
| Access graphics | OK | Show, Static Highlight, Animate Highlight (2D box), Show Animate Line; Use Object Colors / Use Custom Color | stk/tools-01.htm |
| Report & Graph Manager | STK | Object Type (+ All Types); Styles: Installed Styles / My Styles / Scenario Styles; Show Reports / Show Graphs; **Generate As: Report/Graph or Dynamic Display/Strip Chart**; Generate...; right-click style Generate as .txt file... / Generate as .csv file... | stk/report.htm, stk/report_export.htm |
| Access report | OK | Columns Access, Start Time, Stop Time, Duration; Global Statistics (Total Duration) when more than one object. Min/Max/Mean labels: NF (AccessSummary style has them) | training/L1_AccessReports.htm |
| Styles | OK | AER (Time, Azimuth, Elevation, Range); LLA Position; graphs Access (Interval), AER, Elevation Angle, **Az El Polar** (Polar90); AccessSummary, Gaps | SubSystems/dataProviders/Content/htmlStyles/Access/AccessStyles.htm |
| Graph time cursor | OK | Toggle Animation Timeline button; right-click Show Animation Time Line, Set Animation Time | stk/report-03.htm |
| Report windows | OK | Can be floated, integrated or docked; Refresh (F5) | stk/report_export.htm |
| DOP | STK | Coverage FOM **Dilution of Precision**: GDOP, PDOP/PDOP(3), HDOP/HDOP(3), VDOP/VDOP(3), EDOP/EDOP(3), NDOP/NDOP(3), TDOP; Over Determined / Best Four / Best N; one receiver clock vs GPS clock | cov/fom-13.htm |
| Satellite count | STK | Coverage FOM **N Asset Coverage** | cov/fom-03.htm |
| All DOPs style | OK | Time, GDOP, PDOP, HDOP, VDOP, TDOP | SubSystems/dataProviders/Content/htmlStyles/ObjectCoverage/Reports/All_DOPs.htm |
