// DEK-610 visualizer: a piano along the bottom whose notes rise up their lanes like a reversed
// rhythm-game highway, over a rotating set of late-90s style music visualizer backgrounds.
// Input comes from Web MIDI (Chrome/Edge), the computer keyboard, or the built-in demo.
'use strict';

// ---- Config ---------------------------------------------------------------------------------
const KEY_LOW = 36, KEY_HIGH = 96;   // 61 keys, C2..C7, until the keyboard size is known
// Usual note range of each standard keyboard size (lowest, highest MIDI note).
const KEYBOARD_SIZES = { 25: [48, 72], 32: [53, 84], 37: [48, 84], 49: [36, 84], 61: [36, 96], 76: [28, 103], 88: [21, 108] };
// Keyboards whose MIDI name doesn't include their size.
const KNOWN_KEYBOARDS = [
  [/^USB DEVIC/i, 61, 'Donner DEK-610'],
  [/MPK ?mini/i, 25, 'Akai MPK Mini'],
  [/Launchkey Mini/i, 25, 'Launchkey Mini'],
  [/KeyStep(?! ?37)/i, 32, 'Arturia KeyStep'],
  [/LPK25/i, 25, 'Akai LPK25'],
];
const RISE_SPEED = 170;              // px/s the note trails travel upward
const MODE_SECONDS = 45;             // background auto-cycle interval
const BG_SCALE = 0.5;                // background renders at half resolution, then upscales
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_KEYS = "awsedftgyhujkolp;'";  // computer-keyboard piano, starting at C
const params = new URLSearchParams(location.search);

const clock = () => performance.now() / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (a, b) => a + Math.random() * (b - a);
const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
const noteHue = n => (n % 12) * 30;
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- State ----------------------------------------------------------------------------------
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
const kb = { low: KEY_LOW, high: KEY_HIGH, top: 0, height: 0, whiteW: 0, keys: new Map() };
const held = new Map();     // note -> its active (still growing) trail
const trails = [];
const particles = [];
const voices = new Map();   // note -> { env, on }: a pretend synth envelope that drives the visuals
const sustained = new Set();
let sustain = false;
let lastNoteAt = -1e9;
let autoCycle = !params.has('mode');

// ---- Audio analysis -------------------------------------------------------------------------
// When the browser synth is playing, the visualizers read its real spectrum and waveform.
// In keyboard-only mode the keyboard makes the sound, so they get a pretend spectrum and
// waveform computed from the notes being held.
const BINS = 64, SPEC_LOW = 28, SPEC_SPAN = 84;
const au = { energy: 0, spectrum: new Float32Array(BINS), wave: new Float32Array(256) };
const specTarget = new Float32Array(BINS);
const fftData = new Float32Array(2048), scopeData = new Float32Array(4096);

function readAnalyser(dt) {
  const an = synth.analyser;
  an.getFloatFrequencyData(fftData);
  const hzPerBin = synth.ctx.sampleRate / an.fftSize;
  for (let b = 0; b < BINS; b++) {
    const lo = SPEC_LOW + b * SPEC_SPAN / BINS;
    const i0 = Math.floor(440 * 2 ** ((lo - 69) / 12) / hzPerBin);
    const i1 = Math.max(i0, Math.ceil(440 * 2 ** ((lo + SPEC_SPAN / BINS - 69) / 12) / hzPerBin));
    let m = -Infinity;
    for (let i = i0; i <= Math.min(i1, fftData.length - 1); i++) m = Math.max(m, fftData[i]);
    au.spectrum[b] = Math.max(clamp((m + 95) / 65, 0, 1), au.spectrum[b] * Math.exp(-dt * 5));
  }
  an.getFloatTimeDomainData(scopeData);
  let start = 0;  // trigger on a rising zero crossing so the scope holds still
  for (let i = 1; i < 1024; i++) if (scopeData[i - 1] < 0 && scopeData[i] >= 0) { start = i; break; }
  for (let i = 0; i < au.wave.length; i++) au.wave[i] = clamp(scopeData[start + i * 4] * 2.5, -1.2, 1.2);
}

function updateAudio(now, dt) {
  let total = 0;
  for (const [n, v] of voices) {
    if (v.on) v.env += (1 - v.env) * Math.min(1, dt * 25);
    else {
      v.env *= Math.exp(-dt * 2.2);
      if (v.env < 0.01) voices.delete(n);
    }
    total += v.env;
  }
  au.energy += (clamp(total / 3, 0, 1) - au.energy) * Math.min(1, dt * 6);
  if (synth.audible) { readAnalyser(dt); return; }

  specTarget.fill(0);
  for (const [n, v] of voices) {
    for (let k = 1; k <= 6; k++) {  // fundamental plus harmonics
      const pos = (n + 12 * Math.log2(k) - SPEC_LOW) / SPEC_SPAN * BINS;
      const amp = v.env / k;
      for (let b = Math.max(0, Math.floor(pos - 3)); b <= Math.min(BINS - 1, Math.ceil(pos + 3)); b++) {
        specTarget[b] += amp * Math.exp(-((b - pos) ** 2) / 2);
      }
    }
  }
  const specGain = 1 / Math.max(1, Math.sqrt(voices.size) / 1.5);  // big chords shouldn't peg every bar
  for (let b = 0; b < BINS; b++) {
    const t = specTarget[b] * specGain * rand(0.75, 1.1) + 0.03 + 0.02 * Math.sin(now * 3 + b * 0.5);
    au.spectrum[b] = Math.max(t, au.spectrum[b] * Math.exp(-dt * 5));
  }

  const N = au.wave.length;
  const norm = Math.max(1, Math.sqrt(voices.size));
  for (let i = 0; i < N; i++) {
    const x = i / N;
    let s = 0.08 * Math.sin(x * Math.PI * 4 + now * 1.5);
    for (const [n, v] of voices) {
      const f = 440 * 2 ** ((n - 69) / 12);
      s += v.env * Math.sin(2 * Math.PI * (f / 220) * x * 3 + now * (f / 110));
    }
    au.wave[i] = clamp(s / norm, -1.2, 1.2);
  }
}

// ---- Background visualizers -----------------------------------------------------------------
// Each mode renders into its own canvas and returns it from draw(); bg composites and crossfades.

// MilkDrop-style feedback: last frame is redrawn zoomed, rotated and hue-shifted, then a fresh
// waveform is drawn on top, so everything smears into a swirling tunnel.
class Swirl {
  name = 'MILKSWIRL';
  resize(w, h) { this.w = w; this.h = h; this.a = makeCanvas(w, h); this.b = makeCanvas(w, h); this.activate(); }
  activate() {  // new random preset each time the mode comes around
    this.spin = rand(0.003, 0.012) * (Math.random() < 0.5 ? -1 : 1);
    this.zoom = rand(1.008, 1.03);
    this.shape = Math.floor(rand(0, 3));
    this.hueSpeed = rand(1, 5);
    this.bursts = [];
  }
  onNote(n) {
    this.bursts.push({ x: kb.keys.get(n).cx / W * this.w, y: this.h * rand(0.3, 0.7), r: 2, life: 1, hue: noteHue(n) });
  }
  draw(now, dt) {
    const { w, h } = this;
    const c = this.a.getContext('2d');
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    c.save();
    c.translate(w / 2 + Math.sin(now * 0.4) * w * 0.01, h / 2 + Math.cos(now * 0.33) * h * 0.01);
    c.rotate(this.spin * (1 + au.energy * 2));
    const s = this.zoom + au.energy * 0.02;
    c.scale(s, s);
    c.translate(-w / 2, -h / 2);
    c.globalAlpha = 0.94;
    c.filter = `hue-rotate(${this.hueSpeed}deg)`;
    c.drawImage(this.b, 0, 0);
    c.restore();
    c.filter = 'none';

    c.globalCompositeOperation = 'lighter';
    c.lineWidth = 1.5 + au.energy * 2;
    c.strokeStyle = `hsla(${(now * 20) % 360},100%,60%,${0.35 + 0.6 * au.energy})`;
    c.beginPath();
    const N = au.wave.length, R = Math.min(w, h) * 0.22;
    for (let i = 0; i <= N; i++) {
      const v = au.wave[i % N];
      let x, y;
      if (this.shape === 0) {        // pulsing ring
        const a = i / N * Math.PI * 2 + now * 0.3;
        x = w / 2 + Math.cos(a) * R * (0.6 + 0.25 * v);
        y = h / 2 + Math.sin(a) * R * (0.6 + 0.25 * v);
      } else if (this.shape === 1) { // oscilloscope line
        x = i / N * w;
        y = h / 2 + v * h * 0.18;
      } else {                       // lissajous
        x = w / 2 + v * R * 1.2;
        y = h / 2 + au.wave[(i + N / 4) % N] * R * 1.2;
      }
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();

    c.lineWidth = 2;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.r += dt * w * 0.25;
      b.life -= dt * 0.9;
      if (b.life <= 0) { this.bursts.splice(i, 1); continue; }
      c.strokeStyle = `hsla(${b.hue},100%,60%,${b.life})`;
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.stroke();
    }
    [this.a, this.b] = [this.b, this.a];
    return this.b;
  }
}

// Classic demoscene plasma with a cycling palette; each note sends a ripple out from its key.
class Plasma {
  name = 'PLASMA';
  resize(w, h) {
    this.pw = 160;
    this.ph = Math.max(1, Math.round(160 * h / w));
    this.small = makeCanvas(this.pw, this.ph);
    this.img = this.small.getContext('2d').createImageData(this.pw, this.ph);
    this.pal = new Uint8Array(256 * 3);
    this.ripples = [];
  }
  onNote(n) {
    this.ripples.push({ x: kb.keys.get(n).cx / W * this.pw, y: this.ph * 0.95, t0: clock() });
    if (this.ripples.length > 12) this.ripples.shift();
  }
  draw(now) {
    const { pw, ph, pal } = this;
    const bright = 0.35 + 0.65 * clamp(au.energy, 0, 1);
    for (let i = 0; i < 256; i++) {
      const a = i / 256 * Math.PI * 2;
      pal[i * 3] = (128 + 127 * Math.sin(a + now * 0.7)) * bright;
      pal[i * 3 + 1] = (128 + 127 * Math.sin(a * 2 + now * 0.5 + 2)) * bright;
      pal[i * 3 + 2] = (128 + 127 * Math.sin(a * 3 + now * 0.3 + 4)) * bright;
    }
    this.ripples = this.ripples.filter(r => now - r.t0 < 5);
    const cx = pw / 2 + Math.sin(now * 0.3) * pw * 0.3, cy = ph / 2 + Math.cos(now * 0.23) * ph * 0.3;
    const d = this.img.data;
    for (let y = 0, p = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++, p += 4) {
        let v = Math.sin(x * 0.07 + now) + Math.sin(y * 0.09 - now * 0.8)
              + Math.sin((x + y) * 0.05 + now * 0.6) + Math.sin(Math.hypot(x - cx, y - cy) * 0.12 - now * 1.3);
        for (const r of this.ripples) {
          const age = now - r.t0, dist = Math.hypot(x - r.x, y - r.y);
          v += 1.5 * Math.sin(dist * 0.35 - age * 8) * Math.exp(-age * 0.7 - dist * 0.02);
        }
        const idx = ((Math.floor(v * 40 + now * 30) % 256) + 256) % 256;
        d[p] = pal[idx * 3]; d[p + 1] = pal[idx * 3 + 1]; d[p + 2] = pal[idx * 3 + 2]; d[p + 3] = 255;
      }
    }
    this.small.getContext('2d').putImageData(this.img, 0, 0);
    return this.small;
  }
}

// Screensaver-style warp starfield; playing speeds it up and tints it with the note's color.
class Warp {
  name = 'STARFIELD';
  resize(w, h) {
    this.w = w; this.h = h;
    this.cv = makeCanvas(w, h);
    this.stars = Array.from({ length: 500 }, () => this.spawn(true));
    this.boost = 0;
    this.hue = 200;
  }
  spawn(anyDepth) { return { x: rand(-1, 1), y: rand(-1, 1), z: anyDepth ? rand(0.05, 1) : 1 }; }
  onNote(n) { this.boost = Math.min(3, this.boost + 0.6); this.hue = noteHue(n); }
  draw(now, dt) {
    const { w, h } = this;
    const c = this.cv.getContext('2d');
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(0,0,0,0.3)';  // partial clear leaves motion streaks
    c.fillRect(0, 0, w, h);
    this.boost *= Math.exp(-dt * 1.5);
    const speed = (0.15 + au.energy * 0.6 + this.boost) * dt;
    const cx = w / 2 + Math.sin(now * 0.2) * w * 0.05, cy = h / 2 + Math.cos(now * 0.27) * h * 0.05;
    const f = Math.min(w, h) * 0.5;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const px = cx + s.x / s.z * f, py = cy + s.y / s.z * f;
      s.z -= speed;
      const nx = cx + s.x / Math.max(s.z, 0.01) * f, ny = cy + s.y / Math.max(s.z, 0.01) * f;
      if (s.z <= 0.02 || nx < 0 || nx > w || ny < 0 || ny > h) { this.stars[i] = this.spawn(false); continue; }
      const b = clamp(1 - s.z, 0, 1);
      c.strokeStyle = `hsla(${this.hue + s.x * 60},${40 + 60 * au.energy}%,${50 + 40 * b}%,${b})`;
      c.lineWidth = 0.5 + 2 * b;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(nx, ny);
      c.stroke();
    }
    return this.cv;
  }
}

// Winamp-style segmented spectrum bars with falling peak caps, a reflection, and a scope line.
class Bars {
  name = 'SPECTRUM';
  resize(w, h) {
    this.w = w; this.h = h;
    this.cv = makeCanvas(w, h);
    this.peaks = new Float32Array(BINS);
    this.peakVel = new Float32Array(BINS);
    const c = this.cv.getContext('2d');
    this.base = h * 0.55;
    this.grad = c.createLinearGradient(0, this.base, 0, this.base - h * 0.5);
    this.grad.addColorStop(0, '#1fd51f');
    this.grad.addColorStop(0.55, '#e8e81a');
    this.grad.addColorStop(1, '#ff2a1a');
  }
  draw(now, dt) {
    const { w, h, base } = this;
    const c = this.cv.getContext('2d');
    c.globalAlpha = 1;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, w, h);
    const bw = w / BINS;
    c.fillStyle = this.grad;
    for (let i = 0; i < BINS; i++) {
      const bh = clamp(au.spectrum[i], 0, 1) * h * 0.5;
      if (bh >= this.peaks[i]) { this.peaks[i] = bh; this.peakVel[i] = 0; }
      else { this.peakVel[i] += h * 0.6 * dt; this.peaks[i] = Math.max(0, this.peaks[i] - this.peakVel[i] * dt); }
      c.globalAlpha = 0.85;
      c.fillRect(i * bw + 1, base - bh, bw - 2, bh);
      c.globalAlpha = 0.22;
      c.fillRect(i * bw + 1, base + 2, bw - 2, bh * 0.6);
    }
    c.globalAlpha = 0.5;  // LED segment gaps
    c.fillStyle = '#000';
    for (let y = base; y > base - h * 0.5; y -= 4) c.fillRect(0, y, w, 1);
    c.globalAlpha = 0.9;
    c.fillStyle = '#ddd';
    for (let i = 0; i < BINS; i++) c.fillRect(i * bw + 1, base - this.peaks[i] - 3, bw - 2, 2);

    c.globalAlpha = 0.8;
    c.strokeStyle = '#3f3';
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < au.wave.length; i++) {
      const x = i / (au.wave.length - 1) * w, y = h * 0.82 + au.wave[i] * h * 0.06;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.globalAlpha = 1;
    return this.cv;
  }
}

const bg = {
  modes: [new Swirl(), new Plasma(), new Warp(), new Bars()],
  index: 0, since: 0, fade: 0, w: 1, h: 1,
  canvas: makeCanvas(1, 1),
  prev: makeCanvas(1, 1),  // snapshot of the outgoing mode, for crossfading
  resize(w, h) {
    this.w = w; this.h = h;
    for (const c of [this.canvas, this.prev]) { c.width = w; c.height = h; }
    this.modes.forEach(m => m.resize(w, h));
  },
  setMode(i) {
    this.prev.getContext('2d').drawImage(this.canvas, 0, 0);
    this.fade = 1;
    this.index = i;
    this.modes[i].activate?.();
    this.since = clock();
    updateStatus();
  },
  onNote(n) { this.modes[this.index].onNote?.(n); },
  draw(now, dt) {
    const c = this.canvas.getContext('2d');
    c.globalAlpha = 1;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.modes[this.index].draw(now, dt), 0, 0, this.w, this.h);
    if (this.fade > 0) {
      c.globalAlpha = this.fade;
      c.drawImage(this.prev, 0, 0);
      c.globalAlpha = 1;
      this.fade -= dt / 1.5;
    }
  },
};

// ---- Layout ---------------------------------------------------------------------------------
function layoutKeys() {
  let whites = 0;
  for (let n = kb.low; n <= kb.high; n++) if (!isBlack(n)) whites++;
  kb.whiteW = W / whites;
  kb.height = Math.min(H * 0.2, kb.whiteW * 5.5);
  kb.top = H - kb.height;
  kb.keys.clear();
  let wi = 0;
  for (let n = kb.low; n <= kb.high; n++) {
    if (isBlack(n)) {
      const w = kb.whiteW * 0.6;
      kb.keys.set(n, { x: wi * kb.whiteW - w / 2, w, h: kb.height * 0.62, black: true, cx: wi * kb.whiteW });
    } else {
      kb.keys.set(n, { x: wi * kb.whiteW, w: kb.whiteW, h: kb.height, black: false, cx: (wi + 0.5) * kb.whiteW });
      wi++;
    }
  }
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layoutKeys();
  bg.resize(Math.max(1, Math.round(W * BG_SCALE)), Math.max(1, Math.round(H * BG_SCALE)));
}

// A note outside the drawn keys: a known-size keyboard was shifted with its octave buttons, so the
// view follows it; otherwise (size unknown) the drawn keyboard grows to include it.
function widenRange(n) {
  if (kb.fixed) {
    while (n < kb.low && kb.low - 12 >= 0) { kb.low -= 12; kb.high -= 12; }
    while (n > kb.high && kb.high + 12 <= 127) { kb.low += 12; kb.high += 12; }
  } else {
    if (n < kb.low) kb.low = n - (n % 12);                // down to that octave's C
    if (n > kb.high) kb.high = n + (12 - (n % 12)) % 12;  // up to the next C
  }
  layoutKeys();
}

// ---- Keyboard size ----------------------------------------------------------------------------
// 'auto' uses the size detected from the keyboard's name (or grows to fit what's played);
// otherwise the user's choice from the Keys menu.
let keysSetting = localStorage.getItem('dkb-keys') || 'auto';
let detected = null;  // { size, name } from the connected keyboard

function detectKeyboard(names) {
  for (const name of names) {
    const known = KNOWN_KEYBOARDS.find(([re]) => re.test(name));
    if (known) return { size: known[1], name: known[2] };
    const m = /(?:^|\D)(25|32|37|49|61|76|88)(?:\D|$)/.exec(name);
    if (m) return { size: Number(m[1]), name };
  }
  return null;
}

function applyKeyboardSize() {
  const size = keysSetting === 'auto' ? detected?.size : Number(keysSetting);
  [kb.low, kb.high] = KEYBOARD_SIZES[size] ?? [KEY_LOW, KEY_HIGH];
  kb.fixed = !!size;
  layoutKeys();
  updateStatus();
}

function keysLabel() {
  if (keysSetting !== 'auto') return `${keysSetting} keys (chosen)`;
  return detected ? `${detected.size} keys (${detected.name})` : 'auto (grows as you play)';
}

// Makes a lesson playable: on a known-size keyboard, move the view by octaves to cover its notes,
// or if it needs more keys than there are, move the stray notes into range by octaves.
function fitRange(notes) {
  if (!notes.length) return notes;
  const lo = Math.min(...notes.map(nt => nt.n)), hi = Math.max(...notes.map(nt => nt.n));
  if (!kb.fixed) {
    if (lo < kb.low) widenRange(lo);
    if (hi > kb.high) widenRange(hi);
    return notes;
  }
  for (const shift of [0, -12, 12, -24, 24, -36, 36]) {
    if (lo >= kb.low + shift && hi <= kb.high + shift && kb.low + shift >= 0 && kb.high + shift <= 127) {
      kb.low += shift; kb.high += shift;
      layoutKeys();
      return notes;
    }
  }
  const seen = new Set();
  return notes.filter(nt => {
    while (nt.n < kb.low) nt.n += 12;
    while (nt.n > kb.high) nt.n -= 12;
    const key = `${nt.n}@${nt.t}`;  // folding can stack two notes on one key, which can't both be pressed
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openKeysMenu() {
  const list = document.getElementById('keys-list');
  list.replaceChildren();
  for (const value of ['auto', ...Object.keys(KEYBOARD_SIZES)]) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (value === keysSetting ? ' sel' : '');
    btn.textContent = value === 'auto' ? `Auto${detected ? ` (${detected.size})` : ''}` : value;
    btn.onclick = () => {
      keysSetting = value;
      localStorage.setItem('dkb-keys', value);
      applyKeyboardSize();
      document.getElementById('keys-menu').classList.remove('show');
    };
    list.append(btn);
  }
  document.getElementById('keys-menu').classList.add('show');
}

// ---- Notes ----------------------------------------------------------------------------------
function noteOn(n, vel = 127) {
  if (n < kb.low || n > kb.high) widenRange(n);
  if (songs.rec) songs.recordOn(n);
  synth.noteOn(n, vel / 127);
  const now = clock();
  if (held.has(n)) held.get(n).end = now;  // retrigger: close the old trail
  const trail = { note: n, start: now, end: null };
  if (tutor.active) tutor.onPress(n);  // lessons draw falling notes instead of rising trails
  else trails.push(trail);
  held.set(n, trail);
  sustained.delete(n);
  voices.set(n, { env: voices.get(n)?.env ?? 0, on: true });
  lastNoteAt = now;
  burst(n);
  bg.onNote(n);
  updateChord();
}

function noteOff(n) {
  if (songs.rec) songs.recordOff(n);
  const trail = held.get(n);
  if (!trail) return;
  trail.end = clock();
  held.delete(n);
  if (sustain) sustained.add(n); else releaseVoice(n);
  updateChord();
}

function releaseVoice(n) {
  const v = voices.get(n);
  if (v) v.on = false;
  synth.noteOff(n);
}

function setSustain(on) {
  sustain = on;
  if (!on) { sustained.forEach(releaseVoice); sustained.clear(); }
}

// Notes from the computer keyboard or demo go out to the keyboard when the browser isn't
// making the sound itself.
function playNote(n) {
  noteOn(n, 96);
  if (!synth.audible) sendOut([0x90, n, 96]);
}
function stopNote(n) { noteOff(n); sendOut([0x80, n, 0]); }

// ---- MIDI -----------------------------------------------------------------------------------
let midiOut = null;

const sentAt = new Map();  // note -> when we last sent it to the keyboard

function sendOut(bytes) {
  if (!midiOut) return;
  if ((bytes[0] & 0xe0) === 0x80) sentAt.set(bytes[1], performance.now());  // note on/off
  try { midiOut.send(bytes); } catch { /* port busy (e.g. a PowerShell script has it) - visuals still work */ }
}

// Stops every sounding note: on screen, in the synth, and on the keyboard. Esc, and stopping the demo.
function releaseAll() {
  setSustain(false);
  [...held.keys()].forEach(stopNote);
  synth.allOff();
  sendOut([0xb0, 123, 0]);  // all notes off
}

function handleMidi(e) {
  const [st, d1, d2] = e.data;
  const type = st & 0xf0;
  // A keyboard with MIDI thru echoes notes we send it; taking those as key presses would
  // double-trigger them and leave notes hanging.
  if ((type === 0x80 || type === 0x90) && performance.now() - (sentAt.get(d1) ?? -1e9) < 120) return;
  if (synth.needsGesture) synth.start().then(updateStatus);  // works where autoplay is allowed (the app launcher)
  if (type === 0x90 && d2 > 0) noteOn(d1, d2);
  else if (type === 0x80 || type === 0x90) noteOff(d1);
  else if (type === 0xb0 && d1 === 64) setSustain(d2 >= 64);
  else if (type === 0xb0 && (d1 === 120 || d1 === 123)) [...held.keys()].forEach(noteOff);
}

async function initMidi() {
  const status = document.getElementById('midi-status');
  if (!navigator.requestMIDIAccess) {
    status.textContent = 'no Web MIDI - use Chrome or Edge';
    status.className = 'warn';
    return;
  }
  try {
    const access = await navigator.requestMIDIAccess();
    const refresh = () => {
      // Linux always lists ALSA's virtual "Midi Through" port; it isn't a keyboard, and sending notes
      // to it instead of the real keyboard means they never get played.
      const real = port => port.state === 'connected' && !/^Midi Through/i.test(port.name);
      const inputs = [...access.inputs.values()].filter(real);
      inputs.forEach(i => { i.onmidimessage = handleMidi; });
      const names = inputs.map(i => i.name);
      // the keyboard's output port has the same name as its input ('USB DEVIC' on Windows)
      midiOut = [...access.outputs.values()].find(o => real(o) && names.includes(o.name)) || null;
      status.textContent = names.length ? names.join(', ') + (midiOut ? ' (in+out)' : '') : 'no keyboard - plug it in';
      const found = detectKeyboard(names);
      if (found?.size !== detected?.size) { detected = found; applyKeyboardSize(); }
      status.className = names.length ? 'ok' : 'warn';
    };
    access.onstatechange = refresh;
    refresh();
  } catch (err) {
    status.textContent = 'MIDI blocked: ' + err.message;
    status.className = 'warn';
  }
}

addEventListener('pagehide', () => sendOut([0xb0, 123, 0]));

// ---- Demo (lo-fi changes with a wandering melody) -------------------------------------------
const DEMO_BPM = 80;
const DEMO_CHORDS = [
  { notes: [38, 53, 57, 60, 64], scale: [2, 4, 5, 9, 0] },   // Dm9
  { notes: [43, 53, 57, 59, 64], scale: [2, 4, 7, 9, 11] },  // G13
  { notes: [36, 52, 55, 59, 62], scale: [0, 2, 4, 7, 11] },  // Cmaj9
  { notes: [45, 55, 58, 61, 65], scale: [1, 4, 5, 7, 9] },   // A7b9
];
const demo = { on: false, next: 0, step: 0, offs: [], prev: 72 };

function toggleDemo() {
  demo.on = !demo.on;
  if (demo.on) { demo.next = clock(); demo.step = 0; }
  else { demo.offs = []; releaseAll(); }
  updateStatus();
}

function runDemo(now) {
  for (let i = demo.offs.length - 1; i >= 0; i--) {
    const off = demo.offs[i];
    if (off.t > now) continue;
    if (held.get(off.n) === off.trail) stopNote(off.n);  // skip if that key was restruck since
    demo.offs.splice(i, 1);
  }
  if (!demo.on) return;
  const eighth = 30 / DEMO_BPM;
  if (now - demo.next > 1) demo.next = now;  // tab was in the background: don't replay the backlog
  const schedule = (n, len) => { playNote(n); demo.offs.push({ t: now + len, n, trail: held.get(n) }); };
  while (now >= demo.next) {
    const pos = demo.step % 8;
    const chord = DEMO_CHORDS[Math.floor(demo.step / 8) % DEMO_CHORDS.length];
    if (pos === 0) for (const n of chord.notes) schedule(n, eighth * 7.5);
    if (Math.random() < (pos % 2 ? 0.35 : 0.55)) {
      const near = [];
      for (let n = 67; n <= 81; n++) if (chord.scale.includes(n % 12) && Math.abs(n - demo.prev) <= 4) near.push(n);
      const n = near.length ? near[Math.floor(Math.random() * near.length)] : 72;
      if (!held.has(n)) { schedule(n, eighth * rand(0.8, 2.2)); demo.prev = n; }
    }
    demo.next += eighth * (pos % 2 === 0 ? 1.24 : 0.76);  // swing
    demo.step++;
  }
}

// ---- HUD ------------------------------------------------------------------------------------
const hud = document.getElementById('hud');
const chordEl = document.getElementById('chord');
const hintEl = document.getElementById('hint');

const CHORDS = {
  '0,4,7': '', '0,3,7': 'm', '0,3,6': 'dim', '0,4,8': 'aug', '0,2,7': 'sus2', '0,5,7': 'sus4', '0,7': ' power',
  '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,4,7,10': '7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7',
  '0,4,7,9': '6', '0,3,7,9': 'm6', '0,2,4,7': 'add9', '0,4,11': 'maj7', '0,3,10': 'm7', '0,4,10': '7',
  '0,2,4,7,11': 'maj9', '0,2,3,7,10': 'm9', '0,2,4,7,10': '9',
};

function chordName(notes) {
  const sorted = [...notes].sort((a, b) => a - b);
  const pcs = [...new Set(sorted.map(n => n % 12))];
  if (sorted.length === 1) return noteName(sorted[0]);
  if (pcs.length === 1) return NAMES[pcs[0]];
  const bass = sorted[0] % 12;
  for (const root of [bass, ...pcs.filter(p => p !== bass)]) {  // prefer the bass note as root
    const key = pcs.map(p => (p - root + 12) % 12).sort((a, b) => a - b).join(',');
    if (key in CHORDS) return NAMES[root] + CHORDS[key] + (root !== bass ? '/' + NAMES[bass] : '');
  }
  return '';
}

function updateChord() {
  const notes = [...held.keys()].sort((a, b) => a - b);
  if (!notes.length) { chordEl.classList.add('fade'); return; }
  chordEl.classList.remove('fade');
  document.getElementById('chord-name').textContent = chordName(notes);
  document.getElementById('chord-notes').textContent = notes.length > 1 ? notes.map(noteName).join(' ') : '';
}

function updateStatus() {
  document.getElementById('vis-name').textContent = bg.modes[bg.index].name + (autoCycle ? ' (auto)' : '');
  document.getElementById('play-mode').textContent =
    tutor.active ? 'LESSON' : camjam.on ? 'CAMERA' : demo.on ? 'DEMO' : 'live';
  document.getElementById('btn-demo').textContent = demo.on ? 'Stop demo' : 'Demo';
  document.getElementById('keys-name').textContent = keysLabel();
  const sound = document.getElementById('sound-name');
  sound.textContent = synth.patch.name + (synth.needsGesture ? ' - click or press a key to enable' : '');
  sound.className = synth.needsGesture ? 'warn' : '';
}

// ---- Computer keyboard ----------------------------------------------------------------------
let pcBase = 60;
const pcHeld = new Map();  // key -> note it started

// Browsers only start audio after a click or key press on the page.
addEventListener('pointerdown', () => synth.start()?.then(updateStatus));

// Shortcut keys, shared by the keyboard and the on-screen buttons. Returns true if handled.
function handleKey(k) {
  if (tutor.menuOpen ? tutor.menuKey(k) : tutor.lessonKey(k)) return true;
  if (k === 'm') tutor.openMenu();
  else if (k === 'z') pcBase = Math.max(24, pcBase - 12);
  else if (k === 'x') pcBase = Math.min(96, pcBase + 12);
  else if (k >= '1' && k <= String(bg.modes.length)) { autoCycle = false; bg.setMode(+k - 1); }
  else if (k === 'v') { autoCycle = false; bg.setMode((bg.index + 1) % bg.modes.length); }
  else if (k === 'i') camjam.toggle();
  else if (k === '0') { autoCycle = true; updateStatus(); }
  else if (k === '[' || k === ']') { synth.setPatch(synth.index + (k === ']' ? 1 : -1)); updateStatus(); }
  else if (k === ' ') toggleDemo();
  else if (k === 'enter') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (k === 'escape') releaseAll();  // panic: lessons and the menu use Esc first, above
  else if (k === 'tab') {
    hud.classList.toggle('hidden');
    document.getElementById('hud-toggle').textContent = hud.classList.contains('hidden') ? 'Show' : 'Hide';
  } else return false;
  return true;
}

addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, #editor')) return;  // typing in the song editor
  synth.start()?.then(updateStatus);
  const k = e.key.toLowerCase();
  if (handleKey(k)) { e.preventDefault(); return; }
  const idx = PC_KEYS.indexOf(k);
  if (idx < 0) return;
  const n = pcBase + idx;
  pcHeld.set(k, n);
  playNote(n);
  e.preventDefault();
});

for (const btn of document.querySelectorAll('[data-key]')) {
  btn.addEventListener('pointerdown', e => e.preventDefault());  // don't take focus, or Space would re-click it
  btn.addEventListener('click', () => { handleKey(btn.dataset.key); updateStatus(); });
}

// ---- Mouse and touch on the piano -----------------------------------------------------------
// Each pointer (mouse or finger) holds one note; sliding across the keys plays each one in turn.
const pointerNotes = new Map();  // pointerId -> note, or null while it's off the keys

function keyAt(x, y) {
  if (y < kb.top) return null;
  for (const [n, k] of kb.keys) if (k.black && x >= k.x && x < k.x + k.w && y < kb.top + k.h) return n;
  for (const [n, k] of kb.keys) if (!k.black && x >= k.x && x < k.x + k.w) return n;
  return null;
}

canvas.addEventListener('pointerdown', e => {
  const n = keyAt(e.clientX, e.clientY);
  if (n === null) return;
  canvas.setPointerCapture(e.pointerId);
  pointerNotes.set(e.pointerId, n);
  playNote(n);
});

canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') canvas.style.cursor = keyAt(e.clientX, e.clientY) === null ? '' : 'pointer';
  if (!pointerNotes.has(e.pointerId)) return;
  const prev = pointerNotes.get(e.pointerId), n = keyAt(e.clientX, e.clientY);
  if (n === prev) return;
  if (prev !== null) stopNote(prev);
  if (n !== null) playNote(n);
  pointerNotes.set(e.pointerId, n);
});

function releasePointer(e) {
  const n = pointerNotes.get(e.pointerId);
  if (n != null) stopNote(n);
  pointerNotes.delete(e.pointerId);
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());  // long-press on a touchscreen

addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (pcHeld.has(k)) { stopNote(pcHeld.get(k)); pcHeld.delete(k); }
});

addEventListener('blur', () => {
  pcHeld.forEach(stopNote);
  pcHeld.clear();
  pointerNotes.forEach(n => { if (n !== null) stopNote(n); });
  pointerNotes.clear();
});

// ---- Drawing --------------------------------------------------------------------------------
function burst(n) {
  const k = kb.keys.get(n);
  const hue = noteHue(n);
  for (let i = 0; i < 26; i++) {
    const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);  // fan upward
    const s = rand(60, 320);
    particles.push({ x: k.cx + rand(-k.w / 3, k.w / 3), y: kb.top, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
                     g: 260, life: 1, decay: rand(0.8, 1.8), hue: hue + rand(-15, 15), size: rand(1.5, 3.5) });
  }
}

function updateParticles(dt) {
  for (const n of held.keys()) {  // embers drifting up off held keys
    if (Math.random() < 0.4) {
      const k = kb.keys.get(n);
      particles.push({ x: k.cx + rand(-k.w / 3, k.w / 3), y: kb.top, vx: rand(-15, 15), vy: rand(-120, -40),
                       g: 0, life: 1, decay: rand(0.6, 1.2), hue: noteHue(n), size: rand(1, 2.5) });
    }
  }
  if (particles.length > 2500) particles.splice(0, particles.length - 2500);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += p.g * dt;
    p.vx *= 0.98;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= p.decay * dt;
    if (p.life <= 0 || p.y > H) particles.splice(i, 1);
  }
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    ctx.fillStyle = `hsla(${p.hue},100%,65%,${p.life})`;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.restore();
}

function drawBackdrop(now) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  // the whole scene breathes with your playing; dimmer in lessons so the notes stay readable
  ctx.globalAlpha = (0.7 + 0.3 * au.energy) * (tutor.active ? 0.55 : 1);
  ctx.drawImage(bg.canvas, 0, 0, W, H);
  ctx.globalAlpha = 1;

  const v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);

  // octave guide lines at each C, and a light beam up the lane of every held key
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  for (const [n, k] of kb.keys) if (n % 12 === 0) ctx.fillRect(k.x, 0, 1, kb.top);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const n of held.keys()) {
    const k = kb.keys.get(n);
    const g = ctx.createLinearGradient(0, kb.top, 0, 0);
    g.addColorStop(0, `hsla(${noteHue(n)},100%,60%,0.22)`);
    g.addColorStop(1, `hsla(${noteHue(n)},100%,60%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(k.cx - kb.whiteW * 0.5, 0, kb.whiteW, kb.top);
  }
  ctx.restore();
}

function drawTrails(now) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const laneW = kb.whiteW * 0.62;
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    const k = kb.keys.get(t.note);
    const yTop = kb.top - (now - t.start) * RISE_SPEED;
    const yBot = t.end === null ? kb.top : kb.top - (now - t.end) * RISE_SPEED;
    if (yBot < -40 || !k) { trails.splice(i, 1); continue; }
    const top = Math.min(yTop, yBot - 6);  // quick taps still get a visible pill
    const h = yBot - top;
    const x = k.cx - laneW / 2;
    const alpha = 0.15 + 0.85 * clamp(yBot / kb.top, 0, 1) ** 0.7;
    const hue = noteHue(t.note);

    ctx.fillStyle = `hsl(${hue},100%,55%)`;  // two soft halo passes, a cheap bloom
    ctx.globalAlpha = 0.16 * alpha;
    ctx.beginPath(); ctx.roundRect(x - laneW * 0.35, top - 6, laneW * 1.7, h + 12, laneW * 0.6); ctx.fill();
    ctx.globalAlpha = 0.3 * alpha;
    ctx.beginPath(); ctx.roundRect(x - laneW * 0.12, top - 2, laneW * 1.24, h + 4, laneW * 0.45); ctx.fill();

    const g = ctx.createLinearGradient(0, top, 0, yBot);
    g.addColorStop(0, `hsla(${hue},100%,70%,0.35)`);
    g.addColorStop(1, `hsla(${hue},100%,60%,1)`);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, top, laneW, h, laneW * 0.35); ctx.fill();
    ctx.fillStyle = `hsla(${hue},100%,92%,0.8)`;  // hot white core
    ctx.fillRect(k.cx - laneW * 0.1, top + 3, laneW * 0.2, Math.max(0, h - 6));
  }
  ctx.restore();
}

function drawKey(n, k, now) {
  const on = held.has(n);
  const hue = noteHue(n);
  const g = ctx.createLinearGradient(0, kb.top, 0, kb.top + k.h);
  if (on) { g.addColorStop(0, `hsl(${hue},100%,85%)`); g.addColorStop(1, `hsl(${hue},100%,50%)`); }
  else if (k.black) { g.addColorStop(0, '#2a2a33'); g.addColorStop(1, '#0b0b10'); }
  else { g.addColorStop(0, '#c9ccd8'); g.addColorStop(1, '#ffffff'); }
  ctx.fillStyle = g;
  const r = Math.min(6, k.w * 0.15);
  ctx.beginPath();
  ctx.roundRect(k.x + 0.5, kb.top, k.w - 1, k.h, [0, 0, r, r]);
  ctx.fill();
  if (tutor.active) {  // light the keys the lesson wants next; flash right/wrong presses
    const hint = tutor.keyHint(n, now);
    if (hint.target > 0 && !on) { ctx.fillStyle = `hsla(${hue},100%,58%,${hint.target})`; ctx.fill(); }
    if (hint.flash) { ctx.fillStyle = hint.flash === 'wrong' ? 'rgba(255,40,40,0.75)' : 'rgba(90,255,140,0.5)'; ctx.fill(); }
  }
  // Lessons label every white key; otherwise just the Cs.
  if (!k.black && (n % 12 === 0 || tutor.active)) {
    ctx.fillStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.5)';
    ctx.font = `${Math.max(8, kb.whiteW * 0.32)}px "Lucida Console", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(n % 12 === 0 ? noteName(n) : NAMES[n % 12], k.cx, kb.top + k.h - 8);
  }
}

function drawKeyboard(now) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, kb.top, W, kb.height);
  for (const [n, k] of kb.keys) if (!k.black) drawKey(n, k, now);
  for (const [n, k] of kb.keys) if (k.black) drawKey(n, k, now);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const line = ctx.createLinearGradient(0, 0, W, 0);  // rainbow hit line, slowly cycling
  for (let i = 0; i <= 6; i++) line.addColorStop(i / 6, `hsl(${(i * 60 + now * 25) % 360},100%,60%)`);
  ctx.fillStyle = line;
  ctx.shadowColor = `hsl(${(now * 25) % 360},100%,60%)`;
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.55 + 0.45 * au.energy;
  ctx.fillRect(0, kb.top - 2, W, 3);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  for (const n of held.keys()) {  // flare where each held note meets the line
    const k = kb.keys.get(n);
    const r = kb.whiteW * 2.2;
    const g = ctx.createRadialGradient(k.cx, kb.top, 0, k.cx, kb.top, r);
    g.addColorStop(0, `hsla(${noteHue(n)},100%,75%,0.9)`);
    g.addColorStop(1, `hsla(${noteHue(n)},100%,50%,0)`);
    ctx.fillStyle = g;
    ctx.fillRect(k.cx - r, kb.top - r, r * 2, r * 2);
  }
  ctx.restore();
}

// ---- Main loop ------------------------------------------------------------------------------
let last = clock();
function frame() {
  const now = clock();
  const dt = Math.min(0.05, now - last);
  last = now;
  runDemo(now);
  tutor.update(dt);
  camjam.update(now);
  updateAudio(now, dt);
  if (autoCycle && now - bg.since > MODE_SECONDS) bg.setMode((bg.index + 1) % bg.modes.length);
  bg.draw(now, dt);
  drawBackdrop(now);
  if (tutor.active) tutor.draw(); else drawTrails(now);
  drawKeyboard(now);
  updateParticles(dt);
  drawParticles();
  tutor.drawOverlay(now);
  camjam.draw();
  tutor.updatePanel();
  hintEl.classList.toggle('show', !demo.on && !tutor.menuOpen && now - lastNoteAt > 15 && now > 3);
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
applyKeyboardSize();
bg.index = clamp(parseInt(params.get('mode') ?? '1', 10) - 1 || 0, 0, bg.modes.length - 1);
bg.since = clock();
updateStatus();
initMidi();
// Get the synth ready now; it only becomes audible once the browser allows audio (after a tap,
// or right away when launched with autoplay allowed, as the Neon Keys app launcher does).
synth.start().then(updateStatus);
if (params.has('demo')) toggleDemo();
const startLesson = LESSONS.find(l => l.id === params.get('lesson'));
if (startLesson) tutor.start(startLesson, params.has('listen'));
requestAnimationFrame(frame);

for (const [id, fn] of [['btn-keys', openKeysMenu], ['keys-close', () => document.getElementById('keys-menu').classList.remove('show')]]) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', e => e.preventDefault());
  btn.addEventListener('click', fn);
}
