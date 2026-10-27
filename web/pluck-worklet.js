// Polyphonic Karplus-Strong plucked strings for the guitar patches. Each voice is a noise burst
// circulating in a delay line one period long, softened a little on every pass like a real string.
// Messages: { type: 'on', note, vel, sustain, vib, bright } | { type: 'off', note } | { type: 'allOff' }
class PluckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.port.onmessage = e => {
      const m = e.data;
      if (m.type === 'on') this.noteOn(m);
      else if (m.type === 'off') this.voices.forEach(v => { if (v.note === m.note) v.released = true; });
      else if (m.type === 'allOff') this.voices.forEach(v => { v.released = true; });
    };
  }

  noteOn({ note, vel, sustain, vib, bright }) {
    this.voices.forEach(v => { if (v.note === note) v.released = true; });
    if (this.voices.length >= 16) this.voices.shift();
    const period = sampleRate / (440 * 2 ** ((note - 69) / 12));
    this.voices.push({
      note, period, vib, bright,
      rho: sustain,                                 // per-pass loss: closer to 1 rings longer
      buf: new Float32Array(Math.ceil(period * 1.05) + 4),  // headroom for vibrato bending the pitch down
      w: 0, last: 0, lp: 0, age: 0, gain: 1, released: false,
      excite: Math.ceil(period), amp: vel * 0.6,
    });
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    out.fill(0);
    const relMul = Math.exp(-1 / (0.03 * sampleRate));  // ~30 ms fade after release (finger mute)
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi];
      const size = v.buf.length;
      for (let i = 0; i < out.length; i++) {
        v.age++;
        let p = v.period;
        if (v.vib > 0) {  // vibrato fades in after the note has been held a moment
          const t = v.age / sampleRate;
          const depth = v.vib * Math.min(1, Math.max(0, (t - 0.35) / 0.6));
          p /= 2 ** (depth * Math.sin(2 * Math.PI * 5.5 * t) / 12);
        }
        let rp = v.w - (p - 0.5);  // the two-point average below adds half a sample of delay
        while (rp < 0) rp += size;
        const i0 = Math.floor(rp) % size, frac = rp - Math.floor(rp);
        const y = v.buf[i0] * (1 - frac) + v.buf[(i0 + 1) % size] * frac;
        let x = 0;
        if (v.excite > 0) {  // pick attack: low-passed noise, darker for smaller `bright`
          v.lp += v.bright * ((Math.random() * 2 - 1) - v.lp);
          x = v.lp * v.amp;
          v.excite--;
        }
        v.buf[v.w] = x + v.rho * 0.5 * (y + v.last);
        v.last = y;
        v.w = (v.w + 1) % size;
        if (v.released) v.gain *= relMul;
        out[i] += y * v.gain;
      }
      if (v.gain < 1e-4 || v.age > sampleRate * 20) this.voices.splice(vi, 1);
    }
    return true;
  }
}

registerProcessor('pluck', PluckProcessor);
