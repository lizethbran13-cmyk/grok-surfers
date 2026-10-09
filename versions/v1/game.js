/* Grok Surfers — self-contained endless runner (no build, no CDN) */
(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const el = {
    hud: document.getElementById("hud"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    coins: document.getElementById("coin-count"),
    title: document.getElementById("title"),
    gameover: document.getElementById("gameover"),
    play: document.getElementById("play"),
    retry: document.getElementById("retry"),
    titleBest: document.getElementById("title-best"),
    goTitle: document.getElementById("go-title"),
    goScore: document.getElementById("go-score"),
    goCoins: document.getElementById("go-coins"),
    goBest: document.getElementById("go-best"),
    newBest: document.getElementById("new-best"),
    mute: document.getElementById("mute"),
  };

  const STORE_BEST = "grokSurfersBest";
  const STORE_MUTE = "grokSurfersMute";
  const LANES = [-2.35, 0, 2.35];
  const PLAYER_Z = 1.15;
  const DRAW_DIST = 92;
  const CAM_Z = 6.6;
  const CAM_Y = 3.55;

  let W = 800, H = 600, dpr = 1;
  let state = "title"; // title | playing | dead
  let time = 0;
  let lastT = 0;
  let shake = 0;
  let deadTimer = 0;
  let hudTick = 0;

  const world = {
    z: 0,
    speed: 28,
    score: 0,
    coins: 0,
    best: 0,
    spawnAt: 36,
  };

  const player = {
    lane: 1,
    x: 0,
    y: 0,
    vy: 0,
    sliding: 0,
    jumping: false,
    runT: 0,
    alive: true,
  };

  let entities = [];
  let buildings = [];
  let pillars = [];
  let particles = [];
  let floaters = [];
  let clouds = [];

  const keys = new Set();
  const inputLock = { left: false, right: false, jump: false, slide: false };

  // ---------- persistence ----------
  function loadBest() {
    try { return Math.max(0, parseInt(localStorage.getItem(STORE_BEST) || "0", 10) || 0); }
    catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(STORE_BEST, String(v)); } catch {}
  }
  function loadMute() {
    try { return localStorage.getItem(STORE_MUTE) === "1"; } catch { return false; }
  }
  function saveMute(m) {
    try { localStorage.setItem(STORE_MUTE, m ? "1" : "0"); } catch {}
  }

  world.best = loadBest();

  // ---------- audio ----------
  const sfx = {
    ctx: null,
    muted: loadMute(),
    ensure() {
      if (this.muted) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type, gain, slide) {
      if (this.muted || !this.ctx) return;
      const c = this.ctx;
      const t0 = c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
      g.gain.setValueAtTime(gain || 0.07, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    noise(dur, gain) {
      if (this.muted || !this.ctx) return;
      const c = this.ctx;
      const n = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = c.createBufferSource();
      src.buffer = n;
      const f = c.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 900;
      const g = c.createGain();
      g.gain.value = gain || 0.12;
      src.connect(f); f.connect(g); g.connect(c.destination);
      src.start();
    },
    jump() { this.tone(420, 0.12, "square", 0.06, 680); },
    slide() { this.tone(220, 0.16, "sawtooth", 0.04, 90); },
    coin() { this.tone(880, 0.09, "square", 0.05, 1400); this.tone(1175, 0.12, "square", 0.03); },
    crash() { this.noise(0.28, 0.18); this.tone(160, 0.35, "sawtooth", 0.08, 50); },
    start() { this.tone(330, 0.12, "square", 0.06); this.tone(440, 0.14, "square", 0.05); this.tone(660, 0.2, "square", 0.05); },
  };
  el.mute.classList.toggle("muted", sfx.muted);
  el.mute.textContent = sfx.muted ? "×" : "♪";

  // ---------- canvas ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function project(x, y, z) {
    const dz = z + CAM_Z;
    if (dz < 0.18) return null;
    const f = Math.min(W, H) * 0.92;
    const k = f / dz;
    return {
      x: W * 0.5 + x * k,
      y: H * 0.30 + (CAM_Y - y) * k,
      k,
    };
  }

  function quad(a, b, c, d, fill, stroke, lw) {
    if (!a || !b || !c || !d) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw || 1;
      ctx.stroke();
    }
  }

  function drawBox(x, y, z, w, h, d, pal) {
    const x0 = x - w * 0.5, x1 = x + w * 0.5;
    const y0 = y, y1 = y + h;
    const z0 = z, z1 = z + d;
    const flb = project(x0, y0, z0);
    const frb = project(x1, y0, z0);
    const flt = project(x0, y1, z0);
    const frt = project(x1, y1, z0);
    const blb = project(x0, y0, z1);
    const brb = project(x1, y0, z1);
    const blt = project(x0, y1, z1);
    const brt = project(x1, y1, z1);
    if (!flb || !frb || !flt || !frt) return;
    if (blt && brt) quad(blt, brt, frt, flt, pal.top);
    if (x >= 0 && flb && flt && blt && blb) quad(flb, flt, blt, blb, pal.side);
    if (x <= 0 && frb && brb && brt && frt) quad(frb, brb, brt, frt, pal.side);
    quad(flb, frb, frt, flt, pal.front, pal.edge, 1.2);
  }

  // ---------- scenery seed ----------
  function rand(a, b) { return a + Math.random() * (b - a); }
  function irand(a, b) { return (a + Math.random() * (b - a + 1)) | 0; }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  const BUILDING_PAL = ["#5b2a86", "#2a4d8f", "#8f2a5b", "#2a6f6f", "#6b3fa0", "#3d4a8c", "#a33b6b", "#1f5f8b"];
  const TRAIN_PAL = [
    { front: "#e63946", side: "#b4232e", top: "#ff6b6b", edge: "#6b1018", accent: "#fff" },
    { front: "#00bbf9", side: "#0077b6", top: "#90e0ef", edge: "#023e8a", accent: "#fff" },
    { front: "#80b918", side: "#4f772d", top: "#cce891", edge: "#31572c", accent: "#fff" },
    { front: "#9b5de5", side: "#6a2c91", top: "#c77dff", edge: "#3c096c", accent: "#fff" },
    { front: "#f4a261", side: "#e76f51", top: "#ffe0a3", edge: "#9c3d1e", accent: "#fff" },
    { front: "#ff4d8d", side: "#c1126b", top: "#ff9ec4", edge: "#6a0436", accent: "#fff" },
  ];

  function resetScenery() {
    buildings = [];
    pillars = [];
    clouds = [];
    for (let i = 0; i < 48; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      buildings.push({
        z: i * 7.5 + rand(0, 4),
        side,
        x: side * (5.8 + rand(0, 2.8)),
        w: 2.2 + rand(0, 2.8),
        h: 5 + rand(0, 12),
        d: 3 + rand(0, 5),
        color: pick(BUILDING_PAL),
        seed: Math.random() * 100,
      });
    }
    for (let i = 0; i < 24; i++) {
      pillars.push({
        z: i * 16 + 4,
        side: i % 2 === 0 ? -1 : 1,
      });
    }
    for (let i = 0; i < 8; i++) {
      clouds.push({
        x: rand(-0.8, 0.8),
        y: rand(0.04, 0.22),
        s: rand(40, 90),
        v: rand(4, 14),
        a: rand(0.25, 0.5),
      });
    }
  }

  // ---------- entities ----------
  function addTrain(lane, z, len) {
    entities.push({
      kind: "train",
      lane, z, len: len || rand(9, 16),
      pal: pick(TRAIN_PAL),
      w: 2.05, h: 2.35,
    });
  }
  function addLow(lane, z) {
    entities.push({ kind: "low", lane, z, len: 1.35, w: 1.9, h: 0.82 });
  }
  function addHigh(lane, z) {
    entities.push({ kind: "high", lane, z, len: 1.15, w: 1.95, barY: 0.92, h: 2.4 });
  }
  function addCoin(lane, z, y) {
    entities.push({ kind: "coin", lane, z, y: y == null ? 0.72 : y, taken: false, spin: Math.random() * Math.PI });
  }

  function coinRun(lane, z, n, gap, y) {
    for (let i = 0; i < n; i++) addCoin(lane, z + i * (gap || 1.7), y);
  }

  function placePattern(z) {
    const r = Math.random();
    const L = [0, 1, 2];
    const a = irand(0, 2);
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;

    if (r < 0.16) {
      coinRun(a, z, 7, 1.6, 0.72);
      if (Math.random() < 0.45) coinRun(b, z + 6, 4, 1.6, 0.72);
    } else if (r < 0.34) {
      addTrain(a, z, rand(10, 15));
      coinRun(b, z + 1, 6, 1.7, 0.72);
      if (Math.random() < 0.35) addLow(c, z + 8);
    } else if (r < 0.48) {
      addTrain(a, z, rand(11, 16));
      addTrain(b, z + rand(0, 3), rand(10, 15));
      coinRun(c, z + 2, 5, 1.8, 0.72);
    } else if (r < 0.6) {
      addLow(a, z);
      addLow(b, z);
      coinRun(a, z - 2, 2, 1.5, 1.95);
      addCoin(a, z, 1.95);
      addCoin(b, z, 1.95);
      if (Math.random() < 0.5) coinRun(c, z - 1, 4, 1.6, 0.72);
    } else if (r < 0.72) {
      addHigh(a, z);
      addHigh(b, z);
      coinRun(c, z - 1, 4, 1.6, 0.72);
    } else if (r < 0.82) {
      addTrain(a, z, 12);
      addLow(b, z + 2);
      addCoin(b, z + 2, 1.95);
      coinRun(c, z, 5, 1.7, 0.72);
    } else if (r < 0.9) {
      addTrain(a, z, 13);
      addHigh(b, z + 1);
      coinRun(c, z, 6, 1.6, 0.72);
    } else if (r < 0.96) {
      addLow(0, z);
      addLow(1, z);
      addLow(2, z);
      addCoin(0, z, 1.95);
      addCoin(1, z, 1.95);
      addCoin(2, z, 1.95);
    } else {
      addHigh(0, z);
      addHigh(1, z);
      addHigh(2, z);
    }

    if (Math.random() < 0.28) {
      coinRun(L[irand(0, 2)], z + 10, 3, 1.5, Math.random() < 0.3 ? 1.95 : 0.72);
    }
  }

  function resetGame(full) {
    world.z = 0;
    world.speed = 28;
    world.score = 0;
    world.coins = 0;
    world.beatBest = false;
    world.spawnAt = 32;
    player.lane = 1;
    player.x = LANES[1];
    player.y = 0;
    player.vy = 0;
    player.sliding = 0;
    player.jumping = false;
    player.runT = 0;
    player.alive = true;
    entities = [];
    particles = [];
    floaters = [];
    shake = 0;
    deadTimer = 0;
    resetScenery();
    if (full) {
      for (let s = 20; s < 80; s += 18) {
        if (Math.random() < 0.5) coinRun(irand(0, 2), s, 4, 1.6, 0.72);
      }
    }
    syncHud();
  }

  // ---------- player actions ----------
  function moveLane(dir) {
    if (state !== "playing" || !player.alive) return;
    const n = player.lane + dir;
    if (n < 0 || n > 2) return;
    player.lane = n;
  }
  function jump() {
    if (state !== "playing" || !player.alive) return;
    if (player.jumping) return;
    player.sliding = 0;
    player.jumping = true;
    player.vy = 10.6;
    sfx.ensure();
    sfx.jump();
  }
  function slide() {
    if (state !== "playing" || !player.alive) return;
    if (player.jumping) return;
    if (player.sliding > 0) {
      player.sliding = Math.max(player.sliding, 0.42);
      return;
    }
    player.sliding = 0.52;
    sfx.ensure();
    sfx.slide();
  }

  function startGame() {
    sfx.ensure();
    sfx.start();
    resetGame(true);
    state = "playing";
    el.title.classList.add("hidden");
    el.gameover.classList.add("hidden");
    el.hud.classList.remove("hidden");
    syncHud();
  }

  function crash() {
    if (!player.alive) return;
    player.alive = false;
    state = "dead";
    shake = 14;
    deadTimer = 0;
    sfx.ensure();
    sfx.crash();
    const p = project(player.x, player.y + 0.8, PLAYER_Z);
    if (p) {
      for (let i = 0; i < 42; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 280;
        particles.push({
          sx: p.x, sy: p.y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 60,
          life: 0.5 + Math.random() * 0.5,
          max: 0.8,
          size: 3 + Math.random() * 7,
          color: pick(["#ff7a18", "#ffd23f", "#ff4d8d", "#fff", "#e63946"]),
          screen: true,
        });
      }
    }
    world.beatBest = world.score > world.best;
    if (world.beatBest) {
      world.best = world.score;
      saveBest(world.best);
    }
  }

  function showGameOver() {
    el.goScore.textContent = String(world.score);
    el.goCoins.textContent = String(world.coins);
    el.goBest.textContent = String(world.best);
    el.newBest.classList.toggle("hidden", !world.beatBest);
    el.gameover.classList.remove("hidden");
    el.goTitle.textContent = pick(["CRASHED!", "SPLAT!", "TRAIN HUGGED!", "OOF!", "YEETED!"]);
  }

  // ---------- HUD ----------
  function syncHud() {
    el.score.textContent = String(world.score);
    el.best.textContent = String(world.best);
    el.coins.textContent = String(world.coins);
    if (world.best > 0) el.titleBest.textContent = "BEST  " + world.best;
    else el.titleBest.textContent = "Tap or click to start";
  }
  syncHud();

  // ---------- input ----------
  function onDown(code) {
    if (code === "ArrowLeft" || code === "KeyA") {
      if (!inputLock.left) { moveLane(-1); inputLock.left = true; }
    } else if (code === "ArrowRight" || code === "KeyD") {
      if (!inputLock.right) { moveLane(1); inputLock.right = true; }
    } else if (code === "ArrowUp" || code === "KeyW" || code === "Space") {
      if (state === "title") { startGame(); return; }
      if (state === "dead" && deadTimer > 0.65) { startGame(); return; }
      if (!inputLock.jump) { jump(); inputLock.jump = true; }
    } else if (code === "ArrowDown" || code === "KeyS") {
      if (!inputLock.slide) { slide(); inputLock.slide = true; }
    } else if (code === "Enter") {
      if (state === "title" || (state === "dead" && deadTimer > 0.65)) startGame();
    }
  }
  function onUp(code) {
    if (code === "ArrowLeft" || code === "KeyA") inputLock.left = false;
    if (code === "ArrowRight" || code === "KeyD") inputLock.right = false;
    if (code === "ArrowUp" || code === "KeyW" || code === "Space") inputLock.jump = false;
    if (code === "ArrowDown" || code === "KeyS") inputLock.slide = false;
  }

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Space"].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    onDown(e.code);
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
    onUp(e.code);
  });

  el.play.addEventListener("click", (e) => { e.stopPropagation(); startGame(); });
  el.retry.addEventListener("click", (e) => { e.stopPropagation(); startGame(); });
  el.title.addEventListener("click", () => { if (state === "title") startGame(); });
  el.gameover.addEventListener("click", () => {
    if (state === "dead" && deadTimer > 0.65) startGame();
  });
  el.mute.addEventListener("click", (e) => {
    e.stopPropagation();
    sfx.muted = !sfx.muted;
    saveMute(sfx.muted);
    el.mute.classList.toggle("muted", sfx.muted);
    el.mute.textContent = sfx.muted ? "×" : "♪";
    if (!sfx.muted) sfx.ensure();
  });

  canvas.addEventListener("click", () => {
    if (state === "title") startGame();
    else if (state === "dead" && deadTimer > 0.65) startGame();
  });

  // touch / swipe
  let touch = { x: 0, y: 0, active: false };
  function touchStart(e) {
    const t = e.changedTouches[0];
    touch.x = t.clientX; touch.y = t.clientY; touch.active = true;
    sfx.ensure();
  }
  function touchEnd(e) {
    if (!touch.active) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch.active = false;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (state === "title") { startGame(); return; }
    if (state === "dead" && deadTimer > 0.65) { startGame(); return; }
    if (state !== "playing") return;
    if (ax < 22 && ay < 22) {
      jump();
      return;
    }
    if (ax > ay) moveLane(dx > 0 ? 1 : -1);
    else if (dy < 0) jump();
    else slide();
  }
  window.addEventListener("touchstart", touchStart, { passive: true });
  window.addEventListener("touchend", touchEnd, { passive: true });
  window.addEventListener("touchcancel", () => { touch.active = false; }, { passive: true });

  // ---------- update ----------
  function hitbox() {
    const sliding = player.sliding > 0;
    return {
      x: player.x,
      hw: sliding ? 0.7 : 0.55,
      y0: player.y,
      y1: player.y + (sliding ? 0.5 : 1.45),
      z0: PLAYER_Z - 0.35,
      z1: PLAYER_Z + 0.85,
    };
  }

  function overlaps(hb, lane, z, len, y0, y1, hw) {
    const lx = LANES[lane];
    if (Math.abs(hb.x - lx) > hb.hw + hw) return false;
    const z0 = z, z1 = z + len;
    if (hb.z1 < z0 || hb.z0 > z1) return false;
    if (hb.y1 < y0 || hb.y0 > y1) return false;
    return true;
  }

  function collectCoin(e) {
    e.taken = true;
    world.coins += 1;
    sfx.ensure();
    sfx.coin();
    const p = project(LANES[e.lane], e.y, e.z - world.z);
    if (p) {
      floaters.push({ x: p.x, y: p.y, text: "+20", life: 0.7, vy: -70 });
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        particles.push({
          sx: p.x, sy: p.y,
          vx: Math.cos(ang) * (40 + Math.random() * 90),
          vy: Math.sin(ang) * (40 + Math.random() * 90),
          life: 0.35 + Math.random() * 0.25,
          max: 0.5,
          size: 2 + Math.random() * 3,
          color: "#ffd23f",
          screen: true,
        });
      }
    }
  }

  function update(dt) {
    time += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 28);

    // demo scroll on title
    const moving = state === "playing" || state === "title" || state === "dead";
    if (state === "title") {
      world.speed = 16;
      world.z += world.speed * dt;
    } else if (state === "playing") {
      world.speed = Math.min(66, 26 + world.z * 0.011);
      world.z += world.speed * dt;
      world.score = Math.floor(world.z * 2.4) + world.coins * 20;
      hudTick += dt;
      if (hudTick > 0.08) { hudTick = 0; syncHud(); }
    } else if (state === "dead") {
      world.z += world.speed * 0.25 * dt;
      world.speed *= Math.pow(0.25, dt);
      deadTimer += dt;
      if (deadTimer > 0.7 && el.gameover.classList.contains("hidden")) showGameOver();
    }

    // recycle scenery
    for (const b of buildings) {
      if (b.z - world.z < -12) {
        b.z += 48 * 7.5;
        b.h = 5 + rand(0, 12);
        b.w = 2.2 + rand(0, 2.8);
        b.color = pick(BUILDING_PAL);
        b.x = b.side * (5.8 + rand(0, 2.8));
      }
    }
    for (const p of pillars) {
      if (p.z - world.z < -10) p.z += 24 * 16;
    }
    for (const c of clouds) {
      c.x += c.v * dt * 0.01;
      if (c.x > 1.2) c.x = -1.2;
    }

    if (state === "playing") {
      while (world.spawnAt < world.z + 88) {
        placePattern(world.spawnAt);
        world.spawnAt += 15 + Math.random() * 11;
      }

      // lane lerp
      const tx = LANES[player.lane];
      const dx = tx - player.x;
      const step = 17 * dt;
      if (Math.abs(dx) <= step) player.x = tx;
      else player.x += Math.sign(dx) * step;

      if (player.jumping) {
        player.vy -= 28 * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) {
          player.y = 0;
          player.vy = 0;
          player.jumping = false;
        }
      }
      if (player.sliding > 0) {
        player.sliding -= dt;
        if (player.sliding < 0) player.sliding = 0;
      }
      player.runT += dt * (0.9 + world.speed * 0.04);

      const hb = hitbox();
      for (const e of entities) {
        const rel = e.z - world.z;
        if (e.kind === "coin") {
          if (e.taken) continue;
          e.spin += dt * 6;
          if (overlaps(hb, e.lane, rel, 0.8, e.y - 0.28, e.y + 0.28, 0.5)) collectCoin(e);
          continue;
        }
        if (e.kind === "train") {
          if (overlaps(hb, e.lane, rel, e.len, 0, e.h, 0.92)) crash();
        } else if (e.kind === "low") {
          if (overlaps(hb, e.lane, rel, e.len, 0, e.h, 0.85)) crash();
        } else if (e.kind === "high") {
          if (overlaps(hb, e.lane, rel, e.len, e.barY, e.h, 0.85)) crash();
        }
      }
    } else {
      player.runT += dt * 1.4;
      const tx = LANES[player.lane];
      player.x += (tx - player.x) * Math.min(1, 10 * dt);
    }

    // cull
    entities = entities.filter((e) => e.z - world.z > -18 && !(e.kind === "coin" && e.taken && e.z - world.z < PLAYER_Z - 2));

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.sx += p.vx * dt;
      p.sy += p.vy * dt;
      p.vy += 420 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      f.y += f.vy * dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }

  // ---------- draw ----------
  function sky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1b0a4a");
    g.addColorStop(0.22, "#6b1d8a");
    g.addColorStop(0.45, "#ff6b3d");
    g.addColorStop(0.62, "#ffb347");
    g.addColorStop(1, "#2a1038");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun
    const sx = W * 0.5, sy = H * 0.30;
    const rad = Math.min(W, H) * 0.09;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 3.2);
    sg.addColorStop(0, "rgba(255, 230, 120, 0.95)");
    sg.addColorStop(0.18, "rgba(255, 180, 60, 0.55)");
    sg.addColorStop(1, "rgba(255, 100, 40, 0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, sy, rad * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffe566";
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.fill();

    for (const c of clouds) {
      ctx.globalAlpha = c.a;
      ctx.fillStyle = "#ffd6e8";
      const cx = W * 0.5 + c.x * W * 0.55;
      const cy = H * c.y;
      blob(cx, cy, c.s);
      ctx.globalAlpha = 1;
    }
  }

  function blob(x, y, s) {
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * 0.45, 0, 0, Math.PI * 2);
    ctx.ellipse(x - s * 0.45, y + s * 0.05, s * 0.55, s * 0.38, 0, 0, Math.PI * 2);
    ctx.ellipse(x + s * 0.5, y + s * 0.08, s * 0.5, s * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHorizonSilhouette() {
    ctx.fillStyle = "#14061f";
    ctx.beginPath();
    ctx.moveTo(0, H * 0.36);
    const base = H * 0.34;
    for (let i = 0; i <= 16; i++) {
      const x = (i / 16) * W;
      const h = (Math.sin(i * 1.7 + 2) * 0.5 + 0.5) * H * 0.12 + H * 0.04;
      ctx.lineTo(x, base - h);
      ctx.lineTo(x + W / 32, base - h * 0.4);
    }
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
  }

  function drawTrack() {
    const seg = 2.8;
    const off = world.z % seg;
    const n = Math.ceil(DRAW_DIST / seg) + 2;
    for (let i = n; i >= 0; i--) {
      const z0 = i * seg - off;
      const z1 = z0 + seg;
      if (z1 < 0 && z0 < 0) continue;
      const stripe = ((i + Math.floor(world.z / seg)) & 1) === 0;

      const gravelL0 = project(-9, 0, z0), gravelL1 = project(-3.35, 0, z0);
      const gravelL2 = project(-3.35, 0, z1), gravelL3 = project(-9, 0, z1);
      const gravelR0 = project(3.35, 0, z0), gravelR1 = project(9, 0, z0);
      const gravelR2 = project(9, 0, z1), gravelR3 = project(3.35, 0, z1);
      quad(gravelL0, gravelL1, gravelL2, gravelL3, stripe ? "#3a2a4a" : "#322444");
      quad(gravelR0, gravelR1, gravelR2, gravelR3, stripe ? "#3a2a4a" : "#322444");

      const t0 = project(-3.35, 0, z0), t1 = project(3.35, 0, z0);
      const t2 = project(3.35, 0, z1), t3 = project(-3.35, 0, z1);
      quad(t0, t1, t2, t3, stripe ? "#2a2438" : "#221c30");

      // sleeper
      const s0 = project(-3.1, 0.02, z0 + 0.4);
      const s1 = project(3.1, 0.02, z0 + 0.4);
      const s2 = project(3.1, 0.02, z0 + 0.85);
      const s3 = project(-3.1, 0.02, z0 + 0.85);
      quad(s0, s1, s2, s3, "#5c3d2e");

      // lane dashes
      for (const lx of [-1.18, 1.18]) {
        const a = project(lx, 0.03, z0 + 0.3);
        const b = project(lx, 0.03, z0 + 1.5);
        if (a && b) {
          ctx.strokeStyle = "#ffd23f";
          ctx.lineWidth = Math.max(1.5, a.k * 0.012);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // rails
      for (const lx of [-2.7, -2.0, -0.35, 0.35, 2.0, 2.7]) {
        const a = project(lx, 0.04, z0);
        const b = project(lx, 0.04, z1);
        if (a && b) {
          ctx.strokeStyle = "#c0c8d4";
          ctx.lineWidth = Math.max(1, a.k * 0.014);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // side walls receding
    const wallH = 3.4;
    const zFar = DRAW_DIST;
    const zNear = 0.2;
    for (const side of [-1, 1]) {
      const x = side * 4.15;
      const a = project(x, 0, zNear);
      const b = project(x, wallH, zNear);
      const c = project(x, wallH, zFar);
      const d = project(x, 0, zFar);
      quad(a, b, c, d, side < 0 ? "#5a1e6e" : "#1e4d7a");
      // graffiti stripes
      const g1 = project(x, 1.1, zNear);
      const g2 = project(x, 1.7, zNear);
      const g3 = project(x, 1.7, zFar);
      const g4 = project(x, 1.1, zFar);
      quad(g1, g2, g3, g4, side < 0 ? "#ff4d8d" : "#3ee0ff");
    }
  }

  function drawBuildings() {
    const list = buildings.slice().sort((a, b) => (b.z - world.z) - (a.z - world.z));
    for (const b of list) {
      const z = b.z - world.z;
      if (z > DRAW_DIST || z + b.d < -2) continue;
      const pal = {
        front: b.color,
        side: shade(b.color, -35),
        top: shade(b.color, 40),
        edge: "rgba(0,0,0,0.35)",
      };
      drawBox(b.x, 0, z, b.w, b.h, b.d, pal);
      // windows
      const cols = 3, rows = Math.max(3, (b.h / 1.4) | 0);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = ((b.seed * 10 + r * 3 + c) % 1) > 0.28;
          const wx = b.x - b.w * 0.28 + c * (b.w * 0.28);
          const wy = 0.6 + r * 1.15;
          const p = project(wx, wy, z + 0.05);
          if (!p) continue;
          const s = p.k * 0.012;
          ctx.fillStyle = lit ? "#ffe566" : "rgba(10,8,20,0.55)";
          ctx.fillRect(p.x - s, p.y - s * 1.4, s * 2, s * 2.6);
        }
      }
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function drawPillars() {
    for (const p of pillars) {
      const z = p.z - world.z;
      if (z > DRAW_DIST || z < -2) continue;
      const x = p.side * 3.85;
      drawBox(x, 0, z, 0.55, 4.2, 0.55, {
        front: "#d9c48a",
        side: "#b49a62",
        top: "#f0e2b6",
        edge: "#6b5428",
      });
    }
  }

  function drawTrain(e, rel) {
    const x = LANES[e.lane];
    drawBox(x, 0, rel, e.w, e.h, e.len, e.pal);
    // stripe
    const y0 = 1.05, y1 = 1.35;
    const a = project(x - e.w * 0.5, y0, rel + 0.05);
    const b = project(x + e.w * 0.5, y0, rel + 0.05);
    const c = project(x + e.w * 0.5, y1, rel + 0.05);
    const d = project(x - e.w * 0.5, y1, rel + 0.05);
    quad(a, b, c, d, "#fff");
    // windshield
    const w1 = project(x - 0.55, 1.45, rel + 0.04);
    const w2 = project(x + 0.55, 1.45, rel + 0.04);
    const w3 = project(x + 0.55, 2.1, rel + 0.04);
    const w4 = project(x - 0.55, 2.1, rel + 0.04);
    quad(w1, w2, w3, w4, "rgba(180, 230, 255, 0.75)", "#123", 1);
    // lights
    for (const s of [-0.7, 0.7]) {
      const p = project(x + s, 0.45, rel + 0.04);
      if (!p) continue;
      ctx.fillStyle = "#ffe566";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, p.k * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLow(e, rel) {
    const x = LANES[e.lane];
    drawBox(x, 0, rel, e.w, e.h, e.len, {
      front: "#ff4d8d",
      side: "#c1126b",
      top: "#ff9ec4",
      edge: "#6a0436",
    });
    // hazard stripes on front
    const a = project(x - e.w * 0.45, 0.15, rel);
    const b = project(x + e.w * 0.45, 0.15, rel);
    const c = project(x + e.w * 0.45, 0.7, rel);
    const d = project(x - e.w * 0.45, 0.7, rel);
    quad(a, b, c, d, "#ffd23f");
  }

  function drawHigh(e, rel) {
    const x = LANES[e.lane];
    // poles
    drawBox(x - 0.75, 0, rel, 0.22, e.h, 0.22, {
      front: "#cfd6e0", side: "#8b95a3", top: "#fff", edge: "#333",
    });
    drawBox(x + 0.75, 0, rel, 0.22, e.h, 0.22, {
      front: "#cfd6e0", side: "#8b95a3", top: "#fff", edge: "#333",
    });
    // bar
    drawBox(x, e.barY, rel, e.w, e.h - e.barY, e.len, {
      front: "#3ee0ff",
      side: "#1494b3",
      top: "#b8f4ff",
      edge: "#0a4a5c",
    });
  }

  function drawCoin(e, rel) {
    if (e.taken) return;
    const x = LANES[e.lane];
    const p = project(x, e.y, rel);
    if (!p) return;
    const spin = Math.max(0.18, Math.abs(Math.cos(e.spin + time * 5)));
    const rx = p.k * 0.028 * spin;
    const ry = p.k * 0.028;
    ctx.save();
    ctx.translate(p.x, p.y);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, ry * 2.2);
    glow.addColorStop(0, "rgba(255,210,63,0.55)");
    glow.addColorStop(1, "rgba(255,210,63,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, ry * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = Math.max(1, p.k * 0.006);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff6b0";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.2, -ry * 0.25, rx * 0.35, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGrok() {
    const ground = project(player.x, 0, PLAYER_Z);
    const bodyP = project(player.x, player.y, PLAYER_Z);
    if (!ground || !bodyP) return;
    const s = bodyP.k * 0.0195;
    const sliding = player.sliding > 0;
    const jumping = player.jumping;

    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, s * 0.7 * (jumping ? 0.7 : 1), s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(bodyP.x, bodyP.y);
    ctx.scale(s, s);
    if (sliding) {
      ctx.translate(0, -0.35);
      ctx.scale(1.35, 0.52);
    }

    const bob = jumping ? 0 : Math.sin(player.runT * 10.5) * 0.08;
    ctx.translate(0, -1.05 + bob);

    // legs
    if (!sliding) {
      const sw = Math.sin(player.runT * 10.5);
      ctx.strokeStyle = "#2a1038";
      ctx.lineWidth = 0.16;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-0.12, 0.55);
      ctx.lineTo(-0.18 - sw * 0.35, 1.05);
      ctx.moveTo(0.12, 0.55);
      ctx.lineTo(0.18 + sw * 0.35, 1.05);
      ctx.stroke();
      ctx.fillStyle = "#2a1038";
      ctx.beginPath();
      ctx.ellipse(-0.18 - sw * 0.35, 1.08, 0.2, 0.09, 0, 0, Math.PI * 2);
      ctx.ellipse(0.18 + sw * 0.35, 1.08, 0.2, 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // arms
    const arm = jumping ? -0.7 : sliding ? 0.4 : Math.sin(player.runT * 10.5) * 0.5;
    ctx.strokeStyle = "#e85d04";
    ctx.lineWidth = 0.13;
    ctx.beginPath();
    ctx.moveTo(-0.48, -0.15);
    ctx.lineTo(-0.75, 0.15 + arm * 0.35);
    ctx.moveTo(0.48, -0.15);
    ctx.lineTo(0.75, 0.15 - arm * 0.35);
    ctx.stroke();

    // body
    ctx.fillStyle = "#ff8c42";
    roundRect(-0.55, -0.55, 1.1, 1.15, 0.42);
    ctx.fill();
    ctx.fillStyle = "#ffd166";
    roundRect(-0.32, -0.15, 0.64, 0.62, 0.28);
    ctx.fill();

    // head
    ctx.fillStyle = "#ff8c42";
    ctx.beginPath();
    ctx.arc(0, -0.95, 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffb347";
    ctx.beginPath();
    ctx.arc(0, -1.0, 0.48, 0, Math.PI * 2);
    ctx.fill();

    // tuft
    ctx.fillStyle = "#2a1038";
    ctx.beginPath();
    ctx.moveTo(-0.08, -1.48);
    ctx.quadraticCurveTo(0.05, -1.85, 0.28, -1.55);
    ctx.quadraticCurveTo(0.08, -1.62, -0.08, -1.48);
    ctx.fill();

    // ears
    ctx.fillStyle = "#ff8c42";
    ctx.beginPath();
    ctx.ellipse(-0.5, -1.28, 0.16, 0.22, -0.4, 0, Math.PI * 2);
    ctx.ellipse(0.5, -1.28, 0.16, 0.22, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(-0.22, -0.98, 0.16, 0.2, 0, 0, Math.PI * 2);
    ctx.ellipse(0.22, -0.98, 0.16, 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1020";
    const look = Math.max(-0.04, Math.min(0.04, (player.x) * 0.02));
    ctx.beginPath();
    ctx.arc(-0.18 + look, -0.96, 0.08, 0, Math.PI * 2);
    ctx.arc(0.26 + look, -0.96, 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-0.14, -1.02, 0.03, 0, Math.PI * 2);
    ctx.arc(0.3, -1.02, 0.03, 0, Math.PI * 2);
    ctx.fill();

    // smile or crash
    ctx.strokeStyle = "#1a1020";
    ctx.lineWidth = 0.07;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (!player.alive) {
      ctx.moveTo(-0.18, -0.68); ctx.lineTo(0.18, -0.78);
      ctx.moveTo(-0.18, -0.78); ctx.lineTo(0.18, -0.68);
    } else if (jumping) {
      ctx.arc(0, -0.72, 0.16, 0.15, Math.PI - 0.15);
    } else {
      ctx.arc(0, -0.74, 0.18, 0.2, Math.PI - 0.2);
    }
    ctx.stroke();

    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawSpeedLines() {
    if (state !== "playing" || world.speed < 40) return;
    const n = ((world.speed - 38) / 4) | 0;
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    for (let i = 0; i < n; i++) {
      const x = ((i * 97 + world.z * 40) % W);
      const y = (i * 73) % (H * 0.7) + H * 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 18 + world.speed * 0.3);
      ctx.stroke();
    }
  }

  function drawEntities() {
    const list = entities.slice().sort((a, b) => (b.z - a.z));
    for (const e of list) {
      const rel = e.z - world.z;
      if (rel > DRAW_DIST + 6 || rel + (e.len || 1) < -2) continue;
      if (e.kind === "train") drawTrain(e, rel);
      else if (e.kind === "low") drawLow(e, rel);
      else if (e.kind === "high") drawHigh(e, rel);
      else if (e.kind === "coin") drawCoin(e, rel);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / (p.max || 0.6));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 20px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    for (const f of floaters) {
      ctx.globalAlpha = Math.max(0, f.life / 0.7);
      ctx.fillStyle = "#ffd23f";
      ctx.strokeStyle = "#2a1038";
      ctx.lineWidth = 4;
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    sky();
    drawHorizonSilhouette();
    drawBuildings();
    drawTrack();
    drawPillars();
    drawEntities();
    drawGrok();
    drawSpeedLines();
    drawParticles();

    if (state === "dead") {
      ctx.fillStyle = "rgba(80, 0, 30, " + Math.min(0.35, deadTimer * 0.4) + ")";
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();
  }

  // ---------- loop ----------
  resetGame(false);

  function frame(t) {
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
