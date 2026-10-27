// Camera Jam: turns what the webcam sees into notes. "Air piano" plays wherever there's movement
// (left to right is low to high, like the keyboard; raise your hands for the octave above).
// "Scanner" sweeps across the picture like a music box and plays the colorful spots it passes.
// Notes go through playNote(), so they light the visuals and reach the synth or the keyboard.
// Loaded before app.js and only touches app.js globals inside its methods.
'use strict';

const CAM_W = 64, CAM_H = 48;            // analysis resolution
const SCAN_COLS = 24;                    // scanner steps per sweep (one per eighth note)
const SCAN_BPM = 100;
const CAM_SCALES = [
  ['PENTATONIC', [0, 2, 4, 7, 9]],       // can't sound wrong
  ['MAJOR', [0, 2, 4, 5, 7, 9, 11]],
  ['MINOR', [0, 2, 3, 5, 7, 8, 10]],
  ['BLUES', [0, 3, 5, 6, 7, 10]],
];

const camjam = {
  on: false,
  style: 'air',
  scaleIndex: 0,
  stream: null,
  video: document.getElementById('cam-video'),
  view: document.getElementById('cam-view'),
  work: Object.assign(document.createElement('canvas'), { width: CAM_W, height: CAM_H }),
  prev: null,          // last frame's brightness, for motion
  lastProcess: 0,
  zones: [],           // air piano: one per scale note across the picture
  rows: [],            // scanner: one note per row, top row highest
  cells: new Float32Array(0),
  scanCol: 0,
  scanNext: 0,
  sounding: new Map(), // scanner row -> note currently held

  get scale() { return CAM_SCALES[this.scaleIndex][1]; },

  async toggle() {
    // the panel is also open (showing an error) when the camera failed to start
    if (this.on || document.body.classList.contains('cam')) this.stop(); else await this.start();
  },

  async start() {
    if (tutor.active) tutor.stop();
    if (demo.on) toggleDemo();
    document.body.classList.add('cam');
    this.message('Starting the camera...');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
    } catch (err) {
      this.message(`No camera: ${err.message}. Check it's plugged in and allowed.`, true);
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.on = true;
    this.setup();
    updateStatus();
  },

  stop() {
    this.releaseAll();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.on = false;
    document.body.classList.remove('cam');
    updateStatus();
  },

  // (Re)build the note layout for the current style and scale.
  setup() {
    this.releaseAll();
    this.prev = null;
    const notes = [];
    for (const octave of [60, 72]) for (const step of this.scale) notes.push(octave + step);
    notes.push(84);
    this.zones = notes.map(base => ({ base, note: null, energy: 0, last: 0, onAt: 0 }));
    this.rows = notes.slice(0, -1).map(n => n - 12).reverse();  // C3 and up, highest on top
    this.cells = new Float32Array(SCAN_COLS * this.rows.length);
    this.scanCol = 0;
    this.scanNext = clock();
    document.getElementById('btn-cam-style').textContent = this.style === 'air' ? 'Style: Air piano' : 'Style: Scanner';
    document.getElementById('btn-cam-scale').textContent = 'Scale: ' + CAM_SCALES[this.scaleIndex][0].toLowerCase();
    this.message(this.style === 'air'
      ? 'Wave your hands! Left is low, right is high, and up high plays the octave above.'
      : 'Hold up colorful things - the scan line plays them like a music box. Higher up = higher notes.');
  },

  cycleStyle() { this.style = this.style === 'air' ? 'scan' : 'air'; if (this.on) this.setup(); },
  cycleScale() { this.scaleIndex = (this.scaleIndex + 1) % CAM_SCALES.length; if (this.on) this.setup(); },

  releaseAll() {
    for (const z of this.zones) if (z.note !== null) { stopNote(z.note); z.note = null; }
    for (const n of this.sounding.values()) stopNote(n);
    this.sounding.clear();
  },

  message(text, warn = false) {
    const el = document.getElementById('cam-msg');
    el.textContent = text;
    el.className = warn ? 'warn' : '';
  },

  // Current frame at analysis size, mirrored like a selfie so moving right plays higher.
  grab() {
    const c = this.work.getContext('2d', { willReadFrequently: true });
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, -CAM_W, 0, CAM_W, CAM_H);
    c.restore();
    return c.getImageData(0, 0, CAM_W, CAM_H).data;
  },

  update(now) {
    if (!this.on || this.video.readyState < 2) return;
    if (this.style === 'air') {
      if (now - this.lastProcess < 0.05) return;  // ~20 checks a second is plenty
      this.lastProcess = now;
      this.processAir(now, this.grab());
    } else if (now >= this.scanNext) {
      this.scanNext = Math.max(this.scanNext + 30 / SCAN_BPM, now - 0.1);
      this.stepScanner(this.grab());
    }
  },

  processAir(now, px) {
    const gray = new Float32Array(CAM_W * CAM_H);
    for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
    const prev = this.prev;
    this.prev = gray;
    if (!prev) return;

    const zoneW = CAM_W / this.zones.length;
    const moved = this.zones.map(() => ({ count: 0, ySum: 0 }));
    let total = 0;
    for (let y = 0; y < CAM_H; y++) {
      for (let x = 0; x < CAM_W; x++) {
        const i = y * CAM_W + x;
        if (Math.abs(gray[i] - prev[i]) < 28) continue;
        const m = moved[Math.min(this.zones.length - 1, Math.floor(x / zoneW))];
        m.count++;
        m.ySum += y;
        total++;
      }
    }
    // Most of the picture changing at once is a light switch or the camera moving, not a hand.
    const lightingChange = total > CAM_W * CAM_H * 0.35;
    let playing = this.zones.filter(z => z.note !== null).length;
    this.zones.forEach((z, i) => {
      const m = moved[i];
      z.energy = m.count / (zoneW * CAM_H);
      if (z.note === null) {
        if (lightingChange || playing >= 4 || z.energy < 0.06 || now - z.last < 0.15) return;
        const yc = m.ySum / m.count / CAM_H;
        z.note = z.base + (yc < 0.33 ? 12 : 0);
        z.last = z.onAt = now;
        playing++;
        playNote(z.note);
      } else if (z.energy < 0.02 || now - z.onAt > 1.2) {
        stopNote(z.note);
        z.note = null;
      }
    });
  },

  stepScanner(px) {
    // Colorfulness (saturation x brightness) of each grid cell; plain walls and skin score low.
    const rowsN = this.rows.length, cw = CAM_W / SCAN_COLS, ch = CAM_H / rowsN;
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < SCAN_COLS; c++) {
        let sum = 0, n = 0;
        for (let y = Math.floor(r * ch); y < Math.floor((r + 1) * ch); y++) {
          for (let x = Math.floor(c * cw); x < Math.floor((c + 1) * cw); x++) {
            const i = (y * CAM_W + x) * 4;
            const max = Math.max(px[i], px[i + 1], px[i + 2]), min = Math.min(px[i], px[i + 1], px[i + 2]);
            sum += max ? ((max - min) / max) * (max / 255) : 0;
            n++;
          }
        }
        this.cells[r * SCAN_COLS + c] = n ? sum / n : 0;
      }
    }
    const sorted = [...this.cells].sort((a, b) => a - b);
    const threshold = Math.max(0.25, sorted[Math.floor(sorted.length / 2)] * 1.8 + 0.08);

    // Up to 3 of the strongest cells in this column sound; a cell that stays lit keeps its note held.
    const col = this.scanCol;
    const active = new Set(this.rows.map((_, r) => r)
      .filter(r => this.cells[r * SCAN_COLS + col] > threshold)
      .sort((a, b) => this.cells[b * SCAN_COLS + col] - this.cells[a * SCAN_COLS + col])
      .slice(0, 3));
    for (const [r, n] of this.sounding) if (!active.has(r)) { stopNote(n); this.sounding.delete(r); }
    for (const r of active) if (!this.sounding.has(r)) { playNote(this.rows[r]); this.sounding.set(r, this.rows[r]); }
    this.threshold = threshold;
    this.scanCol = (col + 1) % SCAN_COLS;
    if (this.scanCol === 0) { for (const n of this.sounding.values()) stopNote(n); this.sounding.clear(); }
  },

  // Mirrored preview with the zones or scan grid drawn over it.
  draw() {
    if (!this.on) return;
    const c = this.view.getContext('2d'), w = this.view.width, h = this.view.height;
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, -w, 0, w, h);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, w, h);
    if (this.style === 'air') {
      const zw = w / this.zones.length;
      this.zones.forEach((z, i) => {
        const hue = noteHue(z.base);
        c.fillStyle = `hsla(${hue},100%,55%,${z.note !== null ? 0.55 : Math.min(0.4, z.energy * 4)})`;
        c.fillRect(i * zw, 0, zw, h);
        c.fillStyle = 'rgba(255,255,255,0.15)';
        c.fillRect(i * zw, 0, 1, h);
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.font = '10px "Lucida Console", monospace';
        c.textAlign = 'center';
        c.fillText(NAMES[z.base % 12], (i + 0.5) * zw, h - 4);
      });
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.fillRect(0, h * 0.33, w, 1);  // above this line plays the octave up
    } else {
      const rowsN = this.rows.length, cw = w / SCAN_COLS, ch = h / rowsN;
      for (let r = 0; r < rowsN; r++) {
        for (let col = 0; col < SCAN_COLS; col++) {
          const v = this.cells[r * SCAN_COLS + col];
          if (v <= (this.threshold ?? 1)) continue;
          c.fillStyle = `hsla(${noteHue(this.rows[r])},100%,60%,0.45)`;
          c.fillRect(col * cw + 1, r * ch + 1, cw - 2, ch - 2);
        }
      }
      const x = ((this.scanCol + SCAN_COLS - 1) % SCAN_COLS) * cw;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.fillRect(x + cw / 2 - 1, 0, 2, h);
      for (const r of this.sounding.keys()) {
        c.fillStyle = `hsl(${noteHue(this.rows[r])},100%,70%)`;
        c.fillRect(x, r * ch, cw, ch);
      }
    }
  },
};

for (const [id, fn] of [['btn-cam-style', () => camjam.cycleStyle()], ['btn-cam-scale', () => camjam.cycleScale()]]) {
  const btn = document.getElementById(id);
  btn.addEventListener('pointerdown', e => e.preventDefault());
  btn.addEventListener('click', fn);
}
