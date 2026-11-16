import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Ellipsoid,
  EllipsoidTerrainProvider,
  Cartesian3,
  Cartesian2,
  Cartographic,
  Color,
  Rectangle,
  SingleTileImageryProvider,
  TileMapServiceImageryProvider,
  ImageryLayer,
  JulianDate,
  buildModuleUrl,
  Ion,
  HeadingPitchRange,
  Matrix4,
  CustomDataSource,
  PolygonHierarchy,
  ArcType,
  PolylineArrowMaterialProperty,
  PolylineDashMaterialProperty,
  BoundingSphere,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Math as CesiumMath,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useStudio } from "./state";
import ViewingControls from "./ViewingControls";
import { inFootprint, selectedGround, targetLook } from "./viewingGeometry";

Ion.defaultAccessToken = "";
const SATELLITE_ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="44" viewBox="0 0 56 44"><g stroke="#142d3e" stroke-width="2"><rect x="1" y="12" width="17" height="22" rx="2" fill="#48a3cb"/><rect x="38" y="12" width="17" height="22" rx="2" fill="#48a3cb"/><path d="M9 12v22m38-22v22M1 23h17m20 0h17" stroke="#bce8ff" stroke-width="1"/><path d="M18 23h20"/><rect x="20" y="10" width="16" height="25" rx="3" fill="#efc268"/><path d="M28 10V3m-6 0h12" stroke="#efc268"/></g></svg>',
  );

export default function Globe() {
  const s = useStudio();
  const host = useRef<HTMLDivElement>(null),
    viewer = useRef<Viewer | null>(null);
  const sceneLayer = useRef<CustomDataSource | null>(null),
    lookLayer = useRef<CustomDataSource | null>(null);
  const lastFrame = useRef("");
  const [error, setError] = useState(""),
    [picking, setPicking] = useState(false),
    [showBeam, setShowBeam] = useState(true);
  const d = s.detail?.id === s.selected?.id ? s.detail : null;
  const g = d?.geometry;
  const p = g?.samples?.[Math.min(s.sample, g.samples.length - 1)];
  const target = selectedGround(s);
  const ring = s.selected?.footprint.coordinates[0] || [];
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring.at(-1)?.[0] &&
    ring[0][1] === ring.at(-1)?.[1];
  const corners = closed ? ring.slice(0, -1) : ring;

  useEffect(() => {
    if (!host.current) return;
    try {
      const v = new Viewer(host.current, {
        ellipsoid: Ellipsoid.WGS84,
        terrainProvider: new EllipsoidTerrainProvider({
          ellipsoid: Ellipsoid.WGS84,
        }),
        baseLayer: ImageryLayer.fromProviderAsync(
          TileMapServiceImageryProvider.fromUrl(
            buildModuleUrl("Assets/Textures/NaturalEarthII"),
          ),
        ),
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        selectionIndicator: false,
        infoBox: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
        shouldAnimate: false,
      });
      viewer.current = v;
      sceneLayer.current = new CustomDataSource("Acquisition footprint");
      lookLayer.current = new CustomDataSource("Satellite viewing geometry");
      void v.dataSources.add(sceneLayer.current);
      void v.dataSources.add(lookLayer.current);
      v.scene.backgroundColor = Color.fromCssColorString("#0b1620");
      v.scene.globe.baseColor = Color.fromCssColorString("#253746");
      v.scene.globe.show = true;
    } catch (e) {
      setError("ไม่สามารถเปิด WebGL: " + String(e));
    }
    return () => {
      const v = viewer.current;
      if (v && !v.isDestroyed()) {
        const gl = (v.scene as any).context?._gl;
        v.destroy();
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      }
      viewer.current = null;
      sceneLayer.current = null;
      lookLayer.current = null;
    };
  }, []);

  // Image requests are independent of the moving collect-time marker.
  useEffect(() => {
    const v = viewer.current,
      r = s.selected,
      layer = sceneLayer.current;
    if (!v || !r || !layer) return;
    let cancelled = false;
    layer.entities.removeAll();
    while (v.imageryLayers.length > 1)
      v.imageryLayers.remove(v.imageryLayers.get(1), true);
    if (ring.length >= 3)
      layer.entities.add({
        id: "acquisition-footprint",
        polygon: {
          hierarchy: Cartesian3.fromDegreesArray(
            ring.flatMap((c) => c.slice(0, 2)),
          ),
          height: 0,
          material: Color.CYAN.withAlpha(0.16),
          outline: true,
          outlineColor: Color.CYAN,
        },
      });
    if (d?.preview) {
      const b = d.preview.preview.bbox;
      const product = d.color_products?.[s.imageMode];
      const external = s.imageMode === "csi" || s.imageMode === "optical";
      const url = external
        ? product?.preview_url
        : s.imageMode === "grayscale"
          ? d.preview.preview.url
          : `/api/eo/scenes/${r.id}/render/preview.png?palette=${s.imageMode}`;
      if (url) {
        const version = product?.generated_utc || d.preview.generated_utc;
        SingleTileImageryProvider.fromUrl(
          url + (url.includes("?") ? "&" : "?") + "v=" + version,
          {
            rectangle: Rectangle.fromDegrees(
              ...(b as [number, number, number, number]),
            ),
            credit:
              product?.attribution ||
              d.preview.attribution ||
              "Umbra · CC BY 4.0",
          },
        )
          .then((provider) => {
            if (!cancelled && !v.isDestroyed()) {
              v.imageryLayers.addImageryProvider(provider);
              v.scene.requestRender();
            }
          })
          .catch((e) => {
            if (!cancelled) setError(String(e));
          });
      }
    }
    v.scene.requestRender();
    return () => {
      cancelled = true;
    };
  }, [s.selected?.id, d, s.imageMode]);

  useEffect(() => {
    const v = viewer.current,
      layer = lookLayer.current;
    if (!v || !layer || !s.selected) return;
    layer.entities.removeAll();
    const point = Cartesian3.fromDegrees(
      target.lon,
      target.lat,
      target.height_m,
    );
    const inside = inFootprint(target, ring);
    const pointColor = inside
      ? Color.fromCssColorString("#50d8bc")
      : Color.ORANGE;
    layer.entities.add({
      id: "selected-ground-point",
      position: point,
      point: {
        pixelSize: 10,
        color: pointColor,
        outlineColor: Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: `Selected ground\n${target.lat.toFixed(5)}°, ${target.lon.toFixed(5)}°`,
        font: "12px sans-serif",
        fillColor: pointColor,
        showBackground: true,
        pixelOffset: new Cartesian2(0, 25),
      },
    });
    if (p && g.samples.length) {
      const satellite = Cartesian3.fromArray(p.ecef_m);
      v.clock.currentTime = JulianDate.fromIso8601(p.time);
      if (g.samples.length > 1)
        layer.entities.add({
          id: "collect-trajectory",
          polyline: {
            positions: g.samples.map((sample: any) =>
              Cartesian3.fromArray(sample.ecef_m),
            ),
            arcType: ArcType.NONE,
            width: 3,
            material: Color.fromCssColorString("#f4bf64"),
          },
        });
      layer.entities.add({
        id: "satellite-position",
        position: satellite,
        billboard: { image: SATELLITE_ICON, width: 46, height: 36 },
        label: {
          text: `${s.selected.platform}\n${(p.altitude_m / 1000).toFixed(1)} km`,
          font: "13px sans-serif",
          fillColor: Color.WHITE,
          showBackground: true,
          pixelOffset: new Cartesian2(0, -37),
        },
      });
      const look = targetLook(p.ecef_m, target);
      if (look.elevation_deg > 0)
        layer.entities.add({
          id: "selected-ground-line-of-sight",
          polyline: {
            positions: [satellite, point],
            arcType: ArcType.NONE,
            width: 5,
            material: new PolylineArrowMaterialProperty(
              pointColor.withAlpha(0.95),
            ),
          },
        });
      if (
        showBeam &&
        corners.length >= 3 &&
        corners.every(
          (c) =>
            targetLook(p.ecef_m, { lon: c[0], lat: c[1], height_m: 0 })
              .elevation_deg > 0,
        )
      ) {
        const groundCorners = corners.map((c) =>
          Cartesian3.fromDegrees(c[0], c[1], 0),
        );
        groundCorners.forEach((corner, index) => {
          layer.entities.add({
            id: `coverage-edge-${index}`,
            polyline: {
              positions: [satellite, corner],
              arcType: ArcType.NONE,
              width: 1.2,
              material: Color.CYAN.withAlpha(0.7),
            },
          });
          layer.entities.add({
            id: `coverage-face-${index}`,
            polygon: {
              hierarchy: new PolygonHierarchy([
                satellite,
                corner,
                groundCorners[(index + 1) % groundCorners.length],
              ]),
              perPositionHeight: true,
              arcType: ArcType.NONE,
              material: Color.CYAN.withAlpha(0.07),
            },
          });
        });
      }
      const nadir = Cartesian3.fromDegrees(p.lon, p.lat, 0);
      layer.entities.add({
        id: "satellite-nadir",
        polyline: {
          positions: [satellite, nadir],
          arcType: ArcType.NONE,
          width: 1.2,
          material: new PolylineDashMaterialProperty({
            color: Color.WHITE.withAlpha(0.4),
          }),
        },
      });
      layer.entities.add({
        id: "subsatellite-point",
        position: nadir,
        point: { pixelSize: 5, color: Color.WHITE.withAlpha(0.7) },
      });
    }
    v.scene.requestRender();
  }, [
    s.selected?.id,
    g,
    s.sample,
    target.lon,
    target.lat,
    target.height_m,
    showBeam,
  ]);

  function focus(mode: "link" | "ground" | "satellite" | "earth") {
    const v = viewer.current;
    if (!v || v.isDestroyed()) return;
    if (mode === "earth") {
      v.camera.flyTo({
        destination: Cartesian3.fromDegrees(target.lon, target.lat, 20000000),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
        duration: 0.8,
      });
    } else if (mode === "ground") {
      v.camera.lookAt(
        Cartesian3.fromDegrees(target.lon, target.lat, 0),
        new HeadingPitchRange(
          0,
          -1.2,
          Math.max(6000, (d?.preview?.roi.width_m || 500) * 6),
        ),
      );
      v.camera.lookAtTransform(Matrix4.IDENTITY);
    } else if (mode === "satellite" && p) {
      v.camera.lookAt(
        Cartesian3.fromArray(p.ecef_m),
        new HeadingPitchRange(0, -0.6, 90000),
      );
      v.camera.lookAtTransform(Matrix4.IDENTITY);
    } else {
      const points = [
        Cartesian3.fromDegrees(target.lon, target.lat, 0),
        ...corners.map((c) => Cartesian3.fromDegrees(c[0], c[1], 0)),
      ];
      if (g?.samples)
        points.push(
          ...g.samples.map((sample: any) =>
            Cartesian3.fromArray(sample.ecef_m),
          ),
        );
      const sphere = BoundingSphere.fromPoints(points);
      v.camera.flyToBoundingSphere(sphere, {
        duration: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? 0
          : 0.8,
        offset: new HeadingPitchRange(
          0,
          -0.8,
          Math.max(25000, sphere.radius * 3.5),
        ),
      });
    }
    v.scene.requestRender();
  }
  useEffect(() => {
    const key = `${s.selected?.id}:${!!p}:${target.lon}:${target.lat}`;
    if (key !== lastFrame.current && viewer.current) {
      lastFrame.current = key;
      focus(p ? "link" : "ground");
    }
  }, [s.selected?.id, !!p, target.lon, target.lat]);

  useEffect(() => {
    const v = viewer.current;
    if (!picking || !v) return;
    v.canvas.style.cursor = "crosshair";
    const handler = new ScreenSpaceEventHandler(v.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      const hit = v.camera.pickEllipsoid(
        event.position,
        v.scene.globe.ellipsoid,
      );
      if (!hit) return;
      const location = Cartographic.fromCartesian(hit);
      s.setGroundTarget({
        lon: CesiumMath.toDegrees(location.longitude),
        lat: CesiumMath.toDegrees(location.latitude),
        height_m: 0,
      });
      setPicking(false);
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => {
      handler.destroy();
      if (!v.isDestroyed()) v.canvas.style.cursor = "";
    };
  }, [picking]);
  useEffect(() => {
    setPicking(false);
    setError("");
  }, [s.selected?.id]);

  return (
    <div className="globe-panel">
      <ViewingControls
        onFocus={focus}
        onPick={() => setPicking(!picking)}
        picking={picking}
        showBeam={showBeam}
        setShowBeam={setShowBeam}
      />
      <div className="globe-surface">
        <div
          ref={host}
          className="globe-canvas"
          aria-label="Satellite footprint and line-of-sight 3D view"
        />
        <div className="globe-legend">
          <span>
            <i style={{ background: "#f4bf64" }} />
            {g?.render_source_label || "SICD trajectory"}
          </span>
          <span>
            <i style={{ background: "#50d8bc" }} />
            Selected coordinate / LOS
          </span>
          <span>
            <i style={{ background: "#55ddee" }} />
            {g?.estimated
              ? "Sample crop links · schematic"
              : "Image footprint links"}
          </span>
        </div>
        <div className="globe-note">
          {g
            ? g.graphics_note ||
              "Producer trajectory · collect interval only · footprint connection schematic"
            : "Load imagery for the acquisition satellite position"}
        </div>
        {error && (
          <div className="globe-error">{error} · ดูแผนภาพแนวเล็งด้านบนได้</div>
        )}
      </div>
    </div>
  );
}
