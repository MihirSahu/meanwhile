"use client";

import { memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { gsap } from "gsap";
import { Asset, palettes } from "./assets";
import { modelOffsets, packLabels, sceneFraming, type Rect } from "@/lib/scene-layout";
import { SourceLinks } from "./source-links";
import { entityVisible, positionAt, type SceneBuffer } from "@/lib/playback";
import type {
  Geo,
  SceneAction,
  SceneFocus,
  SpawnAction,
} from "@/lib/scene-schema";

const SceneAsset = memo(Asset);

export type PlaybackClock = {
  time: number;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
};
export type CameraCommand = {
  kind: "left" | "right" | "up" | "down" | "in" | "out";
  sequence: number;
};
type ClockRef = { current: PlaybackClock };
export function geoPoint({ lat, lon }: Geo, radius = 2.025) {
  const a = (lat * Math.PI) / 180,
    b = (lon * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(a) * Math.sin(b),
    radius * Math.sin(a),
    radius * Math.cos(a) * Math.cos(b),
  );
}

function Land() {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let created: THREE.BufferGeometry | undefined;
    fetch("/globe-land.json", { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Map unavailable");
        return r.json();
      })
      .then((data) => {
        created = new THREE.BufferGeometry();
        created.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(data.positions, 3),
        );
        created.setAttribute(
          "color",
          new THREE.Float32BufferAttribute(data.colors, 3),
        );
        created.computeVertexNormals();
        setGeometry(created);
      })
      .catch((error) => {
        if (!abort.signal.aborted) console.error(error);
      });
    return () => {
      abort.abort();
      created?.dispose();
    };
  }, []);
  return geometry ? (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        vertexColors
        roughness={1}
        side={THREE.DoubleSide}
      />
    </mesh>
  ) : null;
}

function Graticule() {
  const lines = useMemo(() => {
    const result: THREE.Vector3[][] = [];
    for (let lat = -60; lat <= 60; lat += 30)
      result.push(
        Array.from({ length: 181 }, (_, i) =>
          geoPoint({ lat, lon: i * 2 - 180 }, 2.004),
        ),
      );
    for (let lon = -180; lon < 180; lon += 30)
      result.push(
        Array.from({ length: 91 }, (_, i) =>
          geoPoint({ lat: i * 2 - 90, lon }, 2.004),
        ),
      );
    return result;
  }, []);
  return (
    <>
      {lines.map((points, i) => (
        <Line
          key={i}
          points={points}
          color="#c9d7c4"
          transparent
          opacity={0.14}
          lineWidth={0.5}
        />
      ))}
    </>
  );
}

function CameraRig({
  framing,
  focus,
  controls,
  homeKey,
  command,
}: {
  framing: ReturnType<typeof sceneFraming>;
  focus: SceneFocus | null;
  controls: React.RefObject<OrbitControlsImpl | null>;
  homeKey: number;
  command: CameraCommand | null;
}) {
  const { camera, gl } = useThree();
  const { lat, lon } = framing.center;
  const distance = framing.distance;
  const travel = useRef<gsap.core.Tween | null>(null);
  const startedAt = useRef(0);
  const manual = useRef(false);
  const previousHome = useRef(homeKey);
  useFrame(() => {
    const animation = travel.current;
    if (!animation) return;
    // Sample GSAP from wall time; its global lag smoothing must not prolong a
    // camera flight on a slow GPU or after a background-tab interruption.
    animation.totalTime((performance.now() - startedAt.current) / 1000);
    if (animation.progress() === 1) travel.current = null;
  });
  useEffect(() => {
    if (previousHome.current !== homeKey) {
      manual.current = false;
      previousHome.current = homeKey;
    }
    if (manual.current) return;
    const target = geoPoint({ lat, lon }, distance);
    const animation = gsap.to(camera.position, {
      paused: true,
      x: target.x,
      y: target.y,
      z: target.z,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 2.4,
      ease: "power3.inOut",
      onUpdate: () => controls.current?.update(),
      onComplete: () => {
        gl.domElement.dataset.cameraReady = focus?.title ?? "home";
      },
    });
    delete gl.domElement.dataset.cameraReady;
    startedAt.current = performance.now();
    travel.current = animation;
    if (animation.duration() === 0) animation.progress(1);
    const interrupt = () => {
      manual.current = true;
      animation.kill();
      travel.current = null;
    };
    gl.domElement.addEventListener("pointerdown", interrupt);
    gl.domElement.addEventListener("wheel", interrupt, { passive: true });
    return () => {
      animation.kill();
      travel.current = null;
      gl.domElement.removeEventListener("pointerdown", interrupt);
      gl.domElement.removeEventListener("wheel", interrupt);
    };
  // Layout measurements recreate framing objects, even when the destination
  // is unchanged. Only actual target changes should restart geographic travel.
  }, [focus, lat, lon, distance, camera, controls, gl, homeKey]);
  useEffect(() => {
    if (!command) return;
    manual.current = true;
    travel.current?.kill();
    travel.current = null;
    const spherical = new THREE.Spherical().setFromVector3(camera.position);
    if (command.kind === "in" || command.kind === "out")
      spherical.radius = THREE.MathUtils.clamp(
        spherical.radius * (command.kind === "in" ? 0.85 : 1.15),
        2.28,
        8,
      );
    if (command.kind === "left" || command.kind === "right")
      spherical.theta += command.kind === "left" ? -0.15 : 0.15;
    if (command.kind === "up" || command.kind === "down")
      spherical.phi = THREE.MathUtils.clamp(
        spherical.phi + (command.kind === "up" ? -0.15 : 0.15),
        0.05,
        Math.PI - 0.05,
      );
    camera.position.setFromSpherical(spherical);
    controls.current?.update();
  }, [command, camera, controls]);
  return null;
}

function Route({
  action,
  color,
}: {
  action: Extract<SceneAction, { type: "move" }>;
  color: string;
}) {
  const points = useMemo(() => {
    const result: THREE.Vector3[] = [];
    for (let p = 0; p < action.path.length - 1; p++) {
      const from = geoPoint(action.path[p], 2.03),
        to = geoPoint(action.path[p + 1], 2.03);
      for (let i = 0; i < 12; i++)
        result.push(
          from
            .clone()
            .lerp(to, i / 12)
            .normalize()
            .multiplyScalar(2.033),
        );
    }
    result.push(geoPoint(action.path.at(-1)!, 2.033));
    return result;
  }, [action]);
  return (
    <Line
      points={points}
      color={color}
      lineWidth={1.5}
      transparent
      opacity={0.55}
      dashed
      dashSize={0.025}
      gapSize={0.018}
    />
  );
}

function Entity({
  spawn,
  actions,
  clock,
  time,
  onSelect,
  selected,
  speechId,
  labels,
  sources,
  offset,
  figureBounds,
}: {
  figureBounds: React.RefObject<Map<string, Rect>>;
  offset: [number, number];
  spawn: SpawnAction;
  actions: SceneAction[];
  clock: ClockRef;
  time: number;
  onSelect: (id: string) => void;
  selected: boolean;
  speechId?: string;
  labels: React.RefObject<HTMLDivElement | null>;
  sources: SceneFocus["sources"];
}) {
  const root = useRef<THREE.Group>(null);
  const model = useRef<THREE.Group>(null);
  const label = useRef<HTMLDivElement>(null);
  const proxy = useRef({ pop: 0 });
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const { camera, size } = useThree();
  const bounds = useMemo(() => new THREE.Box3(), []);
  const corner = useMemo(() => new THREE.Vector3(), []);
  const lastBounds = useRef(0);
  useEffect(() => {
    proxy.current.pop = 0;
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(
      proxy.current,
      { pop: 0 },
      { pop: 1, duration: 0.8, ease: "back.out(1.5)", immediateRender: false },
      spawn.at,
    );
    timeline.current = tl;
    return () => {
      tl.kill();
      timeline.current = null;
      document.body.style.cursor = "auto";
      figureBounds.current.delete(spawn.entityId);
    };
  }, [spawn, figureBounds]);
  const tetherPoints = useMemo<[number, number, number][]>(
    () => [
      [0, 0.006, 0],
      [offset[0], 0.006, offset[1]],
    ],
    [offset[0], offset[1]],
  );
  const normal = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const speech = actions.find(
    (a) =>
      a.id === speechId && a.type === "speech" && a.entityId === spawn.entityId,
  );
  useFrame(() => {
    if (!root.current || !model.current) return;
    const time = clock.current.time;
    root.current.visible = entityVisible(actions, spawn, time);
    if (label.current)
      label.current.style.display = root.current.visible ? "" : "none";
    timeline.current?.totalTime(Math.max(0, time), true);
    root.current.position.copy(geoPoint(positionAt(actions, spawn, time)));
    normal.copy(root.current.position).normalize();
    root.current.quaternion.setFromUnitVectors(up, normal);
    model.current.scale.setScalar(
      (clock.current.reducedMotion ? 1 : Math.max(0.001, proxy.current.pop)) *
        0.075 *
        spawn.scale,
    );
    if (!root.current.visible) {
      figureBounds.current.delete(spawn.entityId);
      return;
    }
    if (performance.now() - lastBounds.current < 80) return;
    lastBounds.current = performance.now();
    // Project the actual displaced model, including its height and scale.
    // The geographic pin and the HTML label anchor alone do not describe it.
    if (root.current.position.dot(camera.position) <= root.current.position.lengthSq()) {
      figureBounds.current.delete(spawn.entityId);
      return;
    }
    model.current.updateWorldMatrix(true, true);
    bounds.setFromObject(model.current);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          corner.set(x, y, z).project(camera);
          const px = (corner.x + 1) * size.width / 2;
          const py = (1 - corner.y) * size.height / 2;
          left = Math.min(left, px); right = Math.max(right, px);
          top = Math.min(top, py); bottom = Math.max(bottom, py);
        }
    if ([left, top, right, bottom].every(Number.isFinite))
      figureBounds.current.set(spawn.entityId, { x: left, y: top, width: right - left, height: bottom - top });
  });
  return (
    <group ref={root} visible={false}>
      <group
        ref={model}
        position={[offset[0], 0, offset[1]]}
        rotation={[0, 0.5, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(spawn.entityId);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <SceneAsset entity={spawn} actions={actions} clock={clock} />
      </group>
      {(offset[0] !== 0 || offset[1] !== 0) && (
        <Line
          points={tetherPoints}
          color={palettes[spawn.palette]}
          lineWidth={1}
          transparent
          opacity={0.5}
        />
      )}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[0.07 * spawn.scale, 0.078 * spawn.scale, 32]} />
        <meshBasicMaterial
          color={palettes[spawn.palette]}
          transparent
          opacity={selected ? 0.9 : 0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Html
        portal={labels as React.RefObject<HTMLElement>}
        position={[offset[0], 0.16 * spawn.scale, offset[1]]}
        center
        occlude
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={label}
          data-scene-label={spawn.entityId}
          data-priority={
            speech ? 1000 : selected ? 900 : spawn.asset === "officer" ? 50 : 0
          }
          style={{
            display: entityVisible(actions, spawn, time) ? undefined : "none",
          }}
        >
          <div className={`entity-label ${selected ? "selected" : ""}`}>
            <span style={{ background: palettes[spawn.palette] }} />
            {spawn.label}
          </div>
          {speech?.type === "speech" && (
            <div className="speech-bubble">
              <small>
                {speech.kind === "reconstruction"
                  ? "Imagined perspective"
                  : speech.kind === "quote"
                    ? "Documented quotation"
                    : "Historical context"}
              </small>
              {speech.text}
              <SourceLinks sources={sources} ids={speech.sourceIds} />
              {speech.sourceUrl && (
                <a
                  style={{ pointerEvents: "auto" }}
                  href={speech.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source ↗
                </a>
              )}
            </div>
          )}
          <svg className="scene-label-tether" aria-hidden="true">
            <line data-label-tether stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      </Html>
    </group>
  );
}

function Attack({
  action,
  actions,
  clock,
}: {
  action: Extract<SceneAction, { type: "attack" }>;
  actions: SceneAction[];
  clock: ClockRef;
}) {
  const root = useRef<THREE.Group>(null);
  const particle = useRef<THREE.Mesh>(null);
  const entities = [action.entityId, action.targetId].map((id) =>
    actions.find(
      (a): a is SpawnAction => a.type === "spawn" && a.entityId === id,
    ),
  );
  const start = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!root.current || !particle.current) return;
    const elapsed = clock.current.time - action.at;
    root.current.visible = elapsed >= 0 && elapsed < action.duration;
    if (!root.current.visible) return;
    if (entities[0])
      start.copy(
        geoPoint(positionAt(actions, entities[0], clock.current.time), 2.07),
      );
    if (entities[1])
      end.copy(
        geoPoint(positionAt(actions, entities[1], clock.current.time), 2.07),
      );
    const t = (elapsed * 1.5) % 1;
    particle.current.position
      .copy(start)
      .lerp(end, t)
      .normalize()
      .multiplyScalar(2.07 + Math.sin(t * Math.PI) * 0.08);
    particle.current.scale.setScalar(0.8 + Math.sin(t * Math.PI) * 0.5);
  });
  return (
    <group ref={root} visible={false}>
      <mesh ref={particle}>
        <icosahedronGeometry args={[0.018, 0]} />
        <meshBasicMaterial color="#edbc6a" />
      </mesh>
    </group>
  );
}

type GlobeProps = {
  buffer: SceneBuffer;
  clock: ClockRef;
  time: number;
  onSelect: (id: string) => void;
  selected: string | null;
  homeKey: number;
  cameraCommand: CameraCommand | null;
  session: number;
  labels: React.RefObject<HTMLDivElement | null>;
  panelOpen: boolean;
};
function World({
  buffer,
  clock,
  time,
  onSelect,
  selected,
  homeKey,
  cameraCommand,
  labels,
  panelOpen,
}: GlobeProps) {
  const { camera, gl, size } = useThree();
  const figureBounds = useRef(new Map<string, Rect>());
  // Match the details panel's CSS safe area while retaining a full-size canvas.
  const leftInset = buffer.focus && panelOpen && size.width > 700 ? 348 : 0;
  const viewport = useRef({ x: camera.view?.enabled ? camera.view.offsetX : 0 });
  const viewportTravel = useRef<gsap.core.Tween | null>(null);
  const viewportStarted = useRef(0);
  useEffect(() => {
    const animation = gsap.to(viewport.current, {
      paused: true, x: -leftInset / 2,
      duration: clock.current.reducedMotion ? 0 : 1.2,
      ease: "power3.inOut",
    });
    viewportStarted.current = performance.now();
    viewportTravel.current = animation;
    if (animation.duration() === 0) animation.progress(1);
    return () => { animation.kill(); viewportTravel.current = null; };
  }, [leftInset, clock, clock.current.reducedMotion]);
  const framing = useMemo(
    () => sceneFraming(buffer.focus, buffer.actions, (size.width - leftInset) / size.height),
    [buffer, buffer.focus, buffer.actions.length, size.width, size.height, leftInset],
  );
  const offsets = useMemo(
    () =>
      modelOffsets(
        buffer.actions
          .filter(
            (a): a is SpawnAction =>
              a.type === "spawn" && entityVisible(buffer.actions, a, time),
          )
          .map((a) => ({
            id: a.entityId,
            position: positionAt(buffer.actions, a, time),
            scale: a.scale,
          })),
      ),
    [buffer, buffer.actions.length, time],
  );
  const lastLabels = useRef(0);
  const renderedFrames = useRef(0);
  useFrame(() => {
    const animation = viewportTravel.current;
    if (animation) {
      animation.totalTime((performance.now() - viewportStarted.current) / 1000);
      if (animation.progress() === 1) viewportTravel.current = null;
    }
    const view = camera.view;
    if (Math.abs(viewport.current.x) > 0.01) {
      if (!view?.enabled || view.fullWidth !== size.width || view.fullHeight !== size.height || view.offsetX !== viewport.current.x)
        camera.setViewOffset(size.width, size.height, viewport.current.x, 0, size.width, size.height);
    } else if (view?.enabled) camera.clearViewOffset();
    if (performance.now() - lastLabels.current > 100 && labels.current) {
      lastLabels.current = performance.now();
      const nodes = [
        ...labels.current.querySelectorAll<HTMLElement>("[data-scene-label]"),
      ];
      const stage = gl.domElement.getBoundingClientRect();
      const models = new Map([...figureBounds.current].map(([id, r]) =>
        [id, { ...r, x: r.x + stage.x, y: r.y + stage.y }]));
      const controls = [...document.querySelectorAll<HTMLElement>("[data-map-obstacle]")]
        .filter((node) => node.checkVisibility())
        .map((node) => node.getBoundingClientRect());
      // Batch writes before reads to avoid a layout flush for every label.
      for (const node of nodes) node.style.translate = "0px 0px";
      const items = nodes
        .filter(
          (node) =>
            node.style.display !== "none" &&
            node.parentElement?.style.display !== "none",
        )
        .map((node) => {
          const r = node.getBoundingClientRect();
          return {
            id: node.dataset.sceneLabel!,
            priority: Number(node.dataset.priority),
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            anchor: models.get(node.dataset.sceneLabel!),
          };
        });
      const packed = packLabels(
        items,
        {
          x: Math.max(8, stage.x + 8),
          y: Math.max(70, stage.y + 8),
          width:
            Math.min(stage.right - 8, window.innerWidth - 8) -
            Math.max(8, stage.x + 8),
          height: Math.max(
            100,
            Math.min(stage.bottom - 8, window.innerHeight - 120) -
              Math.max(70, stage.y + 8),
          ),
        },
        size.width < 600 ? 4 : 6,
        [...models.values(), ...controls],
      );
      for (const node of nodes) {
        const p = packed[node.dataset.sceneLabel!];
        node.style.visibility = p?.shown ? "visible" : "hidden";
        node.style.translate = p ? `${p.x}px ${p.y}px` : "0px 0px";
        node.dataset.labelShown = String(Boolean(p?.shown));
        const item = items.find((item) => item.id === node.dataset.sceneLabel);
        const anchor = item?.anchor;
        const tether = node.querySelector("[data-label-tether]");
        if (anchor && item && p?.shown && tether) {
          const card = { ...item.rect, x: item.rect.x + p.x, y: item.rect.y + p.y };
          const toRight = card.x + card.width / 2 > anchor.x + anchor.width / 2;
          tether.setAttribute("x1", String((toRight ? anchor.x + anchor.width : anchor.x) - card.x));
          tether.setAttribute("y1", String(anchor.y + anchor.height / 2 - card.y));
          tether.setAttribute("x2", String(toRight ? 0 : card.width));
          tether.setAttribute("y2", String(card.height / 2));
        }
        node.dataset.figureBounds = JSON.stringify([...models.values()]);
      }
    }
    if (renderedFrames.current < 2 && ++renderedFrames.current === 2)
      gl.domElement.dataset.ready = "true";
  });
  const controls = useRef<OrbitControlsImpl>(null);
  const spawns = buffer.actions.filter(
    (a): a is SpawnAction => a.type === "spawn",
  );
  const speech = buffer.actions
    .filter(
      (a) => a.type === "speech" && a.at <= time && a.at + a.duration > time,
    )
    .filter(
      (a) =>
        "entityId" in a &&
        spawns.some(
          (s) =>
            s.entityId === a.entityId && entityVisible(buffer.actions, s, time),
        ),
    )
    .slice(-1)[0];
  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[-4, 7, 5]} intensity={3.2} color="#fff1d8" />
      <directionalLight position={[4, -2, -4]} intensity={1} color="#c6d8df" />
      <mesh>
        <sphereGeometry args={[2, 96, 64]} />
        <meshStandardMaterial color="#65949b" roughness={0.93} />
      </mesh>
      <Land />
      <Graticule />
      <mesh>
        <sphereGeometry args={[2.04, 64, 48]} />
        <meshBasicMaterial
          color="#81b3ae"
          transparent
          opacity={0.06}
          side={THREE.BackSide}
        />
      </mesh>
      {spawns.map((spawn) => (
        <Entity
          key={spawn.id}
          spawn={spawn}
          actions={buffer.actions}
          clock={clock}
          time={time}
          onSelect={onSelect}
          selected={selected === spawn.entityId}
          speechId={speech?.id}
          labels={labels}
          sources={buffer.focus?.sources ?? []}
          offset={offsets[spawn.entityId] ?? [0, 0]}
          figureBounds={figureBounds}
        />
      ))}
      {buffer.actions
        .filter((a) => a.type === "move" && a.at <= time)
        .map(
          (action) =>
            action.type === "move" && (
              <Route
                key={action.id}
                action={action}
                color={
                  palettes[
                    spawns.find((s) => s.entityId === action.entityId)
                      ?.palette ?? "gold"
                  ]
                }
              />
            ),
        )}
      {buffer.actions
        .filter((a) => a.type === "attack")
        .map(
          (action) =>
            action.type === "attack" && (
              <Attack
                key={action.id}
                action={action}
                actions={buffer.actions}
                clock={clock}
              />
            ),
        )}
      <OrbitControls
        ref={controls}
        enablePan={false}
        minDistance={2.28}
        maxDistance={8}
        enableDamping={!clock.current.reducedMotion}
        dampingFactor={0.08}
        rotateSpeed={0.6}
        zoomSpeed={0.7}
        autoRotate={!buffer.focus && !clock.current.reducedMotion}
        autoRotateSpeed={0.25}
      />
      <CameraRig
        framing={framing}
        focus={buffer.focus}
        controls={controls}
        homeKey={homeKey}
        command={cameraCommand}
      />
    </>
  );
}

export default function Globe(props: Omit<GlobeProps, "labels">) {
  const labels = useRef<HTMLDivElement>(null);
  return (
    <>
      <Canvas
        camera={{ position: [4, 2.6, 4.5], fov: 38, near: 0.01, far: 30 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: true }}
        fallback={
          <div className="webgl-fallback">
            This globe needs a browser with WebGL enabled.
          </div>
        }
      >
        <Suspense fallback={null}>
          <World key={props.session} {...props} labels={labels} />
        </Suspense>
      </Canvas>
      <div ref={labels} className="globe-label-layer" />
    </>
  );
}
