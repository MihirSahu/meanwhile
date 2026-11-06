"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Compass,
  Flag,
  Globe2,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  Plus,
  Minus,
  RotateCcw,
  Route,
  X,
} from "lucide-react";
import {
  currentHistoricalContext,
  type DiscoveryContext,
} from "@/lib/discovery";
import { demos } from "@/lib/demo";
import {
  advanceClock,
  chapterAt,
  entityVisible,
  SceneBuffer,
} from "@/lib/playback";
import { readSceneStream } from "@/lib/scene-stream";
import type { SpawnAction } from "@/lib/scene-schema";
import type { CameraCommand, PlaybackClock } from "./globe";
import { EvidenceDetails } from "./evidence-details";
import { SourceLinks } from "./source-links";

const Globe = dynamic(() => import("./globe"), {
  ssr: false,
  loading: () => (
    <div className="globe-loading">
      <LoaderCircle className="spin" /> Unfolding the world…
    </div>
  ),
});

class GlobeBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="webgl-fallback">
        <Globe2 size={36} />
        <h2>The globe couldn’t load</h2>
        <p>
          Enable WebGL or try a browser with hardware acceleration. Story text
          and playback controls are still available.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function Experience() {
  type Snapshot = {
    buffer: SceneBuffer;
    prompt: string;
    time: number;
    paused: boolean;
  };
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [visitedTitles, setVisitedTitles] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [buffer, setBuffer] = useState(() => new SceneBuffer());
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [awaitingScene, setAwaitingScene] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [homeKey, setHomeKey] = useState(0);
  const [session, setSession] = useState(0);
  const [cameraCommand, setCameraCommand] = useState<CameraCommand | null>(
    null,
  );
  const [, refresh] = useState(0);
  const active = useRef<AbortController | null>(null);
  const pendingPause = useRef<{
    controller: AbortController;
    paused: boolean;
  } | null>(null);
  const clock = useRef<PlaybackClock>({
    time: 0,
    paused: false,
    speed: 1,
    reducedMotion: false,
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      clock.current.reducedMotion = media.matches;
      refresh((n) => n + 1);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      active.current?.abort();
      document.body.style.cursor = "";
    };
  }, []);

  useEffect(() => {
    let frame = 0,
      previous = 0,
      lastPaint = 0;
    const tick = (now: number) => {
      if (previous && !clock.current.paused)
        clock.current.time = advanceClock(
          clock.current.time,
          (now - previous) / 1000,
          clock.current.speed,
          buffer.readyThrough,
        );
      previous = now;
      if (now - lastPaint >= 80) {
        setTime(clock.current.time);
        lastPaint = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [buffer]);

  async function start(
    value: string,
    demo = false,
    discovery?: DiscoveryContext,
  ) {
    if (value.trim().length < 3) return;
    active.current?.abort();
    // A superseded discovery must release its temporary pause before the new
    // request snapshots playback. Its finally block no longer owns the UI.
    if (pendingPause.current) {
      clock.current.paused = pendingPause.current.paused;
      setPaused(pendingPause.current.paused);
      pendingPause.current = null;
    }
    const controller = new AbortController();
    active.current = controller;
    const next = new SceneBuffer();
    const previous = {
      buffer,
      prompt,
      time: clock.current.time,
      paused: clock.current.paused,
    };
    let adopted = false,
      recordedFocus = false;
    const adopt = () => {
      if (adopted || controller.signal.aborted || active.current !== controller)
        return;
      adopted = true;
      if (discovery) setHistory((items) => [...items, previous].slice(-6));
      else {
        setHistory([]);
        setVisitedTitles([]);
      }
      pendingPause.current = null;
      setAwaitingScene(false);
      clock.current.time = 0;
      clock.current.paused = false;
      setTime(0);
      setPaused(false);
      setSelected(null);
      setCameraCommand(null);
      setBuffer(next);
      setPrompt(discovery ? (next.focus?.title ?? value) : value);
      setSession((n) => n + 1);
      setDiscovering(false);
    };
    setError(null);
    setStreaming(true);
    setAwaitingScene(true);
    setDiscovering(Boolean(discovery));
    if (discovery) {
      pendingPause.current = { controller, paused: previous.paused };
      clock.current.paused = true;
      setPaused(true);
    }
    try {
      const response = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: value.trim(),
          demo,
          ...(discovery ? { discovery } : {}),
        }),
        signal: controller.signal,
      });
      await readSceneStream(response, next, controller.signal, () => {
        if (controller.signal.aborted || active.current !== controller) return;
        if (next.focus && next.readyThrough > 0) {
          adopt();
          if (!recordedFocus) {
            recordedFocus = true;
            const title = next.focus.title;
            setVisitedTitles((titles) =>
              [...titles.filter((item) => item !== title), title].slice(-8),
            );
          }
        }
        refresh((n) => n + 1);
      });
    } catch (cause) {
      if (!controller.signal.aborted && active.current === controller)
        setError(
          cause instanceof Error &&
            !("issues" in cause) &&
            !(cause instanceof SyntaxError)
            ? cause.message
            : "The scene contained invalid data. You can replay the available portion or try again.",
        );
    } finally {
      if (active.current === controller) {
        setStreaming(false);
        setAwaitingScene(false);
        setDiscovering(false);
        if (discovery && !adopted) {
          clock.current.paused = previous.paused;
          setPaused(previous.paused);
          pendingPause.current = null;
        }
      }
    }
  }

  function goBack() {
    const previous = history.at(-1);
    if (!previous) return;
    active.current?.abort();
    active.current = null;
    pendingPause.current = null;
    setAwaitingScene(false);
    setStreaming(false);
    setDiscovering(false);
    setHistory((items) => items.slice(0, -1));
    setBuffer(previous.buffer);
    setPrompt(previous.prompt);
    clock.current.time = previous.time;
    clock.current.paused = previous.paused;
    setTime(previous.time);
    setPaused(previous.paused);
    setSelected(null);
    setError(null);
    setCameraCommand(null);
    setSession((n) => n + 1);
  }

  function seek(value: number) {
    if (discovering) return;
    clock.current.time = Math.max(0, Math.min(value, buffer.readyThrough));
    setTime(clock.current.time);
  }
  function togglePause() {
    if (discovering) return;
    clock.current.paused = !clock.current.paused;
    setPaused(clock.current.paused);
    setTime(clock.current.time);
  }
  function command(kind: CameraCommand["kind"]) {
    setCameraCommand((current) => ({
      kind,
      sequence: (current?.sequence ?? 0) + 1,
    }));
  }
  const chapter = chapterAt(buffer.actions, time);
  const focus = buffer.focus;
  const discovery = focus
    ? currentHistoricalContext(focus, buffer.actions, time, visitedTitles)
    : null;
  const playable = buffer.readyThrough > 0;
  const ended = buffer.complete && time >= buffer.readyThrough;
  const waiting = playable && !buffer.complete && time >= buffer.readyThrough;
  const spawns = buffer.actions.filter(
    (a): a is SpawnAction =>
      a.type === "spawn" && entityVisible(buffer.actions, a, time),
  );
  const entity = spawns.find((a) => a.entityId === selected);
  const status = discovering
    ? `Looking elsewhere in ${discovery?.periodLabel ?? "this period"}`
    : error
      ? "Stream interrupted"
      : awaitingScene
        ? focus
          ? "Preparing a replacement story"
          : "Finding your moment"
        : ended
          ? "Story complete"
          : paused
            ? "Paused"
            : waiting
              ? "Waiting for the next chapter"
              : streaming
                ? focus
                  ? "Building the story"
                  : "Finding your moment"
                : playable
                  ? "Story playing"
                  : "A little curiosity goes a long way";

  return (
    <main className={focus ? "experience has-story" : "experience"}>
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Meanwhile home">
          <span className="brand-mark">
            <Globe2 size={22} />
          </span>
          meanwhile<span className="wordmark-dot">.</span>
        </a>
        <span className="masthead-note">A world of stories</span>
        <span className="edition">
          <span /> An exploration in time
        </span>
      </header>

      <section
        className="world-stage"
        aria-label="Interactive historical globe"
      >
        <div className="globe-halo" />
        <div
          className="globe-canvas"
          tabIndex={0}
          role="region"
          aria-label="Globe. Use arrow keys to rotate, plus and minus to zoom, and Home to recenter."
          onKeyDown={(event) => {
            const keys: Record<string, CameraCommand["kind"]> = {
              ArrowLeft: "left",
              ArrowRight: "right",
              ArrowUp: "up",
              ArrowDown: "down",
              "+": "in",
              "=": "in",
              "-": "out",
            };
            if (keys[event.key]) {
              event.preventDefault();
              command(keys[event.key]);
            }
            if (event.key === "Home") {
              event.preventDefault();
              setHomeKey((n) => n + 1);
            }
          }}
        >
          <GlobeBoundary>
            <Globe
              session={session}
              buffer={buffer}
              clock={clock}
              time={time}
              selected={entity?.entityId ?? null}
              onSelect={setSelected}
              homeKey={homeKey}
              cameraCommand={cameraCommand}
            />
          </GlobeBoundary>
        </div>
        <div className="world-coordinate">
          <Compass size={14} />
          <span>
            {focus
              ? `${Math.abs(focus.center.lat).toFixed(1)}° ${focus.center.lat >= 0 ? "N" : "S"} / ${Math.abs(focus.center.lon).toFixed(1)}° ${focus.center.lon >= 0 ? "E" : "W"}`
              : "Every place has a past"}
          </span>
        </div>
        <div className="world-tools">
          <button aria-label="Zoom in" onClick={() => command("in")}>
            <Plus size={17} />
          </button>
          <button aria-label="Zoom out" onClick={() => command("out")}>
            <Minus size={17} />
          </button>
          <button
            aria-label="Recenter globe"
            onClick={() => setHomeKey((n) => n + 1)}
          >
            <Maximize2 size={16} />
          </button>
        </div>
        {!focus && (
          <div className="globe-hint">
            Drag to explore <span>·</span> Scroll to get closer
          </div>
        )}
      </section>

      <div className="story-column">
        {!focus ? (
          <section className="intro">
            <p className="eyebrow">History, in a different light</p>
            <h1>
              Somewhere,
              <br />
              something
              <br />
              <em>changed the world.</em>
            </h1>
            <p className="intro-copy">
              Pick a moment in history.
              <br />
              See its story unfold, one place at a time.
            </p>
          </section>
        ) : (
          <section className="story-card">
            <div className="story-meta">
              <span className="mode-badge">
                {focus.mode === "demo"
                  ? "Curated demonstration"
                  : "Generated story"}
              </span>
              <span>{focus.location}</span>
            </div>
            {focus.discoveryFrom && (
              <p className="discovery-origin">
                Meanwhile, during {focus.discoveryFrom.period}
              </p>
            )}
            <p className="eyebrow story-period">{focus.period}</p>
            <h1>{focus.title}</h1>
            <div className="chapter-copy">
              <p className="chapter-date">
                {chapter?.date ?? "Preparing the first chapter"}
              </p>
              <h2>{chapter?.title ?? "Traveling to the story…"}</h2>
              <p>
                {chapter?.caption ??
                  "The camera travels as the scene arrives. You can explore the globe at any time."}
                {chapter && (
                  <SourceLinks
                    sources={focus.sources}
                    ids={chapter.sourceIds}
                    fallback
                  />
                )}
              </p>
            </div>
            <div className="discovery-actions">
              {discovery && (
                <button
                  className="meanwhile-button"
                  disabled={streaming || !playable}
                  onClick={() =>
                    void start("Meanwhile elsewhere", false, discovery)
                  }
                >
                  <Globe2 size={16} /> Meanwhile… <ArrowRight size={15} />
                </button>
              )}
              {history.length > 0 && (
                <button className="text-button" onClick={goBack}>
                  Back to previous story
                </button>
              )}
              {discovery && <small>Elsewhere in {discovery.periodLabel}</small>}
            </div>
            <details className="story-details">
              <summary>Context, objects & sources</summary>
              <p className="reconstruction-note">
                Miniature staging, positions, troop formations, and routes are
                schematic reconstructions. Imagined perspectives are labeled;
                narrated context is not a quotation.
              </p>
              {spawns.length > 0 && (
                <div className="entity-list" aria-label="Select a scene object">
                  {spawns.map((spawn) => (
                    <button
                      key={spawn.entityId}
                      aria-pressed={entity?.entityId === spawn.entityId}
                      onClick={() => setSelected(spawn.entityId)}
                    >
                      {spawn.label}
                    </button>
                  ))}
                </div>
              )}
              <EvidenceDetails buffer={buffer} claimIds={chapter?.claimIds} />
              <ul className="source-list">
                {focus.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        )}

        <section
          className="prompt-section"
          aria-label="Choose a historical story"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void start(prompt);
            }}
          >
            <label htmlFor="history-prompt">What are you curious about?</label>
            <div className="prompt-input">
              <input
                id="history-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="A war, a journey, a turning point…"
                minLength={3}
                maxLength={500}
                required
                autoComplete="off"
              />
              <button
                type="submit"
                aria-label="Explore this story"
                disabled={prompt.trim().length < 3}
              >
                <ArrowRight size={21} />
              </button>
            </div>
          </form>
          <div className="stream-status" role="status">
            {streaming && <LoaderCircle size={13} className="spin" />}
            {status}
            {streaming && (
              <button
                className="text-button"
                onClick={() => {
                  active.current?.abort();
                  setStreaming(false);
                  setError(
                    "Generation stopped. Any available chapters can still be played or replayed.",
                  );
                }}
              >
                Stop
              </button>
            )}
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <p className="demo-label">Try a curated story</p>
          <div className="demo-options">
            {demos.map((demo) => (
              <button
                key={demo.prompt}
                onClick={() => void start(demo.prompt, true)}
              >
                {demo.icon === "flag" ? (
                  <Flag size={16} />
                ) : (
                  <Route size={16} />
                )}
                <span>
                  {demo.label}
                  <small>
                    {demo.period} <span>·</span> {demo.region}
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <p className="demo-disclosure">
            Sample stories are curated demonstrations. Other prompts require a
            connected scene provider.
          </p>
        </section>
      </div>

      {entity && (
        <aside className="selection-card" aria-label="Selected object">
          <button
            className="close-button"
            aria-label="Close object details"
            onClick={() => setSelected(null)}
          >
            <X size={16} />
          </button>
          <p className="eyebrow">In this story</p>
          <h2>{entity.label}</h2>
          <p>
            {entity.asset === "officer"
              ? "Named historical figure; appearance is a stylized placeholder."
              : "A schematic representation in the narrated scene."}
          </p>
          {entity.claimIds?.length ? (
            <EvidenceDetails buffer={buffer} claimIds={entity.claimIds} />
          ) : null}
          {buffer.actions
            .filter(
              (a) =>
                a.type === "speech" &&
                a.entityId === entity.entityId &&
                a.at <= time,
            )
            .slice(-2)
            .map(
              (speech) =>
                speech.type === "speech" && (
                  <p key={speech.id}>
                    <strong>
                      {speech.kind === "quote"
                        ? "Documented quotation"
                        : speech.kind === "reconstruction"
                          ? "Imagined perspective"
                          : "Historical context"}
                    </strong>
                    {speech.text}
                    <SourceLinks
                      sources={focus?.sources ?? []}
                      ids={speech.sourceIds}
                    />
                    {speech.sourceUrl && (
                      <a
                        href={speech.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Quotation source ↗
                      </a>
                    )}
                  </p>
                ),
            )}
          <a href={focus?.sources[0]?.url} target="_blank" rel="noreferrer">
            Story source ↗
          </a>
        </aside>
      )}

      {playable && (
        <section className="playback" aria-label="Story playback">
          <div className="playback-buttons">
            <button
              disabled={discovering}
              aria-label={ended ? "Play again" : paused ? "Play" : "Pause"}
              onClick={() => {
                if (ended) {
                  seek(0);
                  clock.current.paused = false;
                  setPaused(false);
                } else togglePause();
              }}
            >
              {paused || ended ? (
                <Play size={19} fill="currentColor" />
              ) : (
                <Pause size={19} fill="currentColor" />
              )}
            </button>
            <button
              disabled={discovering}
              aria-label="Replay from beginning"
              onClick={() => {
                seek(0);
                clock.current.paused = false;
                setPaused(false);
              }}
            >
              <RotateCcw size={17} />
            </button>
          </div>
          <div className="timeline">
            <div className="timeline-label">
              <span>{chapter?.date ?? focus?.period}</span>
              <span>
                {Math.floor(time)}s / {buffer.readyThrough}s{" "}
                {buffer.complete ? "" : "buffered"}
              </span>
            </div>
            <input
              disabled={discovering}
              aria-label="Story position in seconds"
              type="range"
              min={0}
              max={buffer.readyThrough}
              step={0.1}
              value={time}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <div className="buffer-label">
              {buffer.complete
                ? "All chapters ready"
                : error
                  ? "Available chapters"
                  : "More chapters arriving…"}
            </div>
          </div>
          <label className="speed-select">
            <span className="sr-only">Playback speed</span>
            <select
              value={speed}
              onChange={(event) => {
                const value = Number(event.target.value);
                clock.current.speed = value;
                setSpeed(value);
              }}
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
        </section>
      )}
      <footer className="page-footer">
        <span>One planet. Countless perspectives.</span>
        <span>
          {focus
            ? "Reconstructed scenes · Sourced stories"
            : "Follow your curiosity"}
        </span>
      </footer>
    </main>
  );
}
