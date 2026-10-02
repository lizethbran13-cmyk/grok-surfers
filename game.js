/* GROK SURFERS 2.0 — endless subway runner. Plain canvas 2D, no build step, works from file://. */
(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const canvas = $("game"), ctx = canvas.getContext("2d");
  const el = {
    hud: $("hud"), score: $("score"), best: $("best"), coins: $("coin-count"), mult: $("mult"), powers: $("powers"),
    title: $("title"), over: $("gameover"), pause: $("pause"), pauseBtn: $("pause-btn"), mute: $("mute"),
    play: $("play"), retry: $("retry"), menu: $("menu"), resume: $("resume"), quit: $("quit"),
    titleBest: $("title-best"), chars: $("chars"), goScore: $("go-score"), goCoins: $("go-coins"), goBest: $("go-best"),
    goTitle: $("go-title"), newBest: $("new-best"), goDist: $("go-dist"), tip: $("tip"), toast: $("toast"),
  };

  // ---------- constants ----------
  const STORE_BEST = "grokSurfersBest", STORE_MUTE = "grokSurfersMute", STORE_CHAR = "grokSurfers.char", STORE_COINS = "grokSurfers.bank";
  const LANES = [-2.3, 0, 2.3];
  const LANE_W = 2.3;
  const CAM_Y = 3.7, CAM_D = 5.6;           // camera height and distance behind the runner
  const FAR = 130;                           // draw distance
  const RUN_H = 1.75, SLIDE_H = 0.8;         // runner hitbox heights
  const GRAV = 46, JUMP_V = 14.2, SNEAK_V = 18.6;
  const TRAIN_H = 2.7, LOW_H = 1.0, HIGH_Y0 = 1.25, HIGH_Y1 = 3.1;
  const SPEED0 = 18, SPEED_MAX = 46;
  const POWER_TIME = { magnet: 10, jetpack: 7, sneakers: 11, mult: 12 };
  const POWER_INFO = {
    magnet: { icon: "🧲", label: "MAGNET", col: "#ff3d5a" },
    jetpack: { icon: "🚀", label: "JETPACK", col: "#3ec9ff" },
    sneakers: { icon: "👟", label: "SUPER SNEAKERS", col: "#7dff4a" },
    mult: { icon: "2×", label: "2× SCORE", col: "#ffd23f" },
  };
  const CHARS = [
    { id: "grok", name: "GROK", body: "#ff7a18", trim: "#ffd23f", pants: "#2b3a8c", skin: "#ffcf9e", hair: "#3a1d0b" },
    { id: "neon", name: "NEON", body: "#18d8ff", trim: "#ffffff", pants: "#1b1b3a", skin: "#f1b98a", hair: "#111" },
    { id: "lime", name: "LIME", body: "#7dff3a", trim: "#1f6b00", pants: "#333", skin: "#c98b5e", hair: "#1a0e05" },
    { id: "rose", name: "ROSE", body: "#ff3d9a", trim: "#ffe0f0", pants: "#30164d", skin: "#ffd9b8", hair: "#ffcc33" },
    { id: "violet", name: "VIOLET", body: "#a64dff", trim: "#ffd23f", pants: "#141414", skin: "#8d5a3b", hair: "#000" },
  ];

  // ---------- helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const chance = p => Math.random() < p;
  function shade(hex, amt) {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(ch => ch + ch).join("");
    const n = parseInt(c, 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* private mode */ } },
  };

  // ---------- audio (tiny WebAudio synth) ----------
  const sfx = {
    ctx: null, muted: store.get(STORE_MUTE, "0") === "1",
    ensure() {
      if (this.muted) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) { try { this.ctx = new AC(); } catch (e) { return; } }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type, gain, slide, delay) {
      if (this.muted || !this.ctx) return;
      const c = this.ctx, t0 = c.currentTime + (delay || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
      g.gain.setValueAtTime(gain || 0.06, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur, gain) {
      if (this.muted || !this.ctx) return;
      const c = this.ctx, n = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = c.createBufferSource(); src.buffer = n;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
      const g = c.createGain(); g.gain.value = gain || 0.12;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start();
    },
    jump() { this.tone(420, 0.12, "square", 0.05, 700); },
    slide() { this.tone(240, 0.15, "sawtooth", 0.035, 90); },
    lane() { this.tone(300, 0.05, "triangle", 0.04, 380); },
    coin() { this.tone(988, 0.07, "square", 0.035, 1500); this.tone(1319, 0.1, "square", 0.025, null, 0.05); },
    power() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, "square", 0.045, null, i * 0.06)); },
    stumble() { this.noise(0.15, 0.12); this.tone(200, 0.18, "sawtooth", 0.05, 90); },
    crash() { this.noise(0.3, 0.2); this.tone(160, 0.4, "sawtooth", 0.08, 45); },
    start() { [330, 440, 660].forEach((f, i) => this.tone(f, 0.14, "square", 0.05, null, i * 0.09)); },
  };

  // ---------- view / projection ----------
  let W = 0, H = 0, DPR = 1, F = 300, HY = 100, camX = 0, camYoff = 0, shake = 0;
  function resize() {
    const touchy = matchMedia("(pointer: coarse)").matches;
    DPR = Math.min(window.devicePixelRatio || 1, touchy ? 1.75 : 2);
    W = Math.max(1, window.innerWidth); H = Math.max(1, window.innerHeight);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    // Focal length: big runner on landscape phones, but always keep all 3 lanes on screen in portrait.
    const feetY = H * (H > W ? 0.8 : 0.86);
    const fByH = (H * 0.56) * CAM_D / CAM_Y;
    const fByW = W * 0.62 * CAM_D / (LANE_W * 3.3);
    F = Math.min(fByH, fByW);
    HY = feetY - CAM_Y * F / CAM_D;
    skyCache = null;
  }
  // World: x right, y up, z forward (runner at z = 0). Camera sits at (camX, CAM_Y, -CAM_D).
  const NEAR = 0.35;
  function proj(x, y, z) {
    const dz = z + CAM_D;
    if (dz < NEAR) return null;
    const k = F / dz;
    return { x: W / 2 + (x - camX) * k, y: HY + (CAM_Y + camYoff - y) * k, k };
  }
  // Same as proj, but clamps behind-camera points onto the near plane (for polygons that cross it).
  function projC(x, y, z) {
    return proj(x, y, Math.max(z, NEAR - CAM_D + 0.001));
  }
  function poly(pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Axis-aligned box: draws the faces visible from the camera (front, top, inner side).
  function box(x0, x1, y0, y1, z0, z1, col, opts) {
    opts = opts || {};
    const zf = Math.max(z0, NEAR - CAM_D + 0.05);
    if (z1 <= zf) return null;
    const a = proj(x0, y0, zf), b = proj(x1, y0, zf), c = proj(x1, y1, zf), d = proj(x0, y1, zf);
    const e = proj(x0, y1, z1), f = proj(x1, y1, z1), g = proj(x0, y0, z1), h = proj(x1, y0, z1);
    const out = opts.outline || "rgba(20,10,30,0.85)", lw = Math.max(1, (a.k) * 0.035);
    // side faces (only the one facing the camera)
    if (x1 < camX) poly([b, h, f, c], opts.side || shade(col, -0.28), out, lw);
    else if (x0 > camX) poly([a, g, e, d], opts.side || shade(col, -0.28), out, lw);
    // top face (visible when below camera)
    if (y1 < CAM_Y + camYoff) poly([d, c, f, e], opts.top || shade(col, 0.25), out, lw);
    if (zf === z0) poly([a, b, c, d], opts.front || col, out, lw);
    return { a, b, c, d };
  }

  // ---------- state ----------
  let state = "title";          // title | run | dying | over | paused
  let ents = [], parts = [], floaters = [], scenery = [];
  let speed = SPEED0, runTime = 0, dist = 0, score = 0, coins = 0, mult = 1, spawnZ = 30, powerT = 14;
  let best = Math.max(0, parseInt(store.get(STORE_BEST, "0"), 10) || 0);
  let bank = Math.max(0, parseInt(store.get(STORE_COINS, "0"), 10) || 0);
  let charIdx = clamp(CHARS.findIndex(c => c.id === store.get(STORE_CHAR, "grok")), 0, CHARS.length - 1);
  let autopilot = false, lastCrash = null, dieT = 0, lastPattern = "", tipT = 0;
  const powers = { magnet: 0, jetpack: 0, sneakers: 0, mult: 0 };
  const stats = { jumps: 0, slides: 0, lanes: 0, stumbles: 0, powerups: 0, coins: 0 };
  const P = {
    lane: 1, prevLane: 1, x: 0, y: 0, vy: 0, ground: 0, onGround: true, slideT: 0, slideQ: false, jumpBuf: 0,
    stumbleT: 0, lastStumble: -99, invuln: 0, runT: 0, tilt: 0, landT: 0,
  };

  function difficulty() { return clamp(runTime / 160, 0, 1); }

  // ---------- spawning ----------
  function add(e) { e.hitDone = false; ents.push(e); return e; }
  function train(lane, z, len, opts) {
    opts = opts || {};
    const pal = pick([["#e8433a", "#ffd23f"], ["#2f7bff", "#ffffff"], ["#18b36b", "#ffe14a"], ["#8a4dff", "#ffd23f"], ["#ff8a1f", "#2b2b2b"]]);
    const t = add({ type: "train", lane, z, len, y0: 0, y1: TRAIN_H, col: pal[0], stripe: pal[1], vz: opts.vz || 0 });
    if (opts.ramp) add({ type: "ramp", lane, z: z - 6, len: 6, y0: 0, y1: TRAIN_H, link: t });
    return t;
  }
  function low(lane, z) { return add({ type: "low", lane, z, len: 0.6, y0: 0, y1: LOW_H }); }
  function high(lane, z) { return add({ type: "high", lane, z, len: 0.6, y0: HIGH_Y0, y1: HIGH_Y1 }); }
  function coin(lane, z, y) { return add({ type: "coin", lane, x: LANES[lane], z, y: y === undefined ? 0.9 : y, spin: Math.random() * 6 }); }
  function coinRun(lane, z, n, gap, y) { for (let i = 0; i < n; i++) coin(lane, z + i * gap, y); }
  function coinArc(lane, zc, y0) { // arc over a jumpable barrier
    for (let i = -3; i <= 3; i++) coin(lane, zc + i * 1.6, (y0 || 0) + 0.9 + 1.7 * (1 - (i * i) / 9));
  }
  function powerUp(lane, z, kind) {
    kind = kind || pick(["magnet", "jetpack", "sneakers", "mult", "magnet", "mult"]);
    return add({ type: "power", lane, x: LANES[lane], z, y: 1.2, kind, spin: 0 });
  }
  const others = l => [0, 1, 2].filter(i => i !== l);

  // Each pattern returns the length of track it used. Every pattern leaves a way through
  // (a free lane, a jumpable barrier, a slide gap or a ramp).
  const PATTERNS = {
    single(z, d) {
      const l = irand(0, 2);
      if (chance(0.5)) { low(l, z); coinArc(l, z); } else { high(l, z); coinRun(l, z - 4, 3, 2.2, 0.5); }
      coinRun(pick(others(l)), z - 6, 6, 2.4);
      return 8;
    },
    twoTrains(z, d) {
      const free = irand(0, 2), len = rand(12, 18 + d * 10);
      others(free).forEach(l => train(l, z + rand(0, 4), len));
      if (d > 0.25 && chance(0.5)) { low(free, z + len * 0.5); coinArc(free, z + len * 0.5); }
      else coinRun(free, z, Math.floor(len / 2.4), 2.4);
      return len + 4;
    },
    rampTrain(z, d) {
      const l = irand(0, 2), len = rand(16, 26);
      train(l, z, len, { ramp: true });
      coinRun(l, z - 4, Math.floor((len + 4) / 2.2), 2.2, TRAIN_H + 0.9);
      const o = others(l);
      if (chance(0.6)) train(pick(o), z + rand(2, 8), rand(10, 16));
      else { const k = pick(o); low(k, z + 4); coinArc(k, z + 4); }
      return len + 4;
    },
    wallLow(z, d) {
      for (let l = 0; l < 3; l++) low(l, z);
      coinArc(irand(0, 2), z);
      return 6;
    },
    wallHigh(z, d) {
      for (let l = 0; l < 3; l++) high(l, z);
      coinRun(irand(0, 2), z - 3, 4, 2, 0.45);
      return 6;
    },
    mixed(z, d) {
      const kinds = ["low", "high", "train"].sort(() => Math.random() - 0.5);
      kinds.forEach((k, l) => {
        if (k === "low") { low(l, z + 3); coinArc(l, z + 3); }
        else if (k === "high") high(l, z + 3);
        else train(l, z, rand(10, 16));
      });
      return 16;
    },
    zigzag(z, d) {
      let l = irand(0, 2), dirn = l === 2 ? -1 : 1;
      for (let i = 0; i < 3; i++) {
        train(l, z + i * 16, 10);
        const c = l + dirn >= 0 && l + dirn <= 2 ? l + dirn : l - dirn;
        coinRun(c, z + i * 16, 4, 2.4);
        l = c; dirn = -dirn;
      }
      return 48;
    },
    oncoming(z, d) {
      const l = irand(0, 2);
      train(l, z + 30, rand(14, 20), { vz: rand(7, 10 + d * 6) });
      const o = others(l);
      coinRun(pick(o), z, 8, 2.4);
      if (chance(0.5)) high(pick(o), z + 12);
      return 18;
    },
  };
  function choosePattern(d) {
    const early = runTime < 15;
    const table = [["single", early ? 5 : 3], ["twoTrains", 3], ["rampTrain", 2.5], ["mixed", early ? 0 : 1 + d * 2], ["zigzag", early ? 0 : 0.6 + d],
      ["wallLow", d > 0.12 ? 1 : 0], ["wallHigh", d > 0.2 ? 1 : 0], ["oncoming", d > 0.3 ? 0.6 + d : 0]];
    let tot = 0; table.forEach(t => tot += t[1]);
    for (let tries = 0; tries < 4; tries++) {
      let r = Math.random() * tot;
      for (const [name, w] of table) { r -= w; if (r <= 0) { if (name !== lastPattern || tries === 3) return name; break; } }
    }
    return "single";
  }
  function spawnAhead() {
    while (spawnZ < FAR + 10) {
      const d = difficulty();
      if (spawnZ < 95 && dist < 60) { coinRun(irand(0, 2), spawnZ, 6, 2.4); spawnZ += 17; continue; } // gentle, obstacle-free start
      const name = choosePattern(d);
      lastPattern = name;
      const used = PATTERNS[name](spawnZ, d);
      if (powerT <= 0) {
        // put the power-up in a lane that is free at that depth
        const zp = spawnZ - 6;
        const free = [0, 1, 2].filter(l => !ents.some(e => (e.type === "train" || e.type === "low" || e.type === "high" || e.type === "ramp") && e.lane === l && zp > e.z - 3 && zp < e.z + e.len + 3));
        if (free.length) { powerUp(pick(free), zp); powerT = rand(16, 24); }
      }
      if (powers.jetpack > 1.5) coinRun(P.lane, spawnZ, Math.floor(used / 2), 2, 7.2);
      // spacing gives enough reaction time at the current speed
      const gap = Math.max(14, speed * (0.95 - d * 0.25)) + rand(0, 6);
      spawnZ += used + gap;
    }
  }

  // ---------- run lifecycle ----------
  function resetRun() {
    ents = []; parts = []; floaters = [];
    speed = SPEED0; runTime = 0; dist = 0; score = 0; coins = 0; mult = 1; spawnZ = 26; powerT = 12; lastPattern = "";
    for (const k in powers) powers[k] = 0;
    for (const k in stats) stats[k] = 0;
    Object.assign(P, { lane: 1, prevLane: 1, x: 0, y: 0, vy: 0, ground: 0, onGround: true, slideT: 0, slideQ: false, jumpBuf: 0,
      stumbleT: 0, lastStumble: -99, invuln: 1.2, runT: 0, tilt: 0, landT: 0 });
    camX = 0; camYoff = 0; shake = 0;
    resetScenery();
  }
  function startRun() {
    sfx.ensure(); sfx.start();
    resetRun();
    state = "run";
    el.title.classList.add("hidden"); el.over.classList.add("hidden"); el.pause.classList.add("hidden");
    el.hud.classList.remove("hidden"); el.pauseBtn.classList.remove("hidden");
    showTip(matchMedia("(pointer: coarse)").matches ? "SWIPE ← → to switch lanes · ↑ jump · ↓ slide" : "← → lanes · ↑ / Space jump · ↓ slide", 3.2);
    syncHud(true);
  }
  function crash() {
    if (state !== "run") return;
    state = "dying"; dieT = 1.1; shake = 0.6; sfx.crash();
    burst(P.x, P.y + 1, 0, 26, ["#fff", "#ffd23f", CHARS[charIdx].body]);
    if (navigator.vibrate) { try { navigator.vibrate(120); } catch (e) { /* ignore */ } }
  }
  function gameOver() {
    state = "over";
    const final = Math.floor(score);
    const isBest = final > best;
    if (isBest) { best = final; store.set(STORE_BEST, best); }
    bank += coins; store.set(STORE_COINS, bank);
    el.goScore.textContent = final.toLocaleString(); el.goCoins.textContent = coins; el.goBest.textContent = best.toLocaleString();
    el.goDist.textContent = Math.floor(dist) + " m";
    el.newBest.classList.toggle("hidden", !isBest);
    el.goTitle.textContent = pick(["CRASHED!", "OOF!", "BONK!", "WIPEOUT!"]);
    el.over.classList.remove("hidden"); el.pauseBtn.classList.add("hidden");
  }
  function showTitle() {
    state = "title";
    resetRun();
    el.over.classList.add("hidden"); el.pause.classList.add("hidden"); el.hud.classList.add("hidden"); el.pauseBtn.classList.add("hidden");
    el.title.classList.remove("hidden");
    el.titleBest.textContent = best > 0 ? `BEST ${best.toLocaleString()} · BANK ${bank} coins` : "";
  }
  function setPaused(on) {
    if (on && state === "run") { state = "paused"; el.pause.classList.remove("hidden"); }
    else if (!on && state === "paused") { state = "run"; el.pause.classList.add("hidden"); last = performance.now(); }
  }

  // ---------- actions ----------
  function moveLane(dir) {
    if (state !== "run") return;
    const nl = clamp(P.lane + dir, 0, 2);
    if (nl === P.lane) { shake = Math.max(shake, 0.08); return; }
    P.prevLane = P.lane; P.lane = nl; P.tilt = dir; stats.lanes++; sfx.lane();
  }
  function jump() {
    if (state !== "run") return;
    if (powers.jetpack > 0) return;
    if (!P.onGround) { P.jumpBuf = 0.2; return; }  // buffered: fires on landing
    P.vy = powers.sneakers > 0 ? SNEAK_V : JUMP_V; P.onGround = false; P.slideT = 0; P.slideQ = false;
    stats.jumps++; sfx.jump();
  }
  function slide() {
    if (state !== "run" || powers.jetpack > 0) return;
    if (!P.onGround) { P.vy = Math.min(P.vy, -26); P.slideQ = true; return; } // fast drop, slide on landing
    P.slideT = 0.72; stats.slides++; sfx.slide();
  }

  // ---------- input ----------
  const keyMap = { ArrowLeft: "L", KeyA: "L", ArrowRight: "R", KeyD: "R", ArrowUp: "U", KeyW: "U", Space: "U", ArrowDown: "D", KeyS: "D" };
  window.addEventListener("keydown", e => {
    if (e.code === "Escape" || e.code === "KeyP") { if (state === "run") setPaused(true); else if (state === "paused") setPaused(false); return; }
    if (state === "title" || state === "over") { if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); startRun(); } return; }
    const a = keyMap[e.code];
    if (!a) return;
    e.preventDefault();
    if (e.repeat) return;
    if (a === "L") moveLane(-1); else if (a === "R") moveLane(1); else if (a === "U") jump(); else slide();
  });
  // Swipes fire as soon as the finger has moved far enough (no waiting for touchend),
  // and a single touch can chain several swipes.
  const touch = { id: null, x: 0, y: 0, t: 0, fired: false, last: null };
  function swipeDist() { return Math.max(22, Math.min(W, H) * 0.06); }
  canvas.addEventListener("touchstart", e => {
    e.preventDefault(); sfx.ensure();
    if (state !== "run") return;
    const t = e.changedTouches[0];
    touch.id = t.identifier; touch.x = t.clientX; touch.y = t.clientY; touch.t = performance.now(); touch.fired = false; touch.last = null;
  }, { passive: false });
  canvas.addEventListener("touchmove", e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y, th = swipeDist();
      if (Math.abs(dx) < th && Math.abs(dy) < th) continue;
      const dirn = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy < 0 ? "U" : "D");
      touch.x = t.clientX; touch.y = t.clientY;
      if (dirn === touch.last) continue;   // one action per stroke; a new direction can chain
      touch.last = dirn; touch.fired = true;
      if (dirn === "R") moveLane(1); else if (dirn === "L") moveLane(-1); else if (dirn === "U") jump(); else slide();
    }
  }, { passive: false });
  canvas.addEventListener("touchend", e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      // quick tap (no swipe) = jump, like most runners
      if (!touch.fired && performance.now() - touch.t < 220 && state === "run") jump();
      touch.id = null;
    }
  }, { passive: false });
  // mouse drag-swipe for desktop testing
  let mouse = null;
  canvas.addEventListener("mousedown", e => { if (state === "run") mouse = { x: e.clientX, y: e.clientY }; });
  window.addEventListener("mouseup", e => {
    if (!mouse) return;
    const dx = e.clientX - mouse.x, dy = e.clientY - mouse.y; mouse = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
    if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1); else if (dy < 0) jump(); else slide();
  });

  // ---------- particles / popups ----------
  function burst(x, y, z, n, cols) {
    for (let i = 0; i < n; i++) parts.push({ x, y, z, vx: rand(-5, 5), vy: rand(2, 9), vz: rand(-3, 6), life: rand(0.4, 0.9), t: 0, col: pick(cols), s: rand(0.08, 0.18) });
  }
  function popup(text, col) { floaters.push({ text, col: col || "#ffd23f", t: 0 }); }
  function showTip(text, secs) { el.tip.textContent = text; el.tip.classList.add("show"); tipT = secs; }
  function toast(text, col) {
    el.toast.textContent = text; el.toast.style.color = col || "#fff";
    el.toast.classList.remove("show"); void el.toast.offsetWidth; el.toast.classList.add("show");
  }

  // ---------- scenery (buildings, lamp posts) ----------
  const BLD_COLS = ["#ff9f43", "#54a0ff", "#ff6b9a", "#1dd1a1", "#feca57", "#a29bfe", "#ff7f50", "#48dbfb"];
  function resetScenery() {
    scenery = [];
    for (let z = -6; z < FAR + 20; z += 9) addSceneryAt(z);
  }
  function addSceneryAt(z) {
    for (const side of [-1, 1]) {
      scenery.push({ kind: "bld", side, z: z + rand(0, 3), w: rand(3, 5), h: rand(3.5, 9), d: rand(6, 8.5), col: pick(BLD_COLS), win: chance(0.8) });
    }
    if (chance(0.7)) scenery.push({ kind: "post", side: chance(0.5) ? -1 : 1, z: z + 4 });
  }

  // ---------- update ----------
  const SOLID = { train: 1, low: 1, high: 1 };
  function laneOverlap(e) { return Math.abs(P.x - LANES[e.lane]) < 1.32; }
  function update(dt) {
    if (tipT > 0 && (tipT -= dt) <= 0) el.tip.classList.remove("show");
    for (const f of floaters) f.t += dt;
    floaters = floaters.filter(f => f.t < 1.1);
    updateParts(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 1.8);
    if (state === "dying") { dieT -= dt; if (dieT <= 0) gameOver(); return; }
    if (state !== "run") { // title: keep the world scrolling slowly behind the menu
      if (state === "title") { P.runT += dt; scrollWorld(dt, 9); P.x = lerp(P.x, 0, dt * 4); camX = lerp(camX, 0, dt * 4); }
      return;
    }
    if (autopilot) autoDrive();
    runTime += dt;
    const d = difficulty();
    let target = Math.min(SPEED_MAX, SPEED0 + runTime * 0.22);
    if (P.stumbleT > 0) { P.stumbleT -= dt; target *= 0.7; }
    speed = lerp(speed, target, clamp(dt * 3, 0, 1));
    const dz = speed * dt;
    dist += dz;
    mult = powers.mult > 0 ? 2 : 1;
    score += dz * 0.6 * mult;
    for (const k in powers) if (powers[k] > 0) powers[k] = Math.max(0, powers[k] - dt);
    if (P.invuln > 0) P.invuln -= dt;
    powerT -= dt;

    // lateral movement: quick ease into the target lane
    const tx = LANES[P.lane];
    P.x += (tx - P.x) * clamp(dt * 15, 0, 1);
    if (Math.abs(tx - P.x) < 0.02) P.x = tx;
    P.tilt *= Math.pow(0.02, dt);
    P.runT += dt * (speed / 17);

    const prevZ = new Map();
    for (const e of ents) prevZ.set(e, e.z);
    scrollWorld(dt, speed);

    // support surface: ground, train roofs, ramps
    let support = 0;
    for (const e of ents) {
      if (Math.abs(P.x - LANES[e.lane]) > 1.0) continue;
      if (e.type === "ramp" && e.z < 0.3 && e.z + e.len > -0.3) support = Math.max(support, TRAIN_H * clamp((0.3 - e.z) / e.len, 0, 1));
      if (e.type === "train" && e.z < 0.35 && e.z + e.len > -0.35 && P.y >= TRAIN_H - 0.45) support = Math.max(support, TRAIN_H);
    }
    // vertical
    if (powers.jetpack > 0) {
      const ty = powers.jetpack > 1 ? 7 : support;
      P.y = lerp(P.y, ty, clamp(dt * 3, 0, 1)); P.vy = 0; P.onGround = false;
      if (powers.jetpack < 1 && P.y - support < 0.15) { P.y = support; P.onGround = true; }
      if (Math.random() < 0.7) parts.push({ x: P.x + rand(-0.2, 0.2), y: P.y + 0.6, z: -0.4, vx: rand(-1, 1), vy: rand(-6, -3), vz: speed * 0.5, life: 0.3, t: 0, col: pick(["#ffd23f", "#ff7a18", "#fff"]), s: 0.1 });
    } else if (P.onGround) {
      if (support < P.y - 0.05) { P.onGround = false; P.vy = 0; }  // ran off the end of a train
      else P.y = support;
    }
    if (!P.onGround && powers.jetpack <= 0) {
      P.vy -= GRAV * dt * (P.vy < 0 ? 1.15 : 1);
      P.y += P.vy * dt;
      if (P.y <= support) {
        P.y = support; P.vy = 0; P.onGround = true; P.landT = 0.15;
        if (P.slideQ) { P.slideQ = false; P.slideT = 0.72; stats.slides++; sfx.slide(); }
        else if (P.jumpBuf > 0) { P.jumpBuf = 0; jump(); }
      }
    }
    P.ground = support;
    if (P.jumpBuf > 0) P.jumpBuf -= dt;
    if (P.landT > 0) P.landT -= dt;
    if (P.slideT > 0) P.slideT -= dt;

    // collisions
    const h = P.slideT > 0 ? SLIDE_H : RUN_H;
    for (const e of ents) {
      if (!SOLID[e.type] || e.hitDone) continue;
      if (!(e.z < 0.42 && e.z + e.len > -0.42)) continue;
      if (!laneOverlap(e)) continue;
      const top = e.type === "train" ? TRAIN_H : e.y1;
      if (P.y + 0.05 >= top || P.y + h <= e.y0) continue;    // above or below it
      if (e.type === "train" && P.y >= TRAIN_H - 0.45) continue; // standing on it
      if (P.invuln > 0 || powers.jetpack > 0) continue;
      const pz = prevZ.get(e);
      const wasAlongside = pz < 0.42 + 1e-6 && pz + e.len > -0.42;
      e.hitDone = true;
      if (wasAlongside && Math.abs(P.x - LANES[P.lane]) > 0.04) {
        // clipped the side while changing lanes: bounce back and stumble
        stumble();
      } else if (powers.sneakers > 0 && e.type !== "train") {
        P.invuln = 0.4; burst(LANES[e.lane], 0.8, 0.5, 10, ["#7dff4a", "#fff"]); popup("SMASH!", "#7dff4a");
      } else {
        lastCrash = { type: e.type, lane: e.lane, z: +e.z.toFixed(2), px: +P.x.toFixed(2), plane: P.lane, py: +P.y.toFixed(2), slide: P.slideT > 0, t: +runTime.toFixed(1) };
        crash(); return;
      }
    }

    // coins & power-ups
    const magnet = powers.magnet > 0;
    for (const e of ents) {
      if (e.type === "coin") {
        e.spin += dt * 6;
        if (magnet && e.z < 22 && e.z > -1) {
          const k = clamp(dt * 9, 0, 1);
          e.x = lerp(e.x, P.x, k); e.y = lerp(e.y, P.y + 0.9, k); e.z = lerp(e.z, 0, k * 0.8);
        }
        if (Math.abs(e.z) < 0.9 && Math.abs(e.x - P.x) < 1.0 && Math.abs(e.y - (P.y + (P.slideT > 0 ? 0.4 : 0.9))) < 1.25) {
          e.dead = true; coins++; stats.coins++; score += 10 * mult; sfx.coin();
          parts.push({ x: e.x, y: e.y, z: e.z, vx: 0, vy: 3, vz: 0, life: 0.3, t: 0, col: "#fff6a0", s: 0.3, ring: true });
        }
      } else if (e.type === "power") {
        e.spin += dt * 3;
        if (Math.abs(e.z) < 1.1 && Math.abs(e.x - P.x) < 1.1 && Math.abs(e.y - (P.y + 0.9)) < 1.6) {
          e.dead = true; givePower(e.kind);
        }
      }
    }
    ents = ents.filter(e => !e.dead && e.z + (e.len || 0) > -CAM_D - 2);
    spawnAhead();

    // camera: follow lane a bit, rise when the runner is up high so they stay in frame
    camX = lerp(camX, P.x * 0.55, clamp(dt * 7, 0, 1));
    const wantY = powers.jetpack > 0 ? P.y * 0.55 : Math.max(0, P.ground) * 0.75;
    camYoff = lerp(camYoff, wantY, clamp(dt * 4, 0, 1));
    syncHud(false);
  }
  function scrollWorld(dt, spd) {
    const dz = spd * dt;
    for (const e of ents) { e.z -= dz + (e.vz || 0) * dt; }
    // keep a ramp attached to its (possibly moving) train
    for (const e of ents) if (e.type === "ramp" && e.link) e.z = e.link.z - e.len;
    spawnZ -= dz;
    for (const s of scenery) s.z -= dz;
    scenery = scenery.filter(s => s.z + (s.d || 1) > -CAM_D - 3);
    let maxZ = -99; for (const s of scenery) if (s.kind === "bld" && s.z > maxZ) maxZ = s.z;
    while (maxZ < FAR + 10) { maxZ += 9; addSceneryAt(maxZ); }
  }
  function stumble() {
    stats.stumbles++;
    const now = runTime;
    if (now - P.lastStumble < 5) { crash(); return; }  // two stumbles close together = caught
    P.lastStumble = now; P.stumbleT = 1.2; P.invuln = 0.6;
    P.lane = P.prevLane; shake = 0.35; sfx.stumble();
    popup("STUMBLE! careful…", "#ff6b6b");
  }
  function givePower(kind) {
    powers[kind] = POWER_TIME[kind]; stats.powerups++; sfx.power();
    if (kind === "jetpack") { P.slideT = 0; P.vy = 0; spawnSkyCoins(); }
    const info = POWER_INFO[kind];
    toast(info.icon + " " + info.label + "!", info.col);
    burst(P.x, P.y + 1, 0, 18, [info.col, "#fff"]);
  }
  function spawnSkyCoins() {
    // a coin trail up in the air for the jetpack ride
    let l = P.lane;
    for (let z = 8; z < 8 + speed * POWER_TIME.jetpack * 0.9; z += 2.2) {
      if (Math.random() < 0.06) l = clamp(l + (chance(0.5) ? 1 : -1), 0, 2);
      coin(l, z, 7.6);
    }
  }
  function updateParts(dt) {
    for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt - (state === "run" ? speed * dt * 0.5 : 0); p.vy -= 18 * dt; }
    parts = parts.filter(p => p.t < p.life);
    if (parts.length > 260) parts.splice(0, parts.length - 260);
  }

  // ---------- autopilot (used by automated tests; also a fun attract mode) ----------
  function laneThreat(l, maxZ) {
    let best = null;
    for (const e of ents) {
      if (e.lane !== l || !(SOLID[e.type] || e.type === "ramp")) continue;
      if (e.z + e.len < -0.4 || e.z > maxZ) continue;
      if (!best || e.z < best.z) best = e;
    }
    return best;
  }
  function autoDrive() {
    const look = speed * 1.1 + 6;
    const cur = laneThreat(P.lane, look);
    const onTrain = P.ground >= TRAIN_H - 0.1;
    const needsMove = e => e && e.type === "train" && !(onTrain && e.z < 1) && !ents.some(r => r.type === "ramp" && r.link === e && r.z > 0.5);
    if (needsMove(cur) && Math.abs(P.x - LANES[P.lane]) < 0.3) {
      let bestL = P.lane, bestZ = cur.z;
      for (const l of [P.lane - 1, P.lane + 1]) {
        if (l < 0 || l > 2) continue;
        const t = laneThreat(l, look * 2);
        const z = !t ? 999 : (t.type === "train" && !needsMove(t) ? 500 : t.type !== "train" ? 300 + t.z : t.z);
        // side-collision check: is the neighbouring lane blocked right now?
        const blockedNow = ents.some(e => e.lane === l && e.type === "train" && e.z < 1.5 && e.z + e.len > -0.6 && P.y < TRAIN_H - 0.4);
        if (!blockedNow && z > bestZ + 2) { bestZ = z; bestL = l; }
      }
      if (bestL !== P.lane) moveLane(bestL > P.lane ? 1 : -1);
      return;
    }
    if (cur && cur.type === "low" && cur.z < speed * 0.2 + 1.2 && cur.z > -0.2 && P.onGround) jump();
    if (cur && cur.type === "high" && cur.z < speed * 0.16 + 1.5 && cur.z > -0.2 && P.slideT <= 0.1) slide();
  }

  // ---------- HUD ----------
  let hudCache = "";
  function syncHud(force) {
    const s = Math.floor(score), key = s + "|" + coins + "|" + mult + "|" + Object.values(powers).map(v => Math.ceil(v * 4)).join(",");
    if (!force && key === hudCache) return;
    hudCache = key;
    el.score.textContent = s.toLocaleString();
    el.best.textContent = Math.max(best, s).toLocaleString();
    el.coins.textContent = coins;
    el.mult.classList.toggle("hidden", mult < 2);
    let html = "";
    for (const k in powers) {
      if (powers[k] <= 0) continue;
      const info = POWER_INFO[k], pct = Math.round(powers[k] / POWER_TIME[k] * 100);
      html += `<div class="pw"><span class="pw-icon" style="background:${info.col}">${info.icon}</span><span class="pw-bar"><i style="width:${pct}%;background:${info.col}"></i></span></div>`;
    }
    el.powers.innerHTML = html;
  }

  // ---------- rendering: background ----------
  let skyCache = null;
  const skyline = Array.from({ length: 48 }, (_, i) => ({ x: i * 1.0, h: rand(0.25, 1), w: rand(0.6, 1.0), c: chance(0.5) }));
  const clouds = Array.from({ length: 7 }, () => ({ x: rand(0, 1), y: rand(0.05, 0.45), s: rand(0.6, 1.4), v: rand(0.004, 0.012) }));
  function drawSky(dt) {
    if (!skyCache || skyCache.h !== H || skyCache.hy !== Math.round(HY)) {
      const g = ctx.createLinearGradient(0, 0, 0, Math.max(10, HY + 40));
      g.addColorStop(0, "#3fa9ff"); g.addColorStop(0.6, "#8fd3ff"); g.addColorStop(1, "#e6f7ff");
      skyCache = { g, h: H, hy: Math.round(HY) };
    }
    ctx.fillStyle = skyCache.g; ctx.fillRect(0, 0, W, Math.max(0, HY + 2));
    // sun
    const sx = W * 0.78 - camX * 6, sy = Math.max(30, HY * 0.35);
    ctx.fillStyle = "rgba(255,244,190,0.35)"; ctx.beginPath(); ctx.arc(sx, sy, 58, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff6c8"; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, Math.PI * 2); ctx.fill();
    // clouds
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    for (const c of clouds) {
      c.x -= c.v * dt * (state === "run" ? 1 + speed / 30 : 1); if (c.x < -0.2) c.x = 1.2;
      const x = c.x * W, y = c.y * HY, s = c.s * Math.min(W, H) * 0.06;
      ctx.beginPath(); ctx.ellipse(x, y, s * 1.6, s * 0.55, 0, 0, Math.PI * 2); ctx.ellipse(x + s * 0.7, y - s * 0.3, s * 0.9, s * 0.6, 0, 0, Math.PI * 2);
      ctx.ellipse(x - s * 0.6, y - s * 0.2, s * 0.8, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // distant city skyline
    const unit = Math.max(W, 600) / 30, base = HY + 2, off = (camX * 4) % unit;
    for (let i = 0; i < skyline.length; i++) {
      const b = skyline[i], x = i * unit - off - unit * 4, h = b.h * Math.min(H * 0.16, 110);
      ctx.fillStyle = b.c ? "#9db8d9" : "#b6cbe6";
      ctx.fillRect(x, base - h, unit * b.w, h);
    }
  }
  const GRASS = "#69c95a", BED = "#cdbb9c", LANE_TINT = ["#d9cdb6", "#e2d6bf", "#d9cdb6"];
  function drawTrack() {
    // ground plane
    ctx.fillStyle = GRASS; ctx.fillRect(0, HY, W, H - HY);
    const zN = NEAR - CAM_D + 0.01, zF = FAR;
    // walkway edges outside the track
    for (const s of [-1, 1]) {
      poly([projC(s * 3.6, 0, zN), projC(s * 5.6, 0, zN), proj(s * 5.6, 0, zF), proj(s * 3.6, 0, zF)], "#b8b2a8");
    }
    poly([projC(-3.6, 0, zN), projC(3.6, 0, zN), proj(3.6, 0, zF), proj(-3.6, 0, zF)], BED);
    // lanes with a slight tint each so they read as separate
    for (let l = 0; l < 3; l++) {
      const x0 = LANES[l] - 1.05, x1 = LANES[l] + 1.05;
      poly([projC(x0, 0, zN), projC(x1, 0, zN), proj(x1, 0, zF), proj(x0, 0, zF)], LANE_TINT[l]);
    }
    // sleepers (only nearby, where they are visible)
    const step = 1.8, off = dist % step;
    ctx.fillStyle = "#8a6a4a";
    ctx.beginPath();
    for (let z = -off - 2; z < 55; z += step) {
      if (z + 0.45 < zN) continue;
      for (let l = 0; l < 3; l++) {
        const a = projC(LANES[l] - 0.85, 0, z), b = projC(LANES[l] + 0.85, 0, z), c = proj(LANES[l] + 0.85, 0, z + 0.45), d = proj(LANES[l] - 0.85, 0, z + 0.45);
        if (!c || !d) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      }
    }
    ctx.fill();
    // shiny rails
    for (let l = 0; l < 3; l++) {
      for (const s of [-0.55, 0.55]) {
        const x = LANES[l] + s;
        poly([projC(x - 0.07, 0.02, zN), projC(x + 0.07, 0.02, zN), proj(x + 0.07, 0.02, zF), proj(x - 0.07, 0.02, zF)], "#eef3f8", "#5d6b78", 1);
      }
    }
    // bright dashed lane markers between lanes
    const dl = 2.2, gap = 5, offs = dist % gap;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    for (const xm of [-LANE_W / 2, LANE_W / 2]) {
      for (let z = -offs - gap; z < 90; z += gap) {
        if (z + dl < zN) continue;
        const a = projC(xm - 0.09, 0.01, z), b = projC(xm + 0.09, 0.01, z), c = proj(xm + 0.09, 0.01, z + dl), d = proj(xm - 0.09, 0.01, z + dl);
        if (!c) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
      }
    }
    ctx.fill();
    // track edge curbs
    for (const s of [-1, 1]) poly([projC(s * 3.6, 0.01, zN), projC(s * 3.75, 0.01, zN), proj(s * 3.75, 0.01, zF), proj(s * 3.6, 0.01, zF)], "#ffcf3f");
  }
  function drawFog() {
    const p = proj(0, 0, 70);
    if (!p) return;
    const g = ctx.createLinearGradient(0, HY - 2, 0, p.y);
    g.addColorStop(0, "rgba(230,247,255,1)"); g.addColorStop(1, "rgba(230,247,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, HY - 2, W, p.y - HY + 2);
  }
  function drawScenery(s) {
    if (s.kind === "bld") {
      const x0 = s.side < 0 ? -6.2 - s.w : 6.2, x1 = x0 + s.w;
      const r = box(x0, x1, 0, s.h, s.z, s.z + s.d, s.col, { outline: "rgba(40,30,60,0.5)" });
      if (r && s.win && s.z > -2) { // windows on the street-facing side
        const xs = s.side < 0 ? x1 : x0;
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        for (let wy = 1.2; wy < s.h - 0.6; wy += 1.6) {
          for (let wz = s.z + 0.8; wz < s.z + s.d - 0.8; wz += 1.8) {
            const a = proj(xs, wy, wz), b = proj(xs, wy + 0.8, wz + 0.9);
            if (!a || !b) continue;
            ctx.fillRect(Math.min(a.x, b.x), b.y, Math.abs(b.x - a.x) + 1, a.y - b.y);
          }
        }
      }
    } else if (s.kind === "post") {
      const x = s.side * 5.2, a = proj(x, 0, s.z), b = proj(x, 4.2, s.z);
      if (!a || !b) return;
      ctx.strokeStyle = "#4a5562"; ctx.lineWidth = Math.max(1, a.k * 0.12); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = "#ffe98a"; ctx.beginPath(); ctx.arc(b.x - s.side * a.k * 0.3, b.y, Math.max(2, a.k * 0.2), 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---------- rendering: obstacles & pickups ----------
  function hint(e, kind) {
    // floating action chip so you can read what to do from far away
    if (e.z < 3 || e.z > 75) return;
    const p = proj(LANES[e.lane], (kind === "up" ? LOW_H : HIGH_Y1) + 1.0, e.z);
    if (!p) return;
    const r = Math.max(7, p.k * 0.42);
    ctx.globalAlpha = clamp((e.z - 3) / 6, 0, 1) * 0.95;
    ctx.fillStyle = kind === "up" ? "#22c55e" : "#3b82f6";
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.18); ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath();
    const s = r * 0.55, dirn = kind === "up" ? -1 : 1;
    ctx.moveTo(p.x, p.y + dirn * s); ctx.lineTo(p.x - s * 0.85, p.y - dirn * s * 0.2); ctx.lineTo(p.x - s * 0.3, p.y - dirn * s * 0.2);
    ctx.lineTo(p.x - s * 0.3, p.y - dirn * s); ctx.lineTo(p.x + s * 0.3, p.y - dirn * s); ctx.lineTo(p.x + s * 0.3, p.y - dirn * s * 0.2);
    ctx.lineTo(p.x + s * 0.85, p.y - dirn * s * 0.2); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawTrain(e) {
    const x = LANES[e.lane], x0 = x - 1.0, x1 = x + 1.0;
    const r = box(x0, x1, 0.15, TRAIN_H, e.z, e.z + e.len, e.col, { top: shade(e.col, 0.35) });
    // side windows (on whichever side faces the camera)
    const xs = x1 < camX ? x1 : x0 > camX ? x0 : null;
    if (xs !== null) {
      ctx.fillStyle = "rgba(220,240,255,0.85)";
      for (let wz = Math.max(e.z + 1, -CAM_D + 0.6); wz < e.z + e.len - 1.2; wz += 2.4) {
        const q1 = proj(xs, 1.25, wz), q2 = proj(xs, 1.25, wz + 1.5), q3 = proj(xs, 2.2, wz + 1.5), q4 = proj(xs, 2.2, wz);
        if (!q1 || !q2 || !q3 || !q4) continue;
        ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.lineTo(q3.x, q3.y); ctx.lineTo(q4.x, q4.y); ctx.closePath(); ctx.fill();
      }
    }
    if (!r) return;
    const { a, b, c, d } = r, w = b.x - a.x, hgt = a.y - d.y;
    if (e.z < NEAR - CAM_D + 0.06) return; // front face is behind the camera
    // front: stripe, windshield, lights
    ctx.fillStyle = e.stripe; ctx.fillRect(a.x, a.y - hgt * 0.36, w, hgt * 0.1);
    ctx.fillStyle = "#1c2b4a"; roundRect(a.x + w * 0.14, d.y + hgt * 0.12, w * 0.72, hgt * 0.34, w * 0.06); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(a.x + w * 0.2, d.y + hgt * 0.15, w * 0.12, hgt * 0.26);
    const lit = e.vz ? (Math.floor(performance.now() / 160) % 2 ? "#ff2a2a" : "#fff3a0") : "#fff3a0";
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(a.x + w * 0.2, a.y - hgt * 0.16, w * 0.07, 0, Math.PI * 2); ctx.arc(a.x + w * 0.8, a.y - hgt * 0.16, w * 0.07, 0, Math.PI * 2); ctx.fill();
    if (e.vz && e.z > 4) { // oncoming warning
      ctx.fillStyle = "#ff2a2a"; ctx.font = `900 ${Math.max(10, w * 0.22)}px sans-serif`; ctx.textAlign = "center";
      ctx.fillText("⚠", a.x + w / 2, d.y - hgt * 0.08);
    }
  }
  function drawRamp(e) {
    const x = LANES[e.lane], x0 = x - 0.95, x1 = x + 0.95;
    const z0 = Math.max(e.z, NEAR - CAM_D + 0.05), z1 = e.z + e.len;
    if (z1 <= z0) return;
    const yAt = z => TRAIN_H * clamp((z - e.z) / e.len, 0, 1);
    const a = proj(x0, 0, z0), b = proj(x1, 0, z0), c = proj(x1, yAt(z0), z0), d = proj(x0, yAt(z0), z0);
    const tA = proj(x0, TRAIN_H, z1), tB = proj(x1, TRAIN_H, z1);
    const out = "rgba(20,10,30,0.8)";
    poly([d, c, tB, tA], "#ffd23f", out, Math.max(1, a.k * 0.03));
    // chevrons on the slope
    ctx.fillStyle = "#1f1f1f";
    for (let i = 0.15; i < 1; i += 0.28) {
      const z = e.z + e.len * i; if (z < z0) continue;
      const p1 = proj(x0 + 0.3, yAt(z), z), p2 = proj(x, yAt(z + 0.6), z + 0.6), p3 = proj(x1 - 0.3, yAt(z), z);
      if (!p1 || !p2 || !p3) continue;
      ctx.lineWidth = Math.max(1.5, p1.k * 0.14); ctx.strokeStyle = "#1f1f1f"; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.stroke();
    }
    if (x1 < camX) poly([b, proj(x1, 0, z1), tB, c], "#b8941c", out, 1);
    else if (x0 > camX) poly([a, proj(x0, 0, z1), tA, d], "#b8941c", out, 1);
  }
  function drawLow(e) {
    const x = LANES[e.lane];
    for (const s of [-0.85, 0.75]) box(x + s, x + s + 0.1, 0, LOW_H, e.z, e.z + 0.2, "#555");
    const r = box(x - 0.98, x + 0.98, 0.4, LOW_H, e.z, e.z + 0.25, "#ffffff", { top: "#ddd" });
    if (r && e.z > NEAR - CAM_D + 0.06) { // warning stripes
      const { a, b, d } = r, w = b.x - a.x, hgt = a.y - d.y;
      ctx.save(); ctx.beginPath(); ctx.rect(a.x, d.y, w, hgt); ctx.clip();
      ctx.fillStyle = "#ff3b3b";
      for (let i = -2; i < 8; i++) { const sx = a.x + i * w / 6; ctx.beginPath(); ctx.moveTo(sx, a.y); ctx.lineTo(sx + w / 12, a.y); ctx.lineTo(sx + w / 12 + hgt, d.y); ctx.lineTo(sx + hgt, d.y); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = "rgba(20,10,30,0.9)"; ctx.lineWidth = Math.max(1, a.k * 0.04); ctx.strokeRect(a.x, d.y, w, hgt);
    }
    hint(e, "up");
  }
  function drawHigh(e) {
    const x = LANES[e.lane];
    for (const s of [-1.0, 0.88]) box(x + s, x + s + 0.12, 0, HIGH_Y1, e.z, e.z + 0.2, "#3b4656");
    const r = box(x - 1.0, x + 1.0, HIGH_Y0, HIGH_Y0 + 0.75, e.z, e.z + 0.25, "#2563eb", { top: "#60a5fa" });
    box(x - 1.0, x + 1.0, HIGH_Y1 - 0.25, HIGH_Y1, e.z, e.z + 0.25, "#3b4656");
    if (r && e.z > NEAR - CAM_D + 0.06) {
      const { a, b, d } = r, w = b.x - a.x, hgt = a.y - d.y;
      ctx.fillStyle = "#fff"; ctx.font = `900 ${Math.max(8, hgt * 0.62)}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("▼ SLIDE ▼", a.x + w / 2, d.y + hgt * 0.55);
      ctx.textBaseline = "alphabetic";
    }
    hint(e, "down");
  }
  function drawCoin(e) {
    const p = proj(e.x, e.y, e.z);
    if (!p) return;
    const r = Math.max(1.5, p.k * 0.36), sx = Math.abs(Math.cos(e.spin));
    ctx.fillStyle = "#b8860b"; ctx.beginPath(); ctx.ellipse(p.x, p.y, r * Math.max(0.18, sx), r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.ellipse(p.x, p.y, r * Math.max(0.12, sx) * 0.82, r * 0.82, 0, 0, Math.PI * 2); ctx.fill();
    if (r > 4) { ctx.fillStyle = "#fff6b0"; ctx.beginPath(); ctx.ellipse(p.x - r * 0.25 * sx, p.y - r * 0.3, r * 0.18 * Math.max(0.3, sx), r * 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawPower(e) {
    const bob = Math.sin(performance.now() / 250 + e.z) * 0.15;
    const p = proj(e.x, e.y + bob, e.z);
    if (!p) return;
    const info = POWER_INFO[e.kind], s = Math.max(6, p.k * 0.6);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.arc(p.x, p.y, s * 1.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = info.col; roundRect(p.x - s, p.y - s, s * 2, s * 2, s * 0.4); ctx.fill();
    ctx.lineWidth = Math.max(1.5, s * 0.14); ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = "#111"; ctx.font = `900 ${s * 1.1}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(info.icon, p.x, p.y + s * 0.05); ctx.textBaseline = "alphabetic";
  }
  function drawEnt(e) {
    switch (e.type) {
      case "train": drawTrain(e); break;
      case "ramp": drawRamp(e); break;
      case "low": drawLow(e); break;
      case "high": drawHigh(e); break;
      case "coin": drawCoin(e); break;
      case "power": drawPower(e); break;
    }
  }

  // ---------- rendering: the runner ----------
  // Drawn as a chunky "sticker": a thick white outline pass, then a dark-outlined colour pass,
  // so it pops against any background. Units are world units (1.75 tall), scaled by projection.
  function drawRunner() {
    const ch = CHARS[charIdx];
    const feet = proj(P.x, P.y, 0), gnd = proj(P.x, P.ground, 0);
    if (!feet || !gnd) return;
    const k = feet.k;
    const air = P.y - P.ground;
    // ground marker + shadow so you always know which lane you're in
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(gnd.x, gnd.y, k * 0.62 * (1 - clamp(air / 8, 0, 0.5)), k * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ch.body; ctx.globalAlpha = 0.85; ctx.lineWidth = Math.max(2, k * 0.06);
    ctx.beginPath(); ctx.ellipse(gnd.x, gnd.y, k * 0.8, k * 0.26, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    if (P.invuln > 0 && state === "run" && Math.floor(P.invuln * 12) % 2 === 0 && powers.jetpack <= 0) ctx.globalAlpha = 0.55;

    ctx.save();
    ctx.translate(feet.x, feet.y);
    ctx.scale(k, k);
    ctx.rotate(P.tilt * 0.18 + (P.stumbleT > 0 ? Math.sin(P.stumbleT * 30) * 0.08 : 0));
    const sliding = P.slideT > 0, inAir = !P.onGround && powers.jetpack <= 0, jet = powers.jetpack > 0;
    if (sliding) { ctx.translate(0, -0.05); ctx.scale(1.18, 0.5); }
    if (P.landT > 0) ctx.scale(1 + P.landT * 0.6, 1 - P.landT * 0.6);
    const ph = P.runT * 11, bob = (inAir || jet) ? 0 : Math.abs(Math.sin(ph)) * 0.07;
    ctx.translate(0, -bob);
    const lift = s => (inAir || jet) ? 0.28 : Math.max(0, Math.sin(ph + s)) * 0.32;
    const armSw = s => (inAir || jet) ? -0.45 : Math.sin(ph + s) * 0.22;
    const pass = mode => {
      const O = mode === 0; // outline pass
      const fill = (c) => { ctx.fillStyle = O ? "#ffffff" : c; ctx.fill(); ctx.lineWidth = O ? 0.2 : 0.06; ctx.strokeStyle = O ? "#ffffff" : "#140c22"; ctx.stroke(); };
      const limb = (x0, y0, x1, y1, w, c) => {
        ctx.lineCap = "round";
        if (O) { ctx.strokeStyle = "#fff"; ctx.lineWidth = w + 0.2; }
        else { ctx.strokeStyle = "#140c22"; ctx.lineWidth = w + 0.1; }
        ctx.beginPath(); ctx.moveTo(x0, -y0); ctx.lineTo(x1, -y1); ctx.stroke();
        if (!O) { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, -y0); ctx.lineTo(x1, -y1); ctx.stroke(); }
      };
      // legs + shoes
      for (const [sx, s] of [[-0.17, 0], [0.17, Math.PI]]) {
        const fl = lift(s);
        limb(sx, 0.86, sx * 1.05, 0.12 + fl, 0.22, ch.pants);
        ctx.beginPath(); roundRect(sx - 0.17, -(0.16 + fl), 0.34, 0.2, 0.08);
        fill(powers.sneakers > 0 ? "#7dff4a" : "#ffffff");
      }
      // arms (behind torso edges)
      for (const [sx, s] of [[-1, Math.PI], [1, 0]]) {
        const sw = armSw(s);
        limb(sx * 0.33, 1.38, sx * (0.45 + (jet ? 0.05 : 0)), 0.98 - sw * 0.6 + (inAir ? 0.55 : 0), 0.15, ch.body);
      }
      // torso (hoodie)
      ctx.beginPath(); roundRect(-0.34, -1.48, 0.68, 0.66, 0.18); fill(ch.body);
      // backpack / jetpack
      if (jet) {
        ctx.beginPath(); roundRect(-0.3, -1.42, 0.24, 0.5, 0.08); fill("#c0c8d0");
        ctx.beginPath(); roundRect(0.06, -1.42, 0.24, 0.5, 0.08); fill("#c0c8d0");
        if (!O) {
          const fl = 0.35 + Math.random() * 0.25;
          ctx.fillStyle = "#ffb703"; ctx.beginPath(); ctx.moveTo(-0.28, -0.92); ctx.lineTo(-0.18, -0.92 + fl); ctx.lineTo(-0.08, -0.92); ctx.fill();
          ctx.beginPath(); ctx.moveTo(0.08, -0.92); ctx.lineTo(0.18, -0.92 + fl); ctx.lineTo(0.28, -0.92); ctx.fill();
        }
      } else {
        ctx.beginPath(); roundRect(-0.22, -1.38, 0.44, 0.42, 0.1); fill(ch.trim);
        if (!O) { ctx.fillStyle = shade(ch.trim, -0.3); ctx.fillRect(-0.16, -1.12, 0.32, 0.05); }
      }
      // head: hair from behind + cap
      ctx.beginPath(); ctx.arc(0, -1.68, 0.25, 0, Math.PI * 2); fill(ch.hair);
      if (!O) { ctx.fillStyle = ch.skin; ctx.beginPath(); ctx.arc(-0.25, -1.66, 0.06, 0, Math.PI * 2); ctx.arc(0.25, -1.66, 0.06, 0, Math.PI * 2); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(0, -1.8, 0.27, 0.15, 0, Math.PI, 0); ctx.closePath(); fill(ch.trim);
    };
    pass(0); pass(1);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------- main draw ----------
  function drawParts() {
    for (const p of parts) {
      const q = proj(p.x, p.y, p.z);
      if (!q) continue;
      const a = 1 - p.t / p.life;
      ctx.globalAlpha = a;
      if (p.ring) { ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, q.k * 0.08); ctx.beginPath(); ctx.arc(q.x, q.y, q.k * (0.3 + p.t * 2), 0, Math.PI * 2); ctx.stroke(); }
      else { ctx.fillStyle = p.col; const s = Math.max(1.5, q.k * p.s); ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s); }
    }
    ctx.globalAlpha = 1;
  }
  function drawSpeedLines() {
    if (state !== "run" || speed < 28) return;
    const n = Math.floor((speed - 26) / 3);
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, y = rand(H * 0.3, H * 0.95), x = side > 0 ? rand(W * 0.82, W) : rand(0, W * 0.18), l = rand(20, 60);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + side * l * 0.4, y + l); ctx.stroke();
    }
  }
  function drawFloaters() {
    const head = proj(P.x, P.y + 2.4, 0);
    if (!head) return;
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = 1 - f.t / 1.1;
      ctx.font = `900 ${Math.round(Math.max(16, head.k * 0.42))}px Trebuchet MS, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = "#140c22"; ctx.strokeText(f.text, head.x, head.y - f.t * 40);
      ctx.fillStyle = f.col; ctx.fillText(f.text, head.x, head.y - f.t * 40);
    }
    ctx.globalAlpha = 1;
  }
  const drawList = [];
  function draw(dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const sx = shake > 0 ? rand(-1, 1) * shake * 14 : 0, sy = shake > 0 ? rand(-1, 1) * shake * 10 : 0;
    ctx.translate(sx, sy);
    drawSky(dt);
    drawTrack();
    drawFog();
    // scenery far → near
    scenery.sort((a, b) => b.z - a.z);
    for (const s of scenery) if (s.z < FAR && s.z + (s.d || 0) > 1) drawScenery(s);
    // entities sorted far → near. Things alongside / ahead go before the runner; anything the runner
    // has already passed is drawn after, see-through, so the runner is never hidden.
    drawList.length = 0;
    for (const e of ents) {
      if (e.z > FAR) continue;
      const far = e.z + (e.len || 0);
      const key = far > -0.5 ? Math.max(e.z, 0.02) : e.z;
      drawList.push({ e, key });
    }
    drawList.sort((a, b) => b.key - a.key);
    let runnerDrawn = false;
    for (const it of drawList) {
      if (!runnerDrawn && it.key < 0) {
        drawRunner(); runnerDrawn = true;
      }
      if (it.key < 0) ctx.globalAlpha = 0.3;
      else if (it.e.z > FAR - 25) ctx.globalAlpha = clamp((FAR - it.e.z) / 25, 0, 1);
      drawEnt(it.e);
      ctx.globalAlpha = 1;
    }
    if (!runnerDrawn) drawRunner();
    drawParts();
    drawSpeedLines();
    drawFloaters();
    if (state === "dying") { ctx.fillStyle = `rgba(255,60,60,${clamp(dieT - 0.6, 0, 0.4)})`; ctx.fillRect(-20, -20, W + 40, H + 40); }
  }

  // ---------- loop ----------
  let last = performance.now(), acc = 0;
  const STEP = 1 / 120;
  function frame(t) {
    let dt = (t - last) / 1000; last = t;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 14) { update(STEP); acc -= STEP; n++; }
    if (n >= 14) acc = 0;
    draw(dt);
    requestAnimationFrame(frame);
  }

  // ---------- UI wiring ----------
  function buildChars() {
    el.chars.innerHTML = "";
    CHARS.forEach((c, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "char" + (i === charIdx ? " on" : "");
      b.style.setProperty("--c", c.body); b.style.setProperty("--t", c.trim);
      b.innerHTML = `<span class="char-dot"></span><span class="char-name">${c.name}</span>`;
      b.addEventListener("click", e => { e.stopPropagation(); charIdx = i; store.set(STORE_CHAR, c.id); buildChars(); sfx.ensure(); sfx.lane(); });
      el.chars.appendChild(b);
    });
  }
  const tapBtn = (b, fn) => b.addEventListener("click", e => { e.stopPropagation(); fn(); });
  tapBtn(el.play, startRun);
  tapBtn(el.retry, startRun);
  tapBtn(el.menu, showTitle);
  tapBtn(el.resume, () => setPaused(false));
  tapBtn(el.quit, () => { setPaused(false); state = "run"; showTitle(); });
  tapBtn(el.pauseBtn, () => setPaused(true));
  tapBtn(el.mute, () => {
    sfx.muted = !sfx.muted; store.set(STORE_MUTE, sfx.muted ? "1" : "0");
    el.mute.classList.toggle("muted", sfx.muted); if (!sfx.muted) { sfx.ensure(); sfx.coin(); }
  });
  el.mute.classList.toggle("muted", sfx.muted);
  document.addEventListener("visibilitychange", () => { if (document.hidden) setPaused(true); });
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  // test / debug hook
  window.__surf = {
    get state() { return state; }, get score() { return Math.floor(score); }, get coins() { return coins; }, get speed() { return speed; },
    get dist() { return dist; }, get lane() { return P.lane; }, get y() { return P.y; }, get best() { return best; },
    get powers() { return Object.assign({}, powers); }, get stats() { return Object.assign({}, stats); }, get ents() { return ents.length; },
    get runner() { const p = proj(P.x, P.y, 0); return p ? { x: p.x, y: p.y, heightPx: RUN_H * p.k, W, H } : null; },
    get lastCrash() { return lastCrash; }, start: startRun, setAutopilot(on) { autopilot = !!on; }, give: givePower, moveLane, jump, slide,
  };

  resize();
  buildChars();
  showTitle();
  requestAnimationFrame(frame);
})();
