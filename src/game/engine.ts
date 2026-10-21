import type { Sfx } from "@/game/audio";

export type Mode = "title" | "play" | "pause" | "over";
export type Kind = "cow" | "sheep" | "horse" | "goat" | "truck";

export type Input = {
  steer: number;
  throttle: number;
  beam: boolean;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: "beam" | "amber" | "fg";
};

type Floater = { x: number; y: number; life: number; max: number; text: string };
type Ring = { x: number; y: number; r: number; life: number };

type Specimen = {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  phase: number;
  face: number;
  charge: number;
  alive: boolean;
  chunk: string;
  wobble: number;
};

type Chopper = {
  id: number;
  x: number;
  y: number;
  yaw: number;
  lock: number;
  rotor: number;
};

type Tree = { x: number; y: number; r: number };
type Barn = { x: number; y: number; w: number; h: number };
type Pond = { x: number; y: number; rx: number; ry: number };
type Fly = { x: number; y: number; phase: number };

type Chunk = {
  key: string;
  cx: number;
  cy: number;
  shade: string;
  trees: Tree[];
  barns: Barn[];
  ponds: Pond[];
  road: "h" | "v" | null;
  flies: Fly[];
};

export type Game = {
  mode: Mode;
  x: number;
  y: number;
  yaw: number;
  speed: number;
  hull: number;
  score: number;
  best: number;
  caught: number;
  combo: number;
  comboT: number;
  heat: number;
  iframes: number;
  time: number;
  hint: string;
  beamOn: boolean;
  trauma: number;
  hitstop: number;
  flash: number;
  danger: number;
  reduce: boolean;
  alerted: boolean;
  camX: number;
  camY: number;
  nextId: number;
  chopperCd: number;
  lockId: number;
  chunks: Map<string, Chunk>;
  specimens: Specimen[];
  choppers: Chopper[];
  particles: Particle[];
  texts: Floater[];
  rings: Ring[];
  sfx: Sfx[];
};

const CHUNK = 960;
const REACH = 64;
const LOCK_SPEED = 150;
const POINTS: Record<Kind, number> = {
  cow: 100,
  sheep: 80,
  horse: 160,
  goat: 120,
  truck: 260,
};

const SAVE_KEY = "dia-bay-v1";

const INK = "#07090f";
const FG = "#e7f2ea";
const BEAM = "#2ee6c7";
const AMBER = "#f0b45a";
const SHADES = ["#101810", "#121c14", "#0e1611", "#182218"];

export function kindLabel(kind: Kind): string {
  if (kind === "cow") return "Bò";
  if (kind === "sheep") return "Cừu";
  if (kind === "horse") return "Ngựa";
  if (kind === "goat") return "Dê";
  return "Xe tải";
}

export function loadBest(): number {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw) as { best?: unknown };
    return typeof data.best === "number" && Number.isFinite(data.best) ? data.best : 0;
  } catch {
    return 0;
  }
}

export function saveBest(best: number) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, best }));
  } catch {
    /* private mode */
  }
}

export function createGame(best: number): Game {
  const game: Game = {
    mode: "title",
    x: 0,
    y: 0,
    yaw: 0,
    speed: 0,
    hull: 3,
    score: 0,
    best,
    caught: 0,
    combo: 0,
    comboT: 0,
    heat: 0,
    iframes: 0,
    time: 0,
    hint: "",
    beamOn: false,
    trauma: 0,
    hitstop: 0,
    flash: 0,
    danger: 0,
    reduce: false,
    alerted: false,
    camX: 0,
    camY: 0,
    nextId: 1,
    chopperCd: 2,
    lockId: -1,
    chunks: new Map(),
    specimens: [],
    choppers: [],
    particles: [],
    texts: [],
    rings: [],
    sfx: [],
  };
  ensureWorld(game);
  return game;
}

export function step(game: Game, input: Input, dt: number) {
  game.time += dt;
  updateFx(game, dt);
  if (game.mode === "pause" || game.mode === "over") return;
  if (game.hitstop > 0) {
    game.hitstop -= dt;
    return;
  }

  const playing = game.mode === "play";
  const steer = clamp(input.steer, -1, 1);
  const throttle = clamp(input.throttle, -1, 1);

  if (throttle > 0) game.speed += 270 * throttle * dt;
  else if (throttle < 0) game.speed += 420 * throttle * dt;
  else if (game.speed > 0) game.speed = Math.max(0, game.speed - 78 * dt);
  else game.speed = Math.min(0, game.speed + 78 * dt);
  game.speed = clamp(game.speed, -90, 340);

  // Chase/top-down: A is +steer. +yaw turns the nose left on screen.
  // forward = (-sin(yaw), -cos(yaw)); yaw 0 faces up.
  const speedFactor = clamp(Math.abs(game.speed) / 70, 0.45, 1);
  game.yaw += steer * 2.55 * speedFactor * dt;

  const fx = -Math.sin(game.yaw);
  const fy = -Math.cos(game.yaw);
  game.x += fx * game.speed * dt;
  game.y += fy * game.speed * dt;

  if (game.iframes > 0) game.iframes -= dt;
  if (playing && game.comboT > 0) {
    game.comboT -= dt;
    if (game.comboT <= 0) {
      game.comboT = 0;
      game.combo = 0;
    }
  }

  ensureWorld(game);
  for (const s of game.specimens) updateSpecimen(s, dt);

  let locked: Specimen | null = null;
  if (playing && input.beam) {
    game.beamOn = true;
    game.heat = Math.min(1, game.heat + dt * 0.22);
    if (game.speed > LOCK_SPEED) game.hint = "Chậm lại để khóa tia";
    else {
      locked = nearest(game);
      if (!locked) game.hint = "Bay đúng trên mục tiêu";
      else {
        locked.charge += dt / 0.8;
        game.hint = locked.charge > 0.72 ? "Sắp lên đĩa" : `Giữ tia · ${kindLabel(locked.kind)}`;
        if (locked.charge >= 1) {
          collect(game, locked);
          locked = null;
        }
      }
    }
  } else {
    game.beamOn = false;
    game.hint = "";
    if (playing) game.heat = Math.max(0, game.heat - dt * 0.1);
  }

  for (const s of game.specimens) {
    if (s !== locked) s.charge = Math.max(0, s.charge - dt * 1.5);
  }
  game.lockId = locked ? locked.id : -1;

  if (playing && game.heat > 0.6 && !game.alerted) {
    game.alerted = true;
    game.sfx.push("alert");
  }
  if (game.heat < 0.42) game.alerted = false;

  game.chopperCd -= dt;
  const cap = game.score >= 1600 ? 2 : 1;
  if (playing && game.heat > 0.56 && game.choppers.length < cap && game.chopperCd <= 0) {
    spawnChopper(game);
    game.chopperCd = 8;
  }

  let danger = 0;
  for (const c of game.choppers) {
    updateChopper(game, c, dt, playing);
    danger = Math.max(danger, c.lock / 1.15);
  }
  game.danger = danger;

  if (Math.abs(game.speed) > 110 && Math.random() < 0.45) {
    burst(game, game.x - fx * 18, game.y - fy * 18, "fg", 1);
  }

  const look = 78 * clamp(game.speed / 340, -0.25, 1);
  const tx = game.x + fx * look;
  const ty = game.y + fy * look;
  const k = 1 - Math.exp(-5.5 * dt);
  game.camX += (tx - game.camX) * k;
  game.camY += (ty - game.camY) * k;
}

export function draw(ctx: CanvasRenderingContext2D, game: Game, w: number, h: number) {
  if (w < 2 || h < 2) return;
  const amp = (game.reduce ? 0.12 : 1) * game.trauma * game.trauma;
  const shx = Math.sin(game.time * 46) * 14 * amp;
  const shy = Math.cos(game.time * 37) * 10 * amp;

  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2 + shx, h / 2 + shy);
  const left = game.camX - w / 2 - 80;
  const top = game.camY - h / 2 - 80;
  const right = game.camX + w / 2 + 80;
  const bottom = game.camY + h / 2 + 80;

  for (const ch of game.chunks.values()) {
    const x0 = ch.cx * CHUNK;
    const y0 = ch.cy * CHUNK;
    if (x0 > right || y0 > bottom || x0 + CHUNK < left || y0 + CHUNK < top) continue;
    drawChunk(ctx, game, ch);
  }

  for (const s of game.specimens) {
    if (!s.alive) continue;
    if (s.x < left || s.x > right || s.y < top || s.y > bottom) continue;
    drawSpecimen(ctx, game, s);
  }

  drawBeam(ctx, game);
  for (const c of game.choppers) drawSpotlight(ctx, game, c);

  for (const ring of game.rings) {
    ctx.beginPath();
    ctx.arc(ring.x - game.camX, ring.y - game.camY, ring.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(46, 230, 199, ${Math.max(0, ring.life) * 0.7})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const p of game.particles) {
    if (p.life <= 0) continue;
    const alpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color === "beam" ? BEAM : p.color === "amber" ? AMBER : FG;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x - game.camX, p.y - game.camY, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (!(game.iframes > 0 && Math.sin(game.time * 28) > 0.2)) drawUfo(ctx, game);
  for (const c of game.choppers) drawChopper(ctx, game, c);

  ctx.font = "600 15px Syne, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const t of game.texts) {
    ctx.globalAlpha = Math.max(0, t.life / t.max);
    ctx.fillStyle = AMBER;
    ctx.fillText(t.text, t.x - game.camX, t.y - game.camY);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  const vignette = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.28,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  vignette.addColorStop(0, "rgba(7, 9, 15, 0)");
  vignette.addColorStop(1, "rgba(7, 9, 15, 0.78)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  if (game.flash > 0) {
    const flash = game.reduce ? game.flash * 0.2 : game.flash * 0.28;
    ctx.fillStyle = `rgba(231, 242, 234, ${flash})`;
    ctx.fillRect(0, 0, w, h);
  }
  drawMoon(ctx, w, h);
}

function updateFx(game: Game, dt: number) {
  game.trauma = Math.max(0, game.trauma - dt * 1.3);
  game.flash = Math.max(0, game.flash - dt * 2.4);
  for (const p of game.particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const drag = Math.exp(-2.4 * dt);
    p.vx *= drag;
    p.vy *= drag;
  }
  let tw = 0;
  for (const t of game.texts) {
    t.life -= dt;
    t.y -= 32 * dt;
    if (t.life > 0) game.texts[tw++] = t;
  }
  game.texts.length = tw;
  let rw = 0;
  for (const r of game.rings) {
    r.life -= dt;
    r.r += 120 * dt;
    if (r.life > 0) game.rings[rw++] = r;
  }
  game.rings.length = rw;
}

function updateSpecimen(s: Specimen, dt: number) {
  if (!s.alive || s.charge > 0.12) return;
  if (s.kind === "truck") {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if ((s.x - s.hx) ** 2 + (s.y - s.hy) ** 2 > 340 * 340) {
      s.vx *= -1;
      s.vy *= -1;
    }
  } else {
    s.phase -= dt;
    if (s.phase <= 0) {
      s.phase = 1.1 + Math.random() * 2.6;
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 18;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.sin(a) * sp;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    const dx = s.x - s.hx;
    const dy = s.y - s.hy;
    if (dx * dx + dy * dy > 190 * 190) {
      s.vx = -dx * 0.2;
      s.vy = -dy * 0.2;
    }
  }
  if (Math.hypot(s.vx, s.vy) > 6) s.face = Math.atan2(s.vy, s.vx);
}

function nearest(game: Game): Specimen | null {
  let best: Specimen | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of game.specimens) {
    if (!s.alive) continue;
    const d = Math.hypot(s.x - game.x, s.y - game.y);
    const reach = s.kind === "truck" ? REACH + 12 : REACH;
    if (d < reach && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

function collect(game: Game, s: Specimen) {
  s.alive = false;
  s.charge = 0;
  game.combo = game.comboT > 0 ? game.combo + 1 : 1;
  game.comboT = 4.2;
  const gained = POINTS[s.kind] * game.combo;
  game.score += gained;
  game.caught += 1;
  if (game.score > game.best) {
    game.best = game.score;
    saveBest(game.best);
  }
  game.heat = Math.min(1, game.heat + 0.09);
  game.trauma = Math.min(1, game.trauma + 0.3);
  game.hitstop = 0.05;
  game.flash = 0.38;
  game.sfx.push("abduct");
  game.texts.push({
    x: s.x,
    y: s.y - 18,
    life: 0.9,
    max: 0.9,
    text: `+${gained}`,
  });
  if (game.texts.length > 8) game.texts.shift();
  game.rings.push({ x: s.x, y: s.y, r: 8, life: 0.42 });
  burst(game, s.x, s.y, "beam", 16);
}

function spawnChopper(game: Game) {
  const ang = Math.random() * Math.PI * 2;
  const dist = 860;
  const x = game.x + Math.cos(ang) * dist;
  const y = game.y + Math.sin(ang) * dist;
  game.choppers.push({
    id: game.nextId++,
    x,
    y,
    yaw: Math.atan2(-(game.x - x), -(game.y - y)),
    lock: 0,
    rotor: 0,
  });
}

function updateChopper(game: Game, c: Chopper, dt: number, playing: boolean) {
  const target = Math.atan2(-(game.x - c.x), -(game.y - c.y));
  const diff = Math.atan2(Math.sin(target - c.yaw), Math.cos(target - c.yaw));
  const maxTurn = 1.7 * dt;
  c.yaw += clamp(diff, -maxTurn, maxTurn);
  c.rotor += dt * 28;
  const fx = -Math.sin(c.yaw);
  const fy = -Math.cos(c.yaw);
  c.x += fx * 188 * dt;
  c.y += fy * 188 * dt;

  const dx = game.x - c.x;
  const dy = game.y - c.y;
  const dist = Math.hypot(dx, dy);
  const aim = Math.atan2(-dx, -dy);
  const align = Math.abs(Math.atan2(Math.sin(aim - c.yaw), Math.cos(aim - c.yaw)));
  if (playing && dist < 245 && align < 0.4) c.lock += dt;
  else c.lock = Math.max(0, c.lock - dt * 0.7);

  if (playing && c.lock > 1.15 && game.iframes <= 0) {
    c.lock = 0;
    hurt(game);
  }

  if (dist > 1900) {
    c.x = game.x - fx * 780;
    c.y = game.y - fy * 780;
  }
}

function hurt(game: Game) {
  if (game.mode !== "play" || game.iframes > 0) return;
  game.hull -= 1;
  game.iframes = 1.65;
  game.trauma = Math.min(1, game.trauma + 0.75);
  game.hitstop = 0.08;
  game.flash = 1;
  game.speed *= 0.32;
  game.sfx.push("hit");
  burst(game, game.x, game.y, "amber", 14);
  if (game.hull <= 0) {
    game.mode = "over";
    game.beamOn = false;
    game.hint = "";
    game.best = Math.max(game.best, game.score);
    saveBest(game.best);
    game.sfx.push("over");
  }
}

function ensureWorld(game: Game) {
  const cx = Math.floor(game.x / CHUNK);
  const cy = Math.floor(game.y / CHUNK);
  for (let y = cy - 2; y <= cy + 2; y++) {
    for (let x = cx - 2; x <= cx + 2; x++) {
      const key = `${x},${y}`;
      if (!game.chunks.has(key)) game.chunks.set(key, buildChunk(game, x, y, key));
    }
  }
  if (game.chunks.size > 48 || game.specimens.length > 140) {
    const drop: string[] = [];
    for (const ch of game.chunks.values()) {
      if (Math.abs(ch.cx - cx) > 3 || Math.abs(ch.cy - cy) > 3) drop.push(ch.key);
    }
    if (drop.length) {
      for (const key of drop) game.chunks.delete(key);
      game.choppers = game.choppers.filter((c) => Math.hypot(c.x - game.x, c.y - game.y) < 2000);
    }
    game.specimens = game.specimens.filter((s) => s.alive && !drop.includes(s.chunk));
  }
}

function buildChunk(game: Game, cx: number, cy: number, key: string): Chunk {
  const rand = mulberry32(mix(cx + 17, cy - 91));
  const origin = cx === 0 && cy === 0;
  const chunk: Chunk = {
    key,
    cx,
    cy,
    shade: SHADES[Math.floor(rand() * SHADES.length)] ?? SHADES[0],
    trees: [],
    barns: [],
    ponds: [],
    road: rand() < 0.42 ? (rand() < 0.5 ? "h" : "v") : null,
    flies: [],
  };
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const trees = origin ? 8 : 4 + Math.floor(rand() * 5);
  for (let i = 0; i < trees; i++) {
    chunk.trees.push({
      x: x0 + 40 + rand() * (CHUNK - 80),
      y: y0 + 40 + rand() * (CHUNK - 80),
      r: 16 + rand() * 18,
    });
  }
  if (origin || rand() < 0.48) {
    chunk.barns.push({
      x: x0 + 140 + rand() * (CHUNK - 280),
      y: y0 + 140 + rand() * (CHUNK - 280),
      w: 78 + rand() * 36,
      h: 52 + rand() * 20,
    });
  }
  if (origin || rand() < 0.34) {
    chunk.ponds.push({
      x: x0 + 180 + rand() * (CHUNK - 360),
      y: y0 + 180 + rand() * (CHUNK - 360),
      rx: 46 + rand() * 40,
      ry: 28 + rand() * 22,
    });
  }
  const flies = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < flies; i++) {
    chunk.flies.push({
      x: x0 + rand() * CHUNK,
      y: y0 + rand() * CHUNK,
      phase: rand() * Math.PI * 2,
    });
  }
  const count = origin ? 9 : 3 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const kind = pickKind(rand);
    const x = x0 + 70 + rand() * (CHUNK - 140);
    const y = y0 + 70 + rand() * (CHUNK - 140);
    const truck = kind === "truck";
    game.specimens.push({
      id: game.nextId++,
      kind,
      x,
      y,
      vx: truck ? (rand() < 0.5 ? 62 : -62) : 0,
      vy: 0,
      hx: x,
      hy: y,
      phase: rand() * 2,
      face: truck ? (rand() < 0.5 ? 0 : Math.PI) : rand() * Math.PI * 2,
      charge: 0,
      alive: true,
      chunk: key,
      wobble: rand() * 6,
    });
  }
  return chunk;
}

function pickKind(rand: () => number): Kind {
  const r = rand();
  if (r < 0.34) return "cow";
  if (r < 0.58) return "sheep";
  if (r < 0.76) return "horse";
  if (r < 0.9) return "goat";
  return "truck";
}

function drawChunk(ctx: CanvasRenderingContext2D, game: Game, ch: Chunk) {
  const x0 = ch.cx * CHUNK - game.camX;
  const y0 = ch.cy * CHUNK - game.camY;
  ctx.fillStyle = ch.shade;
  ctx.fillRect(x0 - 1, y0 - 1, CHUNK + 2, CHUNK + 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, CHUNK, CHUNK);
  ctx.clip();
  ctx.strokeStyle = "rgba(231, 242, 234, 0.045)";
  ctx.lineWidth = 2;
  const rows = 9;
  for (let i = 1; i < rows; i++) {
    const y = y0 + (CHUNK / rows) * i;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + CHUNK, y + 18);
    ctx.stroke();
  }
  ctx.restore();

  if (ch.road) {
    ctx.fillStyle = "#0c100f";
    if (ch.road === "h") ctx.fillRect(x0, y0 + CHUNK * 0.5 - 16, CHUNK, 32);
    else ctx.fillRect(x0 + CHUNK * 0.5 - 16, y0, 32, CHUNK);
    ctx.strokeStyle = "rgba(240, 180, 90, 0.35)";
    ctx.setLineDash([10, 16]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ch.road === "h") {
      ctx.moveTo(x0, y0 + CHUNK * 0.5);
      ctx.lineTo(x0 + CHUNK, y0 + CHUNK * 0.5);
    } else {
      ctx.moveTo(x0 + CHUNK * 0.5, y0);
      ctx.lineTo(x0 + CHUNK * 0.5, y0 + CHUNK);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const pond of ch.ponds) {
    const px = pond.x - game.camX;
    const py = pond.y - game.camY;
    ctx.beginPath();
    ctx.ellipse(px, py, pond.rx, pond.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#0c1c1c";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(px - pond.rx * 0.25, py - pond.ry * 0.2, pond.rx * 0.28, pond.ry * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(240, 180, 90, 0.18)";
    ctx.fill();
  }

  for (const barn of ch.barns) {
    const bx = barn.x - game.camX;
    const by = barn.y - game.camY;
    ctx.fillStyle = "#1a221c";
    ctx.fillRect(bx - barn.w / 2, by - barn.h / 2, barn.w, barn.h);
    ctx.fillStyle = "#101610";
    ctx.beginPath();
    ctx.moveTo(bx - barn.w / 2 - 6, by - barn.h / 2);
    ctx.lineTo(bx, by - barn.h / 2 - 22);
    ctx.lineTo(bx + barn.w / 2 + 6, by - barn.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = AMBER;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(bx - barn.w * 0.22, by - 6, 10, 12);
    ctx.fillRect(bx + barn.w * 0.12, by - 6, 10, 12);
    ctx.globalAlpha = 1;
  }

  for (const tree of ch.trees) {
    const tx = tree.x - game.camX;
    const ty = tree.y - game.camY;
    ctx.fillStyle = "#0a100c";
    ctx.beginPath();
    ctx.arc(tx + 3, ty + 4, tree.r * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#15211a";
    ctx.beginPath();
    ctx.arc(tx, ty, tree.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c2c22";
    ctx.beginPath();
    ctx.arc(tx - tree.r * 0.25, ty - tree.r * 0.2, tree.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const fly of ch.flies) {
    const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(game.time * 2.2 + fly.phase));
    ctx.globalAlpha = a;
    ctx.fillStyle = AMBER;
    ctx.beginPath();
    ctx.arc(fly.x - game.camX, fly.y - game.camY, 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSpecimen(ctx: CanvasRenderingContext2D, game: Game, s: Specimen) {
  const lift = s.charge * 26;
  const bob = Math.sin(game.time * 3.2 + s.wobble) * (s.charge > 0 ? 0 : 1.4);
  const sx = s.x - game.camX;
  const sy = s.y - game.camY - lift + bob;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(s.face);
  ctx.scale(1.4, 1.4);
  if (s.kind === "cow") drawCow(ctx);
  else if (s.kind === "sheep") drawSheep(ctx);
  else if (s.kind === "horse") drawHorse(ctx);
  else if (s.kind === "goat") drawGoat(ctx);
  else drawTruck(ctx);
  ctx.restore();

  if (s.charge > 0.02) {
    ctx.beginPath();
    ctx.arc(s.x - game.camX, s.y - game.camY, 22, -Math.PI / 2, -Math.PI / 2 + s.charge * Math.PI * 2);
    ctx.strokeStyle = BEAM;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function drawCow(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#d9cbb6";
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillRect(-4, 4, 2, 5);
  ctx.fillRect(6, 4, 2, 5);
  ctx.fillRect(-10, 4, 2, 5);
  ctx.beginPath();
  ctx.arc(14, -2, 5, 0, Math.PI * 2);
  ctx.fillStyle = "#efe6d8";
  ctx.fill();
  ctx.fillStyle = "#141c16";
  ctx.beginPath();
  ctx.ellipse(-2, -1, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSheep(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = FG;
  ctx.beginPath();
  ctx.arc(-4, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4, -1, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1814";
  ctx.fillRect(-2, 6, 2, 4);
  ctx.fillRect(4, 6, 2, 4);
  ctx.beginPath();
  ctx.arc(10, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawHorse(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#c4884a";
  ctx.beginPath();
  ctx.ellipse(-2, 0, 18, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(10, -10, 4, 12);
  ctx.beginPath();
  ctx.ellipse(14, -12, 5, 3.5, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-16, -2);
  ctx.quadraticCurveTo(-22, 6, -18, 8);
  ctx.stroke();
}

function drawGoat(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#d5ddd4";
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11, -1, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = FG;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(9, -4);
  ctx.lineTo(7, -9);
  ctx.moveTo(13, -4);
  ctx.lineTo(15, -9);
  ctx.stroke();
}

function drawTruck(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#1b2420";
  ctx.fillRect(-16, -7, 24, 14);
  ctx.fillStyle = "#24302a";
  ctx.fillRect(6, -8, 12, 13);
  ctx.fillStyle = AMBER;
  ctx.fillRect(16, -4, 3, 3);
  ctx.fillRect(16, 1, 3, 3);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(-8, 8, 3, 0, Math.PI * 2);
  ctx.arc(8, 8, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBeam(ctx: CanvasRenderingContext2D, game: Game) {
  const sx = game.x - game.camX;
  const sy = game.y - game.camY;
  ctx.beginPath();
  ctx.arc(sx, sy, REACH, 0, Math.PI * 2);
  ctx.strokeStyle = game.beamOn ? "rgba(46, 230, 199, 0.85)" : "rgba(46, 230, 199, 0.16)";
  ctx.lineWidth = game.beamOn ? 2 : 1;
  ctx.stroke();
  if (!game.beamOn) return;
  const g = ctx.createRadialGradient(sx, sy + 10, 4, sx, sy + 18, REACH);
  g.addColorStop(0, "rgba(46, 230, 199, 0.28)");
  g.addColorStop(1, "rgba(46, 230, 199, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy + 16, 18, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(sx, sy + 18, REACH * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(game.time * 10))), 0, Math.PI * 2);
  ctx.fill();
}

function drawUfo(ctx: CanvasRenderingContext2D, game: Game) {
  const bob = Math.sin(game.time * 6) * 2.2;
  const sx = game.x - game.camX;
  const sy = game.y - game.camY + bob;
  ctx.save();
  ctx.translate(sx, sy + 16);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 28, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-game.yaw);
  const hull = ctx.createLinearGradient(0, -18, 0, 16);
  hull.addColorStop(0, "#f4fffb");
  hull.addColorStop(0.42, "#8ef6e4");
  hull.addColorStop(1, "#14685c");
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.ellipse(0, 2, 34, 13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(240, 180, 90, 0.9)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.ellipse(0, 4, 26, 7.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 5; i++) {
    const a = game.time * 3.4 + (i * Math.PI * 2) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 22, 4 + Math.sin(a) * 6, 2.1, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? AMBER : FG;
    ctx.fill();
  }
  const dome = ctx.createLinearGradient(0, -20, 0, -2);
  dome.addColorStop(0, "rgba(231, 242, 234, 0.95)");
  dome.addColorStop(1, "rgba(46, 230, 199, 0.28)");
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.ellipse(0, -4, 12, 9, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(5, -9);
  ctx.lineTo(-5, -9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (game.danger > 0.08) {
    ctx.beginPath();
    ctx.arc(sx, sy, 40, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(240, 180, 90, ${0.25 + game.danger * 0.6})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawSpotlight(ctx: CanvasRenderingContext2D, game: Game, c: Chopper) {
  ctx.save();
  ctx.translate(c.x - game.camX, c.y - game.camY);
  ctx.rotate(-c.yaw);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(-96, -240);
  ctx.lineTo(96, -240);
  ctx.closePath();
  const hot = c.lock / 1.15;
  ctx.fillStyle = `rgba(240, 180, 90, ${0.08 + hot * 0.16})`;
  ctx.fill();
  ctx.restore();
}

function drawChopper(ctx: CanvasRenderingContext2D, game: Game, c: Chopper) {
  ctx.save();
  ctx.translate(c.x - game.camX, c.y - game.camY);
  ctx.rotate(-c.yaw);
  ctx.strokeStyle = "rgba(231, 242, 234, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(Math.cos(c.rotor) * 26, Math.sin(c.rotor) * 5);
  ctx.lineTo(-Math.cos(c.rotor) * 26, -Math.sin(c.rotor) * 5);
  ctx.moveTo(Math.cos(c.rotor + 1.2) * 22, Math.sin(c.rotor + 1.2) * 4);
  ctx.lineTo(-Math.cos(c.rotor + 1.2) * 22, -Math.sin(c.rotor + 1.2) * 4);
  ctx.stroke();
  ctx.fillStyle = "#121816";
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.fillRect(-2, -12, 4, 6);
  ctx.restore();
}

function drawMoon(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const x = Math.max(56, Math.min(88, w * 0.16));
  const y = Math.max(120, h * 0.22);
  const glow = ctx.createRadialGradient(x, y, 8, x, y, 90);
  glow.addColorStop(0, "rgba(240, 180, 90, 0.28)");
  glow.addColorStop(1, "rgba(240, 180, 90, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x + 7, y - 3, 13, 0, Math.PI * 2);
  ctx.fill();
}

function burst(game: Game, x: number, y: number, color: Particle["color"], n: number) {
  for (let i = 0; i < n; i++) {
    let p = game.particles.find((q) => q.life <= 0);
    if (!p) {
      if (game.particles.length >= 160) return;
      p = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, r: 2, color };
      game.particles.push(p);
    }
    const a = Math.random() * Math.PI * 2;
    const sp = 30 + Math.random() * 130;
    p.x = x;
    p.y = y;
    p.vx = Math.cos(a) * sp;
    p.vy = Math.sin(a) * sp;
    p.life = p.max = 0.32 + Math.random() * 0.35;
    p.r = 1.3 + Math.random() * 1.8;
    p.color = color;
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function mix(x: number, y: number) {
  let h = (Math.imul(x | 0, 0x85ebca6b) ^ Math.imul(y | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
