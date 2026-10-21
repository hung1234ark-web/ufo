import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { SaucerAudio } from "@/game/audio";
import { createGame, draw, loadBest, step, type Game, type Input } from "@/game/engine";

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
  }
}

type Hud = {
  mode: Game["mode"];
  score: number;
  best: number;
  combo: number;
  hull: number;
  heat: number;
  hint: string;
  caught: number;
  danger: number;
  choppers: number;
  muted: boolean;
};

const EMPTY: Hud = {
  mode: "title",
  score: 0,
  best: 0,
  combo: 0,
  hull: 3,
  heat: 0,
  hint: "",
  caught: 0,
  danger: 0,
  choppers: 0,
  muted: false,
};

function snapshot(g: Game, muted: boolean): Hud {
  return {
    mode: g.mode,
    score: g.score,
    best: g.best,
    combo: g.combo,
    hull: g.hull,
    heat: g.heat,
    hint: g.hint,
    caught: g.caught,
    danger: g.danger,
    choppers: g.choppers.length,
    muted,
  };
}

export function SaucerGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<Game | null>(null);
  const audioRef = useRef<SaucerAudio | null>(null);
  const keysRef = useRef(new Set<string>());
  const qaRef = useRef<Set<string> | null>(null);
  const steerRef = useRef<number | null>(null);
  const stickRef = useRef({ x: 0, y: 0, active: false });
  const beamRef = useRef(false);
  const [hud, setHud] = useState<Hud>(EMPTY);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [beamDown, setBeamDown] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audio = new SaucerAudio();
    audioRef.current = audio;
    const game = createGame(loadBest());
    game.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stateRef.current = game;
    setHud(snapshot(game, audio.muted));

    const size = { w: 1, h: 1, dpr: 1 };
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      size.dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.w = Math.max(1, rect.width);
      size.h = Math.max(1, rect.height);
      canvas.width = Math.floor(size.w * size.dpr);
      canvas.height = Math.floor(size.h * size.dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    const codes = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
    ]);

    const onKeyDown = (e: KeyboardEvent) => {
      if (codes.has(e.code)) e.preventDefault();
      keysRef.current.add(e.code);
      const g = stateRef.current;
      if (!g || e.repeat) return;
      if (e.code === "Escape" || e.code === "KeyP") {
        if (g.mode === "play") g.mode = "pause";
        else if (g.mode === "pause") g.mode = "play";
        setHud(snapshot(g, audio.muted));
      }
      if (e.code === "KeyM") {
        audio.muted = !audio.muted;
        setHud(snapshot(g, audio.muted));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };
    const clearKeys = () => keysRef.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", clearKeys);

    window.__controlsTest = {
      getYaw: () => stateRef.current?.yaw ?? 0,
      getSpeed: () => stateRef.current?.speed ?? 0,
      setSteer: (v) => {
        steerRef.current = v;
      },
      setKeys: (list) => {
        qaRef.current = new Set(list);
      },
    };

    let raf = 0;
    let alive = true;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;
    let lastMode = game.mode;

    const readInput = (g: Game): Input => {
      if (g.mode === "title") {
        return {
          steer: Math.sin(g.time * 0.55) * 0.8,
          throttle: 0.48,
          beam: false,
        };
      }
      if (g.mode !== "play") return { steer: 0, throttle: 0, beam: false };
      const held = qaRef.current ?? keysRef.current;
      let steer = 0;
      let throttle = 0;
      if (held.has("KeyA") || held.has("ArrowLeft")) steer += 1;
      if (held.has("KeyD") || held.has("ArrowRight")) steer -= 1;
      if (held.has("KeyW") || held.has("ArrowUp")) throttle += 1;
      if (held.has("KeyS") || held.has("ArrowDown")) throttle -= 1;
      if (steerRef.current !== null) steer = steerRef.current;
      if (!qaRef.current && stickRef.current.active) {
        steer = Math.max(-1, Math.min(1, -stickRef.current.x));
        throttle = Math.max(-1, Math.min(1, -stickRef.current.y));
      }
      const beam = held.has("Space") || beamRef.current;
      return {
        steer: Math.max(-1, Math.min(1, steer)),
        throttle: Math.max(-1, Math.min(1, throttle)),
        beam,
      };
    };

    const frame = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      const g = stateRef.current;
      if (g) {
        let steps = 0;
        while (acc >= 1 / 60 && steps < 5) {
          step(g, readInput(g), 1 / 60);
          acc -= 1 / 60;
          steps += 1;
        }
        if (g.sfx.length) {
          const batch = g.sfx.splice(0, g.sfx.length);
          for (const sfx of batch) {
            audio.play(sfx);
            if (!g.reduce && sfx === "hit") navigator.vibrate?.(26);
            if (!g.reduce && sfx === "abduct") navigator.vibrate?.(10);
          }
        }
        const moving = g.mode === "play" || g.mode === "title";
        audio.sync(g.speed, g.beamOn, moving);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
          draw(ctx, g, size.w, size.h);
        }
        hudAcc += dt;
        if (hudAcc > 0.12 || g.mode !== lastMode) {
          hudAcc = 0;
          lastMode = g.mode;
          setHud(snapshot(g, audio.muted));
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", clearKeys);
      if (window.__controlsTest) delete window.__controlsTest;
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  const publish = () => {
    const g = stateRef.current;
    const audio = audioRef.current;
    if (g) setHud(snapshot(g, audio?.muted ?? false));
  };

  const launch = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    const prev = stateRef.current;
    const audio = audioRef.current;
    audio?.ensure();
    const next = createGame(prev?.best ?? loadBest());
    next.mode = "play";
    next.reduce = prev?.reduce ?? false;
    stateRef.current = next;
    stickRef.current = { x: 0, y: 0, active: false };
    beamRef.current = false;
    setKnob({ x: 0, y: 0 });
    setBeamDown(false);
    setHud(snapshot(next, audio?.muted ?? false));
  };

  const togglePause = () => {
    const g = stateRef.current;
    if (!g) return;
    if (g.mode === "play") g.mode = "pause";
    else if (g.mode === "pause") g.mode = "play";
    publish();
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.ensure();
    audio.muted = !audio.muted;
    publish();
  };

  const moveStick = (clientX: number, clientY: number, el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const max = rect.width / 2;
    const mag = Math.hypot(dx, dy) || 1;
    const limited = Math.min(mag, max);
    dx = (dx / mag) * limited;
    dy = (dy / mag) * limited;
    stickRef.current = { x: dx / max, y: dy / max, active: true };
    setKnob({ x: dx, y: dy });
  };

  return (
    <main className="saucer relative h-dvh w-full overflow-hidden bg-bg text-fg">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div>
          <p className="font-mono text-xs tracking-widest text-muted">ĐIỂM</p>
          <p className="font-display text-4xl leading-none font-extrabold">{hud.score}</p>
          <p className="mt-1 font-mono text-xs text-muted">
            {hud.combo > 1 ? <span className="text-amber">x{hud.combo} · </span> : null}
            {hud.caught} mẫu
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="pointer-events-none text-right">
            <div className="mb-1 flex justify-end gap-1" aria-label={`Vỏ ${hud.hull} trên 3`}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-2.5 w-4 rounded-sm ${i < hud.hull ? "bg-beam" : "bg-surface"}`}
                />
              ))}
            </div>
            <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full origin-left bg-amber"
                style={{ transform: `scaleX(${Math.max(0, Math.min(1, hud.heat))})` }}
              />
            </div>
            <p className="mt-1 font-mono text-xs text-muted">
              {hud.choppers > 0 ? <span className="text-amber">ĐÈN PHA · </span> : null}
              NHIỆT
            </p>
          </div>
          {hud.mode === "play" || hud.mode === "pause" ? (
            <button
              type="button"
              onClick={togglePause}
              aria-label={hud.mode === "pause" ? "Tiếp tục" : "Tạm dừng"}
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface text-fg"
            >
              {hud.mode === "pause" ? <Play size={18} /> : <Pause size={18} />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={hud.muted ? "Bật tiếng" : "Tắt tiếng"}
            className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface text-fg"
          >
            {hud.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </div>

      {hud.mode === "play" && hud.hint ? (
        <p className="pointer-events-none absolute inset-x-0 bottom-28 text-center font-mono text-xs text-amber">
          {hud.hint}
        </p>
      ) : null}

      {hud.mode === "title" ? (
        <section className="absolute inset-x-0 bottom-0 p-4 pb-8">
          <div className="mx-auto w-full max-w-md rounded-3xl border border-muted/30 bg-bg/80 p-5 backdrop-blur-md">
            <p className="font-mono text-xs tracking-widest text-beam">CAO NGUYÊN · ĐÊM</p>
            <h1 className="font-display text-5xl leading-none font-extrabold">ĐĨA BAY</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Bay thấp trên cánh đồng, hạ tia và kéo mẫu lên đĩa. Nhiệt càng cao, trực thăng càng bám đèn
              pha — đừng đứng trong ánh sáng.
            </p>
            {hud.best > 0 ? (
              <p className="mt-3 font-mono text-xs text-amber">Kỷ lục {hud.best}</p>
            ) : null}
            <button
              type="button"
              onClick={launch}
              className="mt-4 h-12 w-full rounded-full bg-beam font-display text-base font-bold text-bg"
            >
              Cất cánh
            </button>
            <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs text-muted">
              <li>W / ↑ đẩy tới</li>
              <li>S / ↓ hãm</li>
              <li>A / ← rẽ trái</li>
              <li>D / → rẽ phải</li>
              <li className="col-span-2">Giữ Space hoặc nút TIA. Phải bay chậm mới khóa được.</li>
            </ul>
          </div>
        </section>
      ) : null}

      {hud.mode === "pause" ? (
        <section className="absolute inset-0 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl border border-muted/30 bg-bg/85 p-5 text-center backdrop-blur-md">
            <h2 className="font-display text-3xl font-extrabold">Treo giữa trời</h2>
            <p className="mt-2 text-sm text-muted">Đàn vật vẫn ở dưới. Đèn pha thì không nghỉ lâu.</p>
            <button
              type="button"
              onClick={togglePause}
              className="mt-4 h-12 w-full rounded-full bg-beam font-display text-base font-bold text-bg"
            >
              Tiếp tục
            </button>
          </div>
        </section>
      ) : null}

      {hud.mode === "over" ? (
        <section className="absolute inset-x-0 bottom-0 p-4 pb-8">
          <div className="mx-auto w-full max-w-md rounded-3xl border border-muted/30 bg-bg/85 p-5 backdrop-blur-md">
            <p className="font-mono text-xs tracking-widest text-amber">HẾT ĐÊM</p>
            <h2 className="font-display text-4xl leading-none font-extrabold">Mất đĩa</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Đèn pha đã khóa. {hud.caught} mẫu vẫn còn trên đồng.
            </p>
            <p className="mt-4 font-display text-4xl leading-none font-extrabold">{hud.score}</p>
            <p className="mt-1 font-mono text-xs text-muted">Kỷ lục {hud.best}</p>
            <button
              type="button"
              onClick={launch}
              className="mt-4 h-12 w-full rounded-full bg-beam font-display text-base font-bold text-bg"
            >
              Bay lại
            </button>
          </div>
        </section>
      ) : null}

      {hud.mode === "play" ? (
        <div className="touch-only pointer-events-none absolute inset-x-0 bottom-0 items-end justify-between px-4">
          <div
            className="pointer-events-auto relative h-28 w-28 rounded-full border border-muted/40 bg-bg/50"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moveStick(e.clientX, e.clientY, e.currentTarget);
            }}
            onPointerMove={(e) => {
              if (!stickRef.current.active) return;
              moveStick(e.clientX, e.clientY, e.currentTarget);
            }}
            onPointerUp={(e) => {
              stickRef.current = { x: 0, y: 0, active: false };
              setKnob({ x: 0, y: 0 });
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              stickRef.current = { x: 0, y: 0, active: false };
              setKnob({ x: 0, y: 0 });
            }}
            aria-label="Cần lái"
            role="presentation"
          >
            <span
              className="absolute top-1/2 left-1/2 h-11 w-11 rounded-full bg-beam"
              style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
            />
          </div>
          <button
            type="button"
            aria-label="Hạ tia"
            aria-pressed={beamDown}
            className={`pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full border font-display text-sm font-bold ${
              beamDown ? "border-beam bg-beam text-bg" : "border-beam/50 bg-bg/60 text-beam"
            }`}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              beamRef.current = true;
              setBeamDown(true);
            }}
            onPointerUp={(e) => {
              beamRef.current = false;
              setBeamDown(false);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
            onPointerCancel={() => {
              beamRef.current = false;
              setBeamDown(false);
            }}
          >
            TIA
          </button>
        </div>
      ) : null}
    </main>
  );
}
