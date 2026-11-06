"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { SceneAction, SpawnAction } from "@/lib/scene-schema";

export const palettes = {
  clay: "#be7452",
  indigo: "#365c7b",
  sage: "#708772",
  gold: "#bf9b56",
};
type Clock = {
  current: {
    time: number;
    paused: boolean;
    speed: number;
    reducedMotion: boolean;
  };
};

function Box({
  at = [0, 0, 0],
  size,
  color,
  rotation,
}: {
  at?: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={at} rotation={rotation} castShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Human({
  color,
  officer,
  clock,
  actions,
  entity,
  offset = 0,
}: {
  color: string;
  officer?: boolean;
  clock: Clock;
  actions: SceneAction[];
  entity: SpawnAction;
  offset?: number;
}) {
  const root = useRef<THREE.Group>(null);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const player = new THREE.AnimationMixer(root.current);
    const clip = new THREE.AnimationClip("walk", 0.8, [
      new THREE.NumberKeyframeTrack(
        "legL.rotation[x]",
        [0, 0.2, 0.4, 0.6, 0.8],
        [0, 0.55, 0, -0.55, 0],
      ),
      new THREE.NumberKeyframeTrack(
        "legR.rotation[x]",
        [0, 0.2, 0.4, 0.6, 0.8],
        [0, -0.55, 0, 0.55, 0],
      ),
      new THREE.NumberKeyframeTrack(
        "armL.rotation[x]",
        [0, 0.2, 0.4, 0.6, 0.8],
        [0, -0.35, 0, 0.35, 0],
      ),
      new THREE.NumberKeyframeTrack(
        "armR.rotation[x]",
        [0, 0.2, 0.4, 0.6, 0.8],
        [0, 0.35, 0, -0.35, 0],
      ),
    ]);
    player.clipAction(clip).play();
    mixer.current = player;
    return () => {
      player.stopAllAction();
      player.uncacheRoot(player.getRoot());
      mixer.current = null;
    };
  }, []);
  useFrame(() => {
    const time = clock.current.time;
    const move = actions.find(
      (a) =>
        a.type === "move" &&
        a.entityId === entity.entityId &&
        time >= a.at &&
        time < a.at + a.duration,
    );
    mixer.current?.setTime(
      move && !clock.current.reducedMotion ? time - move.at + offset : 0,
    );
  });
  return (
    <group ref={root}>
      <Box at={[0, 0.75, 0]} size={[0.43, 0.52, 0.27]} color={color} />
      <Box at={[0, 1.18, 0]} size={[0.34, 0.35, 0.32]} color="#ddbb92" />
      <Box
        at={[0, 1.4, -0.01]}
        size={[officer ? 0.46 : 0.38, officer ? 0.16 : 0.12, 0.39]}
        color={officer ? "#2e3436" : color}
      />
      <Box at={[0, 0.65, 0.15]} size={[0.45, 0.075, 0.025]} color="#d1b778" />
      <group name="legL" position={[-0.115, 0.48, 0]}>
        <Box at={[0, -0.23, 0]} size={[0.17, 0.46, 0.2]} color="#3a4140" />
        <Box at={[0, -0.43, 0.045]} size={[0.19, 0.12, 0.28]} color="#2e302c" />
      </group>
      <group name="legR" position={[0.115, 0.48, 0]}>
        <Box at={[0, -0.23, 0]} size={[0.17, 0.46, 0.2]} color="#3a4140" />
        <Box at={[0, -0.43, 0.045]} size={[0.19, 0.12, 0.28]} color="#2e302c" />
      </group>
      <group name="armL" position={[-0.29, 0.96, 0]}>
        <Box at={[0, -0.2, 0]} size={[0.14, 0.4, 0.2]} color={color} />
      </group>
      <group name="armR" position={[0.29, 0.96, 0]}>
        <Box at={[0, -0.2, 0]} size={[0.14, 0.4, 0.2]} color={color} />
      </group>
      {officer && (
        <Box
          at={[0.11, 0.91, 0.15]}
          size={[0.075, 0.075, 0.035]}
          color="#e3c57f"
        />
      )}
    </group>
  );
}

function Wheel({
  at,
  radius = 0.24,
}: {
  at: [number, number, number];
  radius?: number;
}) {
  return (
    <mesh position={at} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[radius, radius, 0.1, 10]} />
      <meshStandardMaterial color="#393e36" />
    </mesh>
  );
}

function Ship({ color, sail }: { color: string; sail: boolean }) {
  return (
    <group>
      <mesh
        position={[0, 0.16, 0]}
        rotation={[0, Math.PI / 4, 0]}
        scale={[0.65, 1, 1.8]}
      >
        <cylinderGeometry args={[0.52, 0.3, 0.34, 4]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Box at={[0, 0.4, 0]} size={[0.45, 0.3, 0.8]} color="#d7c8a9" />
      {sail ? (
        <>
          <Box at={[0, 1, 0]} size={[0.055, 1.4, 0.055]} color="#62503a" />
          <Box at={[0, 1.2, 0.02]} size={[0.85, 0.65, 0.05]} color="#f0e7cc" />
        </>
      ) : (
        <>
          <Box at={[0, 0.77, -0.12]} size={[0.18, 0.48, 0.2]} color="#3d4544" />
          <Box at={[0, 0.57, 0.52]} size={[0.12, 0.12, 0.55]} color="#3d4544" />
        </>
      )}
    </group>
  );
}

function Buildings({ color, factory }: { color: string; factory?: boolean }) {
  return (
    <group>
      {[
        [-0.4, 0],
        [0.3, 0.2],
        [0, -0.45],
      ].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Box
            at={[0, 0.28 + i * 0.05, 0]}
            size={[0.5, 0.55 + i * 0.1, 0.48]}
            color={i === 1 ? "#ded0ae" : "#d4bea0"}
          />
          <mesh
            position={[0, 0.62 + i * 0.1, 0]}
            rotation={[0, Math.PI / 4, 0]}
            scale={[1, 0.55, 1]}
          >
            <coneGeometry args={[0.43, 0.4, 4]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <Box at={[0.1, 0.3, 0.25]} size={[0.1, 0.15, 0.02]} color="#58686a" />
        </group>
      ))}
      {factory && (
        <Box at={[0.5, 0.75, -0.3]} size={[0.16, 1.5, 0.16]} color="#996449" />
      )}
    </group>
  );
}

export function Asset({
  entity,
  actions,
  clock,
}: {
  entity: SpawnAction;
  actions: SceneAction[];
  clock: Clock;
}) {
  const color = palettes[entity.palette];
  switch (entity.asset) {
    case "infantry":
      return (
        <group>
          {Array.from({ length: 6 }, (_, i) => (
            <group
              key={i}
              position={[
                ((i % 3) - 1) * 0.6,
                0,
                (Math.floor(i / 3) - 0.5) * 0.65,
              ]}
            >
              <Human
                color={color}
                entity={entity}
                actions={actions}
                clock={clock}
                offset={i * 0.08}
              />
            </group>
          ))}
          <Box at={[-1.05, 1.05, 0]} size={[0.04, 2.1, 0.04]} color="#5e513c" />
          <Box at={[-0.8, 1.85, 0]} size={[0.5, 0.32, 0.04]} color={color} />
        </group>
      );
    case "officer":
      return (
        <Human
          color={color}
          officer
          entity={entity}
          actions={actions}
          clock={clock}
        />
      );
    case "steamship":
    case "sailship":
      return <Ship color={color} sail={entity.asset === "sailship"} />;
    case "city":
    case "factory":
      return <Buildings color={color} factory={entity.asset === "factory"} />;
    case "tree":
      return (
        <group>
          <Box at={[0, 0.35, 0]} size={[0.15, 0.7, 0.15]} color="#7e6647" />
          <mesh position={[0, 0.95, 0]}>
            <coneGeometry args={[0.5, 1.2, 5]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      );
    case "cannon":
      return (
        <group>
          <Box at={[0, 0.35, 0]} size={[0.7, 0.2, 0.9]} color={color} />
          <mesh position={[0, 0.6, 0.2]} rotation={[Math.PI / 2 - 0.2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.17, 1.1, 8]} />
            <meshStandardMaterial color="#41494a" />
          </mesh>
          <Wheel at={[-0.45, 0.25, 0]} />
          <Wheel at={[0.45, 0.25, 0]} />
        </group>
      );
    case "train":
      return (
        <group>
          {[0, 0.85, 1.6].map((z, i) => (
            <group key={i} position={[0, 0, z]}>
              <Box at={[0, 0.4, 0]} size={[0.5, 0.6, 0.7]} color={color} />
              <Wheel at={[-0.3, 0.15, 0]} radius={0.16} />
              <Wheel at={[0.3, 0.15, 0]} radius={0.16} />
            </group>
          ))}
          <Box at={[0, 0.9, -0.18]} size={[0.15, 0.5, 0.16]} color="#454841" />
        </group>
      );
    case "horse":
      return (
        <group>
          <Box at={[0, 0.55, 0]} size={[0.4, 0.4, 1]} color="#96714d" />
          <Box at={[0, 0.9, 0.45]} size={[0.25, 0.65, 0.3]} color="#96714d" />
          {[-0.16, 0.16].flatMap((x) =>
            [-0.3, 0.3].map((z) => (
              <Box
                key={`${x}${z}`}
                at={[x, 0.2, z]}
                size={[0.12, 0.45, 0.13]}
                color="#6c5036"
              />
            )),
          )}
          <group position={[0, 0.65, -0.05]} scale={0.7}>
            <Human
              color={color}
              entity={entity}
              actions={actions}
              clock={clock}
            />
          </group>
          <Box
            at={[-0.3, 0.65, -0.2]}
            size={[0.35, 0.4, 0.4]}
            color="#b8a079"
          />
        </group>
      );
  }
}
