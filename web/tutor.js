// Tutorial mode: lesson notes fall toward the keyboard and cross the line when it's time to play
// them. "Wait" mode holds the song until you play the right keys; "play-along" keeps time and
// scores each note. Loaded before app.js and only touches app.js globals inside its methods.
'use strict';

const FALL_PX_PER_BEAT = 110;
const HIT_LATE = 0.25;    // seconds after a note's time it can still be hit
const HIT_EARLY = 0.25;   // seconds before, in play-along
const WAIT_EARLY = 0.6;   // seconds before, in wait mode
const PERFECT = 0.08;

const tutor = {
  active: false,
  menuOpen: false,
  menuIndex: 0,
  lesson: null,
  notes: [],
  steps: [],
  lines: [],           // karaoke lines for songs with lyrics
  end: 0,
  beat: 0,
  tempo: 1,
  mode: localStorage.getItem('dkb-tutor-mode') || 'wait',  // 'wait' | 'flow'
  listening: false,   // the lesson plays itself so you can hear how it goes
  paused: false,
  finished: false,
  waiting: false,
  stats: null,
  result: '',
  popups: [],
  flashes: new Map(),  // note -> { t, kind: 'ok' | 'wrong' }
  autoOffs: [],
  shown: {},           // last text written to each panel element

  start(lesson, listening = false) {
    if (demo.on) toggleDemo();
    if (camjam.on || document.body.classList.contains('cam')) camjam.stop();
    this.releaseAuto();
    const built = buildLesson(lesson);
    this.lesson = lesson;
    this.notes = built.notes;
    this.steps = built.steps;
    this.lines = built.lines;
    this.end = built.end;
    this.shown.lyrics = null;
    this.notes = fitRange(this.notes);
    this.menuIndex = LESSONS.indexOf(lesson);
    this.beat = -4;  // a few beats of lead-in while the first notes fall
    this.listening = listening;
    this.paused = this.finished = false;
    this.stats = { hit: 0, perfect: 0, miss: 0, wrong: 0 };
    this.result = '';
    this.popups = [];
    this.active = true;
    trails.length = 0;
    this.closeMenu();
    document.body.classList.add('tutor');
    updateStatus();
  },

  stop() {
    this.releaseAuto();
    this.active = false;
    document.body.classList.remove('tutor');
    updateStatus();
  },

  releaseAuto() {
    this.autoOffs.forEach(o => stopNote(o.n));
    this.autoOffs = [];
  },

  get secPerBeat() { return 60 / (this.lesson.bpm * this.tempo); },

  // Called for every key press while a lesson is running.
  onPress(n) {
    if (!this.active || this.finished || this.listening || this.paused || this.menuOpen) return;
    const early = this.mode === 'wait' ? WAIT_EARLY : HIT_EARLY;
    let best = null, bestErr = Infinity;
    for (const nt of this.notes) {
      const err = (this.beat - nt.t) * this.secPerBeat;  // negative = early
      if (err < -early) break;
      if (nt.n !== n || nt.hit || nt.missed || err > HIT_LATE) continue;
      if (Math.abs(err) < Math.abs(bestErr)) { best = nt; bestErr = err; }
    }
    if (!best) {
      // replaying a note you just hit (e.g. holding through a chord) isn't a mistake
      if (this.notes.some(nt => nt.n === n && nt.hit && Math.abs(nt.t - this.beat) < 1)) return;
      this.stats.wrong++;
      this.flashes.set(n, { t: clock(), kind: 'wrong' });
      this.popup(n, 'X', '#ff4d4d');
      return;
    }
    best.hit = true;
    this.stats.hit++;
    this.flashes.set(n, { t: clock(), kind: 'ok' });
    if (this.mode === 'flow') {
      const perfect = Math.abs(bestErr) < PERFECT;
      if (perfect) this.stats.perfect++;
      this.popup(n, perfect ? 'PERFECT' : bestErr < 0 ? 'EARLY' : 'LATE', perfect ? '#7dffb0' : '#ffd84d');
    }
  },

  popup(n, text, color) {
    const k = kb.keys.get(n);
    if (k) this.popups.push({ x: k.cx, y: kb.top - 24, text, color, life: 1 });
  },

  update(dt) {
    if (!this.active) return;
    for (const p of this.popups) { p.life -= dt * 1.3; p.y -= 45 * dt; }
    this.popups = this.popups.filter(p => p.life > 0);
    if (this.paused || this.finished || this.menuOpen) return;

    let next = this.beat + dt / this.secPerBeat;
    this.waiting = false;
    if (this.mode === 'wait' && !this.listening) {
      const pending = this.notes.find(nt => !nt.hit);
      if (pending && next >= pending.t) { next = Math.max(this.beat, pending.t); this.waiting = true; }
    }
    this.beat = next;

    if (this.listening) {
      for (const nt of this.notes) {
        if (nt.t > this.beat) break;
        if (nt.hit) continue;
        nt.hit = true;
        playNote(nt.n);
        this.autoOffs.push({ at: nt.t + nt.dur * 0.9, n: nt.n });
      }
      this.autoOffs = this.autoOffs.filter(o => {
        if (o.at > this.beat) return true;
        stopNote(o.n);
        return false;
      });
    } else if (this.mode === 'flow') {
      for (const nt of this.notes) {
        if (nt.t > this.beat) break;
        if (nt.hit || nt.missed || (this.beat - nt.t) * this.secPerBeat <= HIT_LATE) continue;
        nt.missed = true;
        this.stats.miss++;
        this.popup(nt.n, 'MISS', '#ff4d4d');
      }
    }
    if (this.beat > this.end + 1) this.finish();
  },

  finish() {
    this.finished = true;
    this.releaseAuto();
    if (this.listening) {
      this.result = 'That is how it goes! Press C to play it yourself.';
      return;
    }
    const s = this.stats, total = this.notes.length;
    const acc = this.mode === 'wait' ? total / (total + s.wrong) : s.hit / (total + s.wrong);
    const stars = acc >= 0.95 ? 3 : acc >= 0.8 ? 2 : acc >= 0.5 ? 1 : 0;
    const key = 'dkb-stars-' + this.lesson.id;
    localStorage.setItem(key, Math.max(stars, Number(localStorage.getItem(key) || 0)));
    this.result = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ${Math.round(acc * 100)}% accuracy` +
      (this.mode === 'flow' ? `  ·  ${s.perfect} perfect, ${s.miss} missed` : '') +
      (s.wrong ? `  ·  ${s.wrong} wrong key${s.wrong === 1 ? '' : 's'}` : '') +
      (stars === 3 && this.mode === 'wait' ? '  ·  Try N for play-along mode!' : '');
  },

  // ---- Keys ---------------------------------------------------------------------------------
  // Returns true if the key was handled.
  lessonKey(k) {
    if (!this.active) return false;
    if (k === ' ') { this.paused = !this.paused; }
    else if (k === 'escape') this.stop();
    else if (k === 'r') this.start(this.lesson);
    else if (k === 'c') this.start(this.lesson, !this.listening);
    else if (k === 'n') {
      this.mode = this.mode === 'wait' ? 'flow' : 'wait';
      localStorage.setItem('dkb-tutor-mode', this.mode);
      this.start(this.lesson);
    } else if (k === '-' || k === '=') {
      this.tempo = clamp(Math.round((this.tempo + (k === '=' ? 0.1 : -0.1)) * 10) / 10, 0.5, 1.5);
    } else if (k === 'enter' && this.finished) this.start(LESSONS[(this.menuIndex + 1) % LESSONS.length]);
    else return false;
    return true;
  },

  menuKey(k) {
    if (k === 'arrowdown' || k === 'arrowup') {
      const count = LESSONS.length + 1;  // the lessons, then "+ Add a song"
      this.menuIndex = (this.menuIndex + (k === 'arrowdown' ? 1 : -1) + count) % count;
      this.renderMenu();
    } else if (k === 'enter') {
      if (this.menuIndex === LESSONS.length) songs.open(); else this.start(LESSONS[this.menuIndex]);
    }
    else if (k === 'escape' || k === 'm') this.closeMenu();
    else return false;
    return true;
  },

  // ---- Menu ---------------------------------------------------------------------------------
  openMenu() {
    this.menuOpen = true;
    this.renderMenu();
    document.getElementById('menu').classList.add('show');
  },

  closeMenu() {
    this.menuOpen = false;
    document.getElementById('menu').classList.remove('show');
  },

  renderMenu() {
    const list = document.getElementById('menu-list');
    list.replaceChildren();
    let group = null;
    LESSONS.forEach((lesson, i) => {
      if (lesson.group !== group) {
        group = lesson.group;
        const h = document.createElement('div');
        h.className = 'menu-group';
        h.textContent = group;
        list.append(h);
      }
      const stars = Number(localStorage.getItem('dkb-stars-' + lesson.id) || 0);
      const item = document.createElement('div');
      item.className = 'menu-item' + (i === this.menuIndex ? ' sel' : '');
      const title = document.createElement('span');
      title.textContent = lesson.title;
      const best = document.createElement('span');
      best.className = 'stars';
      const empty = document.createElement('span');
      empty.className = 'empty';
      empty.textContent = '★'.repeat(3 - stars);
      best.append('★'.repeat(stars), empty);
      item.append(title, best);
      if (lesson.custom) {
        const edit = document.createElement('button');
        edit.className = 'btn edit';
        edit.textContent = 'Edit';
        edit.onclick = e => { e.stopPropagation(); songs.open(songs.list.find(s => s.id === lesson.id)); };
        best.append(edit);
      }
      item.onclick = () => this.start(lesson);
      list.append(item);
      if (i === this.menuIndex) item.scrollIntoView({ block: 'nearest' });
    });
    if (group !== 'My Songs') {
      const h = document.createElement('div');
      h.className = 'menu-group';
      h.textContent = 'My Songs';
      list.append(h);
    }
    const add = document.createElement('div');  // index LESSONS.length in keyboard navigation
    add.className = 'menu-item add' + (this.menuIndex === LESSONS.length ? ' sel' : '');
    add.textContent = '+ Add a song (paste tabs or notes)';
    add.onclick = () => songs.open();
    list.append(add);
    if (this.menuIndex === LESSONS.length) add.scrollIntoView({ block: 'nearest' });
  },

  // ---- Drawing ------------------------------------------------------------------------------
  draw() {
    const ppb = FALL_PX_PER_BEAT;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, kb.top);
    ctx.clip();

    const perBar = this.lesson.beatsPerBar ?? 4, offset = this.lesson.barOffset ?? 0;
    for (let b = Math.ceil(this.beat); b < this.beat + kb.top / ppb + 1; b++) {
      const y = kb.top - (b - this.beat) * ppb;
      ctx.fillStyle = (((b - offset) % perBar) + perBar) % perBar === 0 ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.045)';
      ctx.fillRect(0, y, W, 1);
    }

    ctx.textAlign = 'center';
    for (const nt of this.notes) {
      const yBot = kb.top - (nt.t - this.beat) * ppb;  // the note's start edge hits the line on time
      if (yBot < 0) break;
      const yTop = yBot - Math.max(nt.dur * ppb - 3, 10);
      if (yTop > kb.top) continue;
      const k = kb.keys.get(nt.n);
      const w = k.black ? kb.whiteW * 0.55 : kb.whiteW * 0.8, x = k.cx - w / 2, h = yBot - yTop;
      const hue = noteHue(nt.n);
      const sat = nt.missed ? 0 : 95, light = nt.hit ? 82 : nt.hand === 'L' ? 42 : 58;

      if (!nt.missed) {  // soft glow
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = nt.hit ? 0.45 : 0.22;
        ctx.fillStyle = `hsl(${hue},100%,55%)`;
        ctx.beginPath(); ctx.roundRect(x - 6, yTop - 6, w + 12, h + 12, 10); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = nt.missed ? 0.45 : 0.95;
      ctx.fillStyle = `hsl(${hue},${sat}%,${light}%)`;
      ctx.beginPath(); ctx.roundRect(x, yTop, w, h, Math.min(8, w * 0.3)); ctx.fill();
      if (nt.hand === 'L') {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (h > 16) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.font = `bold ${Math.round(Math.min(14, w * 0.5))}px "Lucida Console", monospace`;
        ctx.fillText(NAMES[nt.n % 12], k.cx, yBot - 5);
      }
      if (nt.lyric) {  // the word sung on this note, just right of it
        ctx.globalAlpha = nt.missed ? 0.5 : 1;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.font = 'bold 14px "Lucida Console", monospace';
        ctx.fillText(nt.lyric.length > 24 ? nt.lyric.slice(0, 23) + '…' : nt.lyric, x + w + 5, yBot - 4);
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
      }
    }
    ctx.restore();
  },

  drawOverlay(now) {
    if (!this.active) return;
    ctx.save();
    ctx.textAlign = 'center';
    for (const p of this.popups) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.font = 'bold 16px "Lucida Console", monospace';
      ctx.fillText(p.text, p.x, p.y);
    }
    if (this.paused) {
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(now * 4);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 42px "Lucida Console", monospace';
      ctx.fillText('PAUSED', W / 2, kb.top * 0.55);
    }
    ctx.restore();
  },

  // How strongly to light a key as a target, and any recent hit/wrong flash on it.
  keyHint(n, now) {
    let target = 0;
    if (this.active && !this.finished) {
      for (const nt of this.notes) {
        const d = nt.t - this.beat;
        if (d > 1.5) break;
        if (nt.n !== n || nt.hit || nt.missed || d < -0.5) continue;
        target = Math.max(target, d <= 0 ? 0.6 + 0.25 * Math.sin(now * 10) : 0.5 * (1 - d / 1.5));
      }
    }
    const f = this.flashes.get(n);
    return { target, flash: f && now - f.t < 0.35 ? f.kind : null };
  },

  // ---- Panel --------------------------------------------------------------------------------
  setText(id, text) {
    if (this.shown[id] === text) return;
    this.shown[id] = text;
    document.getElementById(id).textContent = text;
  },

  // Karaoke line: the line holding the next note to play, sung syllables lit, the next one marked.
  renderLyrics() {
    const el = document.getElementById('lesson-lyrics');
    const done = nt => nt.hit || nt.missed;
    let li = this.lines.findIndex(l => l.syllables.some(s => s.note && !done(s.note)));
    if (li < 0) li = this.lines.length - 1;
    const line = this.lines[li];
    const next = line ? line.syllables.findIndex(s => s.note && !done(s.note)) : -1;
    const key = line ? `${li}:${next}` : '';
    if (this.shown.lyrics === key) return;
    this.shown.lyrics = key;
    el.replaceChildren(...(line?.syllables ?? []).map((s, i) => {
      const span = document.createElement('span');
      span.textContent = s.text.endsWith('-') ? s.text.slice(0, -1) : s.text + ' ';  // join syllables into words
      span.className = next < 0 || i < next ? 'sung' : i === next ? 'now' : '';
      return span;
    }));
  },

  updatePanel() {
    if (!this.active) return;
    const step = [...this.steps].reverse().find(s => s.t <= this.beat + 3) || this.steps[0];
    const s = this.stats;
    this.setText('lesson-title', `${this.lesson.group.toUpperCase()}  ·  ${this.lesson.title}`);
    this.setText('lesson-say', this.finished ? this.result : step?.say ?? '');
    const modeName = this.listening ? 'LISTENING' : this.mode === 'wait' ? 'WAIT MODE' : 'PLAY-ALONG';
    this.setText('lesson-info', `${modeName}  ·  tempo ${Math.round(this.tempo * 100)}%  ·  ` +
      `${s.hit}/${this.notes.length} notes` + (s.wrong ? `  ·  ${s.wrong} wrong` : '') +
      (this.mode === 'flow' && !this.listening ? `  ·  ${s.miss} missed` : ''));
    this.setText('btn-pause', this.paused ? 'Resume' : 'Pause');
    this.setText('btn-listen', this.listening ? 'Play it myself' : 'Listen');
    this.setText('btn-mode', this.mode === 'wait' ? 'Mode: Wait' : 'Mode: Play-along');
    document.body.classList.toggle('lesson-done', this.finished);
    this.renderLyrics();
    document.getElementById('lesson-fill').style.width = `${clamp(this.beat / this.end, 0, 1) * 100}%`;
  },
};
