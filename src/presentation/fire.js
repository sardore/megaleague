/* Particle fire for the undead visuals.

   One engine, two users: the startup intro (a wall of fire behind the graveyard) and the persistent
   undead aura on cards in battle. Flames are real particles: they are born on a base line, travel
   upward only, sway sideways, cool from white-hot through green/violet to nothing and are drawn with
   additive blending. Nothing here ever scales a flame back down, so a fire can only grow or hold. */

const RAMPS = {
  violet: [[196, 128, 255], [168, 86, 250], [132, 50, 224], [92, 24, 176], [40, 8, 96]],
  green: [[168, 246, 124], [112, 226, 84], [62, 186, 58], [30, 124, 44], [10, 56, 28]]
};
const STEPS = 28;
let sprites = null;

function rampColor(ramp, t) {
  const f = Math.min(0.9999, t) * (ramp.length - 1);
  const i = Math.floor(f), k = f - i;
  return ramp[i].map((v, j) => Math.round(v + (ramp[i + 1][j] - v) * k));
}

function buildSprites() {
  if (sprites) return sprites;
  sprites = {};
  const tongue = new Path2D('M32 94C10 94 4 66 20 42C27 31 30 18 32 2C34 18 37 31 44 42C60 66 54 94 32 94Z');
  for (const [name, ramp] of Object.entries(RAMPS)) {
    sprites[name] = [];
    for (let s = 0; s < STEPS; s++) {
      const [r, g, b] = rampColor(ramp, s / (STEPS - 1));
      const c = document.createElement('canvas');
      c.width = 64; c.height = 96;
      const x = c.getContext('2d');
      /* a flame tongue: pointed tip, hottest at the root, soft edges */
      x.filter = 'blur(1.6px)';
      const grad = x.createRadialGradient(32, 84, 2, 32, 72, 56);
      grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
      grad.addColorStop(0.55, `rgba(${r},${g},${b},.55)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},.08)`);
      x.fillStyle = grad;
      x.fill(tongue);
      sprites[name].push(c);
    }
  }
  return sprites;
}

/* emitters(clock) -> [{x0, x1, y, power, rise, size, rate, life}] in CSS pixels, y is the base line. */
export function createFire(canvas, { emitters, resolution = 0.6, maxParticles = 2200, onFrame = null, alive = () => true }) {
  const ctx = canvas.getContext('2d');
  const pool = [];
  const carry = new WeakMap();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, last = 0, clock = 0, w = 0, h = 0, running = false;

  function fit() {
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    if (cw === w && ch === h) return;
    w = cw; h = ch;
    canvas.width = Math.max(2, Math.round(w * resolution));
    canvas.height = Math.max(2, Math.round(h * resolution));
  }

  function spawn(e, dt) {
    const key = e.key || e;
    const want = (carry.get(key) || 0) + e.rate * e.power * dt * (reduce ? 0.4 : 1);
    let n = Math.floor(want);
    carry.set(key, want - n);
    while (n-- > 0 && pool.length < maxParticles) {
      const life = e.life * (0.75 + Math.random() * 0.6);
      const mid = (e.x0 + e.x1) / 2, half = Math.max(1, (e.x1 - e.x0) / 2);
      /* a little denser toward the middle so each emitter reads as one body of fire */
      const x = mid + (Math.random() * 2 - 1) * half;
      pool.push({
        x, y: e.y + Math.random() * 4,
        vy: -(e.rise * (0.8 + Math.random() * 0.45)) / life,
        sway: (6 + Math.random() * 16) * (e.size / 40),
        sf: 2.2 + Math.random() * 3.2,
        ph: Math.random() * 6.283,
        drift: (Math.random() - 0.5) * 10,
        age: 0, life,
        size: e.size * (0.7 + Math.random() * 0.7),
        hue: Math.random() < 0.46 ? 'green' : 'violet',
        spark: Math.random() < 0.05,
        k: (e.alpha ?? 1) / Math.max(1, e.power * 1.1)
      });
    }
  }

  function frame(now) {
    raf = 0;
    if (!running) return;
    if (!alive()) { stop(); return; }
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    clock += dt;
    fit();
    const list = emitters(clock) || [];
    for (const e of list) spawn(e, dt);

    const s = buildSprites();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    if (onFrame) onFrame(ctx, clock, list);
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i];
      p.age += dt;
      if (p.age >= p.life) { pool[i] = pool[pool.length - 1]; pool.pop(); continue; }
      const t = p.age / p.life;
      p.y += p.vy * dt * (1 - 0.3 * t);
      p.x += (p.drift + Math.sin(p.age * p.sf + p.ph) * p.sway * (0.3 + t)) * dt;
      const fade = (t < 0.22 ? t / 0.22 : 1) * Math.pow(1 - t, 1.25);
      const wd = p.size * (1.15 - 0.8 * t) * (p.spark ? 0.28 : 1);
      const ht = wd * (p.spark ? 1.4 : 2.1);
      ctx.globalAlpha = Math.min(1, fade * (p.spark ? 1.4 : 0.27 * p.k));
      ctx.drawImage(s[p.hue][Math.min(STEPS - 1, Math.floor((p.spark ? t * 0.45 : t) * STEPS))], p.x - wd / 2, p.y - ht, wd, ht);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  return { start, stop, get count() { return pool.length; } };
}

const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/* Startup intro: a wall of fire along the horizon that only ever builds, with a surge when the stone goes under. */
export function startIntroFire(intro, canvas) {
  const T = 4.8;
  const fire = createFire(canvas, {
    resolution: 0.8,
    alive: () => intro.isConnected,
    emitters(clock) {
      const vw = innerWidth, vh = innerHeight;
      const gl = Math.min(vh * 0.22, 190);
      const grow = smooth(clock / (T * 0.62));
      const surge = smooth((clock - T * 0.62) / 0.35) * (1 - smooth((clock - T * 0.62 - 0.9) / 1.4)) * 0.7;
      const power = 0.55 + 0.45 * grow + surge * 0.55;
      const size = Math.min(Math.max(vw * 0.15, 62), 104) * (0.85 + 0.55 * grow);
      const rise = vh * (0.34 + 0.26 * grow + surge * 0.3);
      const y = vh - gl + 18;
      return [{ key: canvas, x0: -vw * 0.05, x1: vw * 1.05, y, power, rise, size, rate: Math.min(420, vw * 0.7), life: 1.25 }];
    },
    onFrame(ctx, clock, list) {
      const e = list[0];
      if (!e) return;
      const g = ctx.createLinearGradient(0, e.y, 0, e.y - e.rise * 0.9);
      g.addColorStop(0, `rgba(130,50,230,${0.22 * Math.min(1.3, e.power)})`);
      g.addColorStop(1, 'rgba(150,70,255,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(0, e.y - e.rise * 0.9, innerWidth, e.rise * 0.9 + 20);
    }
  });
  fire.start();
  return fire;
}

/* Battle: every .undead-aura element on a card gets a fire along its bottom edge. One shared loop, so cards can be
   re-rendered at will without the flames restarting. */
export function startUndeadAuraField() {
  if (typeof document === 'undefined' || document.getElementById('undeadFireField')) return null;
  const canvas = document.createElement('canvas');
  canvas.id = 'undeadFireField';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const fire = createFire(canvas, {
    resolution: 0.8,
    maxParticles: 1800,
    emitters(clock) {
      const out = [];
      for (const el of document.querySelectorAll('.undead-aura')) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.bottom < 0 || r.top > innerHeight) continue;
        const fading = el.classList.contains('fading');
        const gutter = fading ? 0.35 + 0.3 * Math.abs(Math.sin(clock * 5.3 + r.left)) : 1;
        const base = r.width;
        /* Status read, not spectacle: a few small spirit flames drift up off the card's lower edge,
           so the unit art, HP bar and badges stay fully legible. */
        out.push({
          key: el,
          x0: r.left + r.width * 0.12, x1: r.right - r.width * 0.12,
          y: r.bottom - 16,
          power: gutter,
          alpha: 2.2,
          rise: Math.min(r.height * 0.34, 46),
          size: 10,
          rate: 9 + r.width * 0.07,
          life: 1.9
        });
      }
      return out;
    }
  });
  fire.start();
  return fire;
}
