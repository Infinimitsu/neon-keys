// Browser synth for the visualizer: a few patches played from the same note events as the visuals,
// plus an AnalyserNode the backgrounds read when a patch is sounding. Exposes `window.synth`.
'use strict';

(() => {
  const freqOf = n => 440 * 2 ** ((n - 69) / 12);

  // ---- Patches ------------------------------------------------------------------------------
  // kind 'pluck' runs through the Karplus-Strong worklet; kind 'osc' builds oscillator voices.
  const PATCHES = [
    { id: 'lead', name: 'OVERDRIVE LEAD GUITAR', kind: 'pluck', drive: true, sustain: 0.9996, vib: 0.3, bright: 0.45,
      delay: 0.3, reverb: 0.25, gain: 0.2 },
    { id: 'clean', name: 'CLEAN CHORUS GUITAR', kind: 'pluck', sustain: 0.998, vib: 0, bright: 0.75, chorus: 0.8,
      delay: 0.12, reverb: 0.3, gain: 0.68 },
    { id: 'epiano', name: 'ELECTRIC PIANO', kind: 'osc', voice: epianoVoice, tremolo: 0.25, reverb: 0.3, gain: 0.36 },
    { id: 'synth', name: 'ANALOG SYNTH', kind: 'osc', voice: synthVoice, delay: 0.22, reverb: 0.25, gain: 0.22 },
    { id: 'organ', name: 'ROTARY ORGAN', kind: 'osc', voice: organVoice, chorus: 6, tremolo: 0.15, reverb: 0.2, gain: 0.12 },
    { id: 'chip', name: '8-BIT CHIP', kind: 'osc', voice: chipVoice, reverb: 0.08, gain: 0.22 },
    { id: 'choir', name: 'CHOIR AAH', kind: 'osc', voice: choirVoice, reverb: 0.4, gain: 0.7 },
    { id: 'robot', name: 'ROBOT VOICE', kind: 'osc', voice: robotVoice, delay: 0.15, reverb: 0.1, gain: 0.55 },
    { id: 'meow', name: 'MEOW CAT', kind: 'osc', voice: meowVoice, reverb: 0.15, gain: 1.0 },
    { id: 'quack', name: 'DUCK QUACK', kind: 'osc', voice: quackVoice, reverb: 0.1, gain: 0.5 },
    { id: 'fart', name: 'FART-O-PHONE', kind: 'osc', voice: fartVoice, reverb: 0.05, gain: 0.38 },
    { id: 'off', name: 'KEYBOARD ONLY' },
  ];

  function osc(ctx, type, f) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  }

  // Each voice function starts sounding at time t into `dest` and returns { release(t) }.
  function epianoVoice(ctx, f, vel, dest, t) {  // two-operator FM, plus a fast "tine" ping
    const index = 2 * Math.min(1, Math.sqrt(400 / f));
    const car = osc(ctx, 'sine', f), mod = osc(ctx, 'sine', f), tine = osc(ctx, 'sine', f * 14);
    const modG = ctx.createGain(), tineG = ctx.createGain(), amp = ctx.createGain();
    modG.gain.setValueAtTime(f * index * vel, t);
    modG.gain.setTargetAtTime(f * index * 0.2, t, 0.35);
    tineG.gain.setValueAtTime(f * 1.2 * vel, t);
    tineG.gain.setTargetAtTime(0, t, 0.03);
    mod.connect(modG).connect(car.frequency);
    tine.connect(tineG).connect(car.frequency);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.004, 1.6);
    car.connect(amp).connect(dest);
    return startVoice([car, mod, tine], amp, t, 0.08);
  }

  function synthVoice(ctx, f, vel, dest, t) {  // three detuned saws + sub, resonant filter sweep
    const oscs = [-8, 0, 8].map(c => { const o = osc(ctx, 'sawtooth', f); o.detune.value = c; return o; });
    const sub = osc(ctx, 'square', f / 2), subG = ctx.createGain();
    subG.gain.value = 0.3;
    const filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(Math.min(f * 8 + 2000, 12000), t);
    filter.frequency.setTargetAtTime(f * 3 + 600, t, 0.25);
    oscs.forEach(o => o.connect(filter));
    sub.connect(subG).connect(filter);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.7, t + 0.008);
    amp.gain.setTargetAtTime(vel * 0.5, t + 0.008, 0.2);
    filter.connect(amp).connect(dest);
    return startVoice([...oscs, sub], amp, t, 0.12);
  }

  function organVoice(ctx, f, vel, dest, t) {  // drawbars 16' 8' 5⅓' 4' 2⅔' 2'
    const ratios = [0.5, 1, 1.5, 2, 3, 4], levels = [0.5, 1, 0.3, 0.6, 0.35, 0.3];
    const amp = ctx.createGain();
    const oscs = ratios.map((r, i) => {
      const o = osc(ctx, 'sine', f * r), g = ctx.createGain();
      g.gain.value = levels[i];
      o.connect(g).connect(amp);
      return o;
    });
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 1.15, t + 0.004);  // tiny overshoot reads as key click
    amp.gain.linearRampToValueAtTime(vel, t + 0.02);
    amp.connect(dest);
    return startVoice(oscs, amp, t, 0.02);
  }

  let pulseWave = null;
  function chipVoice(ctx, f, vel, dest, t) {  // 25% pulse wave with delayed vibrato
    if (!pulseWave) {
      const real = new Float32Array(32), imag = new Float32Array(32);
      for (let n = 1; n < 32; n++) real[n] = 2 / (n * Math.PI) * Math.sin(n * Math.PI * 0.25);
      pulseWave = ctx.createPeriodicWave(real, imag);
    }
    const o = ctx.createOscillator();
    o.setPeriodicWave(pulseWave);
    o.frequency.value = f;
    const lfo = osc(ctx, 'sine', 6), lfoG = ctx.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(f * 0.012, t + 0.4);
    lfo.connect(lfoG).connect(o.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vel, t);
    amp.gain.setTargetAtTime(vel * 0.6, t, 0.1);
    o.connect(amp).connect(dest);
    return startVoice([o, lfo], amp, t, 0.02);
  }

  // ---- Silly and voice sounds -----------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);

  // Formant frequencies (Hz) of the mouth shapes for each vowel: what makes "ah" sound unlike "oo".
  const VOWELS = { a: [800, 1150, 2900], e: [450, 1800, 2600], i: [300, 2300, 3000], o: [480, 820, 2800], u: [330, 750, 2400] };
  const FORMANT_LEVELS = [1, 0.5, 0.25];

  // Three resonant band-pass filters in parallel turn a buzzy tone into a vowel.
  function formants(ctx, input, out, vowel, t) {
    return VOWELS[vowel].map((freq, i) => {
      const bp = ctx.createBiquadFilter(), g = ctx.createGain();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, t);
      bp.Q.value = freq / 90;
      g.gain.value = FORMANT_LEVELS[i];
      input.connect(bp).connect(g).connect(out);
      return bp;
    });
  }

  // Slides the mouth to another vowel by time `at` ("mee" -> "ow").
  function toVowel(bank, vowel, at) {
    bank.forEach((bp, i) => bp.frequency.linearRampToValueAtTime(VOWELS[vowel][i], at));
  }

  let noiseBuffer = null;
  function noise(ctx) {
    if (!noiseBuffer) {
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    return src;
  }

  function choirVoice(ctx, f, vel, dest, t) {  // three slightly detuned singers, vibrato easing in
    const mix = ctx.createGain(), out = ctx.createGain(), amp = ctx.createGain();
    const oscs = [-7, 0, 6].map(c => { const o = osc(ctx, 'sawtooth', f); o.detune.value = c; o.connect(mix); return o; });
    const vib = osc(ctx, 'sine', 5.3), vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(f * 0.006, t + 0.5);
    vib.connect(vibDepth);
    oscs.forEach(o => vibDepth.connect(o.frequency));
    formants(ctx, mix, out, f > 600 ? 'o' : 'a', t);  // high notes round off toward "oh", like real singers
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.12);
    out.connect(amp).connect(dest);
    return startVoice([...oscs, vib], amp, t, 0.15);
  }

  let robotWord = 0;
  function robotVoice(ctx, f, vel, dest, t) {  // square-wave "bee-boo" vowels, ring-modulated
    const vowels = ['i', 'o', 'a', 'u', 'e'];
    const src = osc(ctx, 'square', f), mouth = ctx.createGain(), ring = ctx.createGain(), amp = ctx.createGain();
    src.connect(mouth);
    const bank = formants(ctx, mouth, ring, vowels[robotWord % 5], t);
    toVowel(bank, vowels[++robotWord % 5], t + 0.25);
    ring.gain.value = 0;  // multiplied by a 40 Hz wave: the classic sci-fi robot buzz
    const mod = osc(ctx, 'sine', 40);
    mod.connect(ring.gain);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.01);
    ring.connect(amp).connect(dest);
    return startVoice([src, mod], amp, t, 0.05);
  }

  function meowVoice(ctx, f, vel, dest, t) {  // "mee-ow": pitch scoops up then sags, mouth i -> a -> u
    const src = osc(ctx, 'sawtooth', f), mouth = ctx.createGain(), out = ctx.createGain(), amp = ctx.createGain();
    src.frequency.setValueAtTime(f * 0.88, t);
    src.frequency.linearRampToValueAtTime(f * 1.05, t + 0.18);
    src.frequency.linearRampToValueAtTime(f * 0.9, t + 0.6);
    src.connect(mouth);
    const bank = formants(ctx, mouth, out, 'i', t);
    toVowel(bank, 'a', t + 0.18);
    toVowel(bank, 'u', t + 0.55);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.5, t + 0.06);  // soft "m"
    amp.gain.linearRampToValueAtTime(vel, t + 0.16);
    amp.gain.setTargetAtTime(0, t + 0.45, 0.12);  // a meow ends on its own
    out.connect(amp).connect(dest);
    return startVoice([src], amp, t, 0.08);
  }

  function quackVoice(ctx, f, vel, dest, t) {  // short nasal "kwah" with a falling pitch
    const a = osc(ctx, 'sawtooth', f), b = osc(ctx, 'square', f * 1.01);
    const mouth = ctx.createGain(), out = ctx.createGain(), amp = ctx.createGain();
    for (const o of [a, b]) {
      o.frequency.setValueAtTime(f * 1.15, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 0.18);
      o.connect(mouth);
    }
    const bank = formants(ctx, mouth, out, 'u', t);
    toVowel(bank, 'a', t + 0.05);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.01);
    amp.gain.setTargetAtTime(0, t + 0.12, 0.05);
    out.connect(amp).connect(dest);
    return startVoice([a, b], amp, t, 0.03);
  }

  function fartVoice(ctx, f, vel, dest, t) {  // pfffrrt: a wobbly low buzz that sputters, plus air
    const base = f / 2;  // an octave down for rumble; the tune still comes through
    const src = osc(ctx, 'sawtooth', base);
    const wobble = osc(ctx, 'sine', rand(5, 9)), wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = base * 0.08;
    wobble.connect(wobbleDepth).connect(src.frequency);
    const air = noise(ctx), airFilter = ctx.createBiquadFilter(), airLevel = ctx.createGain();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 400;
    airLevel.gain.value = 0.15;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 700;
    tone.Q.value = 5;
    src.connect(tone);
    air.connect(airFilter).connect(airLevel).connect(tone);
    const sputter = ctx.createGain(), flap = osc(ctx, 'square', rand(16, 30)), flapDepth = ctx.createGain();
    sputter.gain.value = 0.5;  // 0.5 +/- 0.5: the flapping
    flapDepth.gain.value = 0.5;
    flap.connect(flapDepth).connect(sputter.gain);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.03);
    tone.connect(sputter).connect(amp).connect(dest);
    const parts = [src, wobble, air, flap];
    parts.forEach(p => p.start(t));
    return {
      release(t2) {  // the pitch droops as it trails off
        src.frequency.cancelAndHoldAtTime(t2);
        src.frequency.exponentialRampToValueAtTime(base * 0.6, t2 + 0.3);
        amp.gain.cancelAndHoldAtTime(t2);
        amp.gain.setTargetAtTime(0, t2 + 0.05, 0.08);
        parts.forEach(p => p.stop(t2 + 0.8));
      },
    };
  }

  function startVoice(oscs, amp, t, releaseTc) {
    oscs.forEach(o => o.start(t));
    return {
      release(t2) {
        amp.gain.cancelAndHoldAtTime(t2);
        amp.gain.setTargetAtTime(0, t2, releaseTc);
        oscs.forEach(o => o.stop(t2 + releaseTc * 8));
      },
    };
  }

  // ---- Effects ------------------------------------------------------------------------------
  function makeImpulse(ctx, seconds, decay) {
    const len = Math.round(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  // Tube-ish soft clip, slightly asymmetric so it adds some even harmonics.
  function driveCurve(k) {
    const n = 4096, curve = new Float32Array(n), bias = 0.1;
    const norm = Math.tanh(k * (1 + bias)) - Math.tanh(k * bias);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      curve[i] = (Math.tanh(k * (x + bias)) - Math.tanh(k * bias)) / norm;
    }
    return curve;
  }

  // Modulated short delay mixed with the dry signal. rate < 2 Hz is chorus; ~6 Hz is a rotary speaker.
  function chorus(ctx, input, rate) {
    const out = ctx.createGain(), wet = ctx.createDelay(0.05), lfo = osc(ctx, 'sine', rate), depth = ctx.createGain();
    wet.delayTime.value = rate > 2 ? 0.004 : 0.014;
    depth.gain.value = rate > 2 ? 0.0012 : 0.004;
    lfo.connect(depth).connect(wet.delayTime);
    lfo.start();
    input.connect(out);
    input.connect(wet).connect(out);
    return out;
  }

  function tremolo(ctx, input, depthAmt, rate = 4.5) {
    const out = ctx.createGain(), lfo = osc(ctx, 'sine', rate), depth = ctx.createGain();
    out.gain.value = 1 - depthAmt;
    depth.gain.value = depthAmt;
    lfo.connect(depth).connect(out.gain);
    lfo.start();
    input.connect(out);
    return out;
  }

  // Guitar amp: tighten the lows, overdrive, then a mid hump and a speaker-cabinet rolloff.
  function ampRig(ctx, input) {
    const chain = [
      Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }),
      ctx.createGain(),
      ctx.createWaveShaper(),
      Object.assign(ctx.createBiquadFilter(), { type: 'peaking' }),
      Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' }),
      Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }),
    ];
    const [tight, pre, shaper, mids, cab, lowCut] = chain;
    tight.frequency.value = 140;
    pre.gain.value = 9;
    shaper.curve = driveCurve(3.2);
    shaper.oversample = '4x';
    mids.frequency.value = 800; mids.Q.value = 0.9; mids.gain.value = 5;
    cab.frequency.value = 4800; cab.Q.value = 0.8;
    lowCut.frequency.value = 90;
    let node = input;
    for (const n of chain) node = node.connect(n);
    return node;
  }

  // ---- Engine -------------------------------------------------------------------------------
  const synth = {
    patches: PATCHES,
    index: Math.max(0, PATCHES.findIndex(p => p.id === (localStorage.getItem('dkb-patch') || 'lead'))),
    ctx: null,
    analyser: null,
    voices: new Map(),  // note -> oscillator voice (pluck voices live in the worklet)
    starting: null,

    get patch() { return PATCHES[this.index]; },
    // True when the browser is actually making sound (so MIDI shouldn't also go to the keyboard).
    get audible() { return this.patch.id !== 'off' && !!this.ctx && this.ctx.state === 'running' && !!this.pluck; },
    get needsGesture() { return this.patch.id !== 'off' && (!this.ctx || this.ctx.state !== 'running'); },

    // Browsers only allow audio to start from a click or key press, so this is called from those.
    start() {
      if (!this.starting) this.starting = this.init().catch(err => console.error('synth init failed', err));
      return this.starting.then(() => this.ctx.state !== 'running' && this.ctx.resume());
    },

    async init() {
      const ctx = this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const masterIn = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      this.analyser = Object.assign(ctx.createAnalyser(), { fftSize: 4096, smoothingTimeConstant: 0.6 });
      masterIn.connect(comp).connect(master).connect(this.analyser).connect(ctx.destination);

      this.delay = ctx.createDelay(1);
      this.delay.delayTime.value = 0.38;
      const fb = ctx.createGain(), tone = ctx.createBiquadFilter();
      fb.gain.value = 0.32;
      tone.type = 'lowpass'; tone.frequency.value = 3000;
      this.delay.connect(tone).connect(fb).connect(this.delay);
      tone.connect(masterIn);
      this.reverb = Object.assign(ctx.createConvolver(), { buffer: makeImpulse(ctx, 2.8, 3) });
      this.reverb.connect(masterIn);
      this.masterIn = masterIn;

      await ctx.audioWorklet.addModule('pluck-worklet.js');
      this.pluck = new AudioWorkletNode(ctx, 'pluck', { numberOfInputs: 0, outputChannelCount: [1] });
      for (const p of PATCHES) if (p.id !== 'off') this.buildBus(p);
    },

    // Per-patch effect chain: source -> (amp / chorus / tremolo) -> level -> master, + delay/reverb sends.
    buildBus(p) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      let node = input;
      if (p.drive) node = ampRig(ctx, node);
      else if (p.kind === 'pluck') {  // clean DI-ish guitar: trim the boom and the fizz
        const hp = Object.assign(ctx.createBiquadFilter(), { type: 'highpass' });
        const lp = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' });
        hp.frequency.value = 90; lp.frequency.value = 6500;
        node = node.connect(hp).connect(lp);
      }
      if (p.chorus) node = chorus(ctx, node, p.chorus);
      if (p.tremolo) node = tremolo(ctx, node, p.tremolo, p.id === 'organ' ? 6.5 : 4.5);
      const level = ctx.createGain();
      level.gain.value = 0;  // only the selected patch is open
      node.connect(level).connect(this.masterIn);
      for (const [send, amt] of [[this.delay, p.delay], [this.reverb, p.reverb]]) {
        if (!amt) continue;
        const g = ctx.createGain();
        g.gain.value = amt;
        level.connect(g).connect(send);
      }
      if (p.kind === 'pluck') this.pluck.connect(input);
      p.bus = { input, level };
      if (p === this.patch) level.gain.value = p.gain;
    },

    setPatch(i) {
      this.allOff();
      this.index = (i + PATCHES.length) % PATCHES.length;
      localStorage.setItem('dkb-patch', this.patch.id);
      if (!this.ctx || !this.pluck) return;
      const t = this.ctx.currentTime;
      for (const p of PATCHES) p.bus?.level.gain.setTargetAtTime(p === this.patch ? p.gain : 0, t, 0.02);
    },

    noteOn(n, vel = 1) {
      if (!this.audible) return;
      const p = this.patch;
      if (p.kind === 'pluck') {
        this.pluck.port.postMessage({ type: 'on', note: n, vel, sustain: p.sustain, vib: p.vib, bright: p.bright });
      } else {
        this.noteOff(n);
        this.voices.set(n, p.voice(this.ctx, freqOf(n), vel * 0.8, p.bus.input, this.ctx.currentTime));
      }
    },

    noteOff(n) {
      if (!this.pluck) return;
      this.pluck.port.postMessage({ type: 'off', note: n });
      const v = this.voices.get(n);
      if (v) { v.release(this.ctx.currentTime); this.voices.delete(n); }
    },

    allOff() {
      if (!this.pluck) return;
      this.pluck.port.postMessage({ type: 'allOff' });
      for (const n of [...this.voices.keys()]) this.noteOff(n);
    },
  };

  window.synth = synth;
})();
