// Turns music pasted from the web into notes for "My Songs": guitar or bass tabs, piano tabs
// (octave lines like 5|--c-d-e--|), chord sheets ([G]words or chords above lyrics), letter notes
// (E D C D E E E), Neon Keys lesson notation, and Standard MIDI Files. Every parser returns notes as { n, t, dur } with t/dur in beats.
// Exposes window.songImport.
'use strict';

(() => {
  const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const GUITAR = [64, 59, 55, 50, 45, 40];  // standard tuning, high e (top line) to low E
  const BASS = [43, 38, 33, 28];

  const mostCommon = xs => {
    const counts = new Map();
    for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  };

  // Tabs carry no rhythm, only spacing: the most common gap between notes becomes one beat.
  function columnsToBeats(events) {
    const cols = [...new Set(events.map(e => e.col))].sort((a, b) => a - b);
    const gaps = cols.slice(1).map((c, i) => c - cols[i]);
    const unit = mostCommon(gaps) || 2;
    const beatAt = new Map();
    let t = 0;
    cols.forEach((c, i) => {
      if (i > 0) t += Math.min(4, Math.max(0.25, gaps[i - 1] / unit));
      beatAt.set(c, Math.round(t * 4) / 4);
    });
    return events.map(e => {
      const i = cols.indexOf(e.col);
      const dur = i + 1 < cols.length ? beatAt.get(cols[i + 1]) - beatAt.get(e.col) : 1;
      return { n: e.n, t: beatAt.get(e.col), dur: Math.max(0.25, dur) };
    });
  }

  // Groups consecutive lines that `match` returns something for; blank or other lines end a block.
  function blocks(lines, match) {
    const out = [];
    let cur = [];
    for (const line of lines) {
      const m = match(line);
      if (m) cur.push(m);
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // ---- Guitar / bass tab ----------------------------------------------------------------------
  function tabLine(line) {
    const m = /^\s*([A-Ga-g][#b]?)?\s*[|:]?(.*)$/.exec(line);
    const body = m[2];
    if ((body.match(/-/g) || []).length < 3 || /[^-0-9|hpbrsxtvHPBRSXTV/\\~()*.=<>^\s]/.test(body)) return null;
    return { label: m[1] || '', body };
  }

  function parseGuitarTab(text) {
    const events = [];
    let offset = 0;
    for (const block of blocks(text.split('\n'), tabLine)) {
      if (block.length !== 6 && block.length !== 4) continue;
      const tuning = block.length === 6 ? GUITAR : BASS;
      block.forEach((line, s) => {
        let open = tuning[s];
        if (line.label) {  // a labelled string in another tuning (e.g. drop D): nearest pitch with that name
          const pc = (LETTER[line.label[0].toLowerCase()] + (line.label[1] === '#' ? 1 : line.label[1] === 'b' ? -1 : 0) + 12) % 12;
          open += ((pc - (open % 12) + 18) % 12) - 6;
        }
        const b = line.body;
        for (let j = 0; j < b.length; j++) {
          if (!/\d/.test(b[j]) || (j > 0 && /\d/.test(b[j - 1]))) continue;
          let fret = Number(b[j]);
          if (/\d/.test(b[j + 1] || '') && fret * 10 + Number(b[j + 1]) <= 24) fret = fret * 10 + Number(b[j + 1]);
          events.push({ col: offset + j, n: open + fret });
        }
      });
      offset += Math.max(...block.map(l => l.body.length)) + 4;
    }
    return events.length ? columnsToBeats(events) : null;
  }

  // ---- Piano tab: one line per octave, lowercase naturals, uppercase sharps ---------------------
  function pianoLine(line) {
    const m = /^\s*(?:[RL]H\s*:?\s*)?([1-7])\s*[|:](.*)$/.exec(line);
    if (!m || (m[2].match(/-/g) || []).length < 3 || /[^-a-gA-G|\s]/.test(m[2])) return null;
    return { octave: Number(m[1]), body: m[2] };
  }

  function parsePianoTab(text) {
    const events = [];
    let offset = 0;
    for (const block of blocks(text.split('\n'), pianoLine)) {
      for (const line of block) {
        [...line.body].forEach((ch, j) => {
          const pc = LETTER[ch.toLowerCase()];
          if (pc === undefined) return;
          events.push({ col: offset + j, n: 12 * (line.octave + 1) + pc + (ch === ch.toUpperCase() ? 1 : 0) });
        });
      }
      offset += Math.max(...block.map(l => l.body.length)) + 4;
    }
    return events.length ? columnsToBeats(events) : null;
  }

  // ---- Neon Keys lesson notation (E4 D4/2 C4+E4 r ...) -----------------------------------------
  function parseNotationText(text) {
    const tokens = text.split(/\s+/).filter(Boolean);
    const ok = tok => tok === '|' || /^(r|[A-G][#b]?-?\d(\+[A-G][#b]?-?\d)*)(\/[\d.]+)?$/.test(tok);
    if (!tokens.length || !tokens.every(ok) || !tokens.some(tok => /\d/.test(tok))) return null;
    return parseNotation(text, 0, 'R').notes.map(({ n, t, dur }) => ({ n, t, dur }));
  }

  // ---- Letter notes: E D C D E E E, octave digits optional, '-' holds a note longer --------------
  function parseLetters(text) {
    const notes = [];
    let t = 0, prev = 60;
    const isNote = tok => /^[A-Ga-g][#b]?\d?[-_.]*$/.test(tok) || /^[-_.]+$/.test(tok);
    for (const raw of text.split('\n')) {
      const tokens = raw.trim().split(/[\s,|]+/).filter(Boolean);
      if (!tokens.length) { if (notes.length) t += 2; continue; }        // blank line = phrase break
      if (tokens.filter(isNote).length < tokens.length * 0.7) continue;  // a lyric or chord-name line
      for (const tok of tokens) {
        if (/^[-_.]+$/.test(tok)) {  // a lone dash holds the last note
          if (notes.length) { notes[notes.length - 1].dur += tok.length; t += tok.length; }
          continue;
        }
        const m = /^([A-Ga-g])([#b]?)(\d?)([-_.]*)$/.exec(tok);
        if (!m) continue;
        const step = LETTER[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
        // no octave given: pick the one closest to the previous note, so the tune moves naturally
        const n = m[3] ? 12 * (Number(m[3]) + 1) + step : prev + ((((step % 12) + 12 - (prev % 12)) + 18) % 12) - 6;
        const dur = 1 + m[4].length;
        notes.push({ n, t, dur });
        t += dur;
        prev = n;
      }
    }
    return notes.length ? notes : null;
  }

  // ---- Chord sheets: [G]words [Am]more words, or chord names on a line above the words ----------
  const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const QUALITY = {
    '': [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], 5: [0, 7], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
    7: [0, 4, 7, 10], 9: [0, 4, 7, 10], 11: [0, 4, 7, 10], 13: [0, 4, 7, 10], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11],
    m7: [0, 3, 7, 10], min7: [0, 3, 7, 10], m9: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9],
    aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], '7sus4': [0, 5, 7, 10], add9: [0, 4, 7], madd9: [0, 3, 7],
  };
  const CHORD_RE = /^([A-G])([#b]?)(maj7|maj9|maj|min7|min|m7b5|madd9|m7|m9|m6|m|dim7|dim|aug|7sus4|sus2|sus4|sus|add9|13|11|9|7|6|5)?(?:\/([A-G])([#b]?))?$/;
  const pcOf = (letter, acc) => (LETTER[letter.toLowerCase()] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;

  function chordInfo(sym) {
    const m = CHORD_RE.exec(sym);
    if (!m) return null;
    return { root: pcOf(m[1], m[2]), quality: m[3] || '', tones: QUALITY[m[3] || ''],
             bass: m[4] ? pcOf(m[4], m[5]) : null, flats: sym.includes('b') && !sym.startsWith('b') };
  }

  // Chord name after transposing, spelled with flats if the sheet used flats.
  function chordName(c, semitones = 0) {
    const names = c.flats ? NAMES_FLAT : NAMES_SHARP;
    const root = names[(c.root + semitones + 120) % 12];
    return root + c.quality + (c.bass !== null ? '/' + names[(c.bass + semitones + 120) % 12] : '');
  }

  const isChordLine = line => {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    return toks.length > 0 && toks.every(t => chordInfo(t) || /^[|/%x.-]+$/i.test(t)) && toks.some(t => chordInfo(t));
  };

  // Returns [{ chord, words, line }] in order, or null if the text doesn't look like a chord sheet.
  // `force`: the user said it's chords, so plain chord lines (C G F) count even with no hints.
  function readChordSheet(text, force) {
    const lines = text.split('\n');
    const seq = [];
    let line = 0, hints = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const inline = [...raw.matchAll(/\[([^\]]+)\]/g)].filter(m => chordInfo(m[1].trim()));
      if (inline.length) {  // [G]Twinkle twinkle [C]little star
        hints += inline.length;
        const parts = raw.split(/\[([^\]]+)\]/);
        if (parts[0].trim() && seq.length) seq[seq.length - 1].words += ' ' + parts[0].trim();
        for (let k = 1; k < parts.length; k += 2) {
          const chord = chordInfo(parts[k].trim());
          if (chord) seq.push({ chord, words: (parts[k + 1] || '').trim(), line });
          else if (seq.length && parts[k + 1]?.trim()) seq[seq.length - 1].words += ' ' + parts[k + 1].trim();
        }
        line++;
      } else if (isChordLine(raw)) {  // chord names above the words they go with
        const cols = [...raw.matchAll(/\S+/g)].filter(m => chordInfo(m[0]));
        const next = lines[i + 1] ?? '';
        const lyric = next.trim() && !isChordLine(next) && !/\[/.test(next) ? next : '';
        if (lyric) i++;
        cols.forEach((m, j) => {
          const chord = chordInfo(m[0]);
          // Am, G7, D/F# can't be melody notes; plain letters, sharps and C5/C6 (octave numbers) can
          if ((chord.quality && !/^[56]$/.test(chord.quality)) || chord.bass !== null) hints++;
          // chords sit over a syllable; split the words at the start of that word instead
          const wordStart = col => { while (col > 0 && /\S/.test(lyric[col - 1] || '')) col--; return col; };
          const from = j === 0 ? 0 : wordStart(m.index), to = j + 1 < cols.length ? wordStart(cols[j + 1].index) : undefined;
          seq.push({ chord, words: lyric ? lyric.slice(from, to).trim() : '', line });
        });
        line++;
      }
    }
    // Plain letter lines (E D C D) are also valid chord names, so auto-detect needs a real hint.
    return seq.length && (force || hints >= 1) ? seq : null;
  }

  // Right-hand voicings, each kept close to the last so the hand barely moves.
  function voiceChords(seq, beatsPerChord) {
    let center = 62;
    const notes = [];
    seq.forEach((item, i) => {
      const { root, tones, bass } = item.chord;
      const pcs = tones.slice(0, 4).map(iv => (root + iv) % 12);
      let best = null;
      for (let inv = 0; inv < pcs.length; inv++) {  // each inversion, stacked upward from near the center
        const order = pcs.slice(inv).concat(pcs.slice(0, inv));
        for (const base of [48, 60]) {
          const voicing = [];
          let n = base + order[0];
          for (const pc of order) { while (n % 12 !== pc) n++; voicing.push(n); n++; }
          const avg = voicing.reduce((a, b) => a + b, 0) / voicing.length;
          if (voicing[0] < 53 || voicing[voicing.length - 1] > 79) continue;
          if (!best || Math.abs(avg - center) < best.dist) best = { voicing, dist: Math.abs(avg - center) };
        }
      }
      const t = i * beatsPerChord;
      best.voicing.forEach((n, k) => notes.push({ n, t, dur: beatsPerChord, ...(k === 0 ? { chord: item } : {}) }));
      if (bass !== null) {  // a slash chord's bass note, below the chord
        let n = 48 + bass;
        while (n >= best.voicing[0]) n -= 12;
        notes.push({ n, t, dur: beatsPerChord });
      }
      center = best.voicing.reduce((a, b) => a + b, 0) / best.voicing.length;
    });
    return notes;
  }

  // Tries each text format; tabs win because pages with tabs also contain stray words and letters.
  // opts.kind: 'auto' | 'melody' | 'chords'; opts.beatsPerChord: how long each chord lasts.
  function parseMusic(text, opts = {}) {
    const kind = opts.kind || 'auto';
    if (kind !== 'melody') {
      const seq = readChordSheet(text, kind === 'chords');
      if (seq) return { format: 'chord sheet', notes: voiceChords(seq, opts.beatsPerChord || 4), chords: seq };
      if (kind === 'chords') return { format: null, notes: [] };
    }
    for (const [format, parse] of [['guitar tab', parseGuitarTab], ['piano tab', parsePianoTab],
                                   ['Neon Keys notes', parseNotationText], ['letter notes', parseLetters]]) {
      const notes = parse(text);
      if (notes?.length) return { format, notes };
    }
    return { format: null, notes: [] };
  }

  // ---- Standard MIDI File -----------------------------------------------------------------------
  function parseMidiFile(buf) {
    const d = new DataView(buf);
    const tag = at => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));
    if (buf.byteLength < 14 || tag(0) !== 'MThd') throw new Error('that file is not a MIDI file');
    const tracks = d.getUint16(10), division = d.getUint16(12);
    if (division & 0x8000) throw new Error('this MIDI file uses SMPTE timing, which is not supported');
    let p = 8 + d.getUint32(4), tempo = null;
    const notes = [];
    const readVar = () => { let v = 0, c; do { c = d.getUint8(p++); v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    for (let tr = 0; tr < tracks && p + 8 <= buf.byteLength; tr++) {
      const id = tag(p), end = Math.min(buf.byteLength, p + 8 + d.getUint32(p + 4));
      p += 8;
      if (id !== 'MTrk') { p = end; continue; }
      let tick = 0, running = 0;
      const open = new Map();  // channel*128+note -> start tick
      while (p < end) {
        tick += readVar();
        let status = d.getUint8(p);
        if (status >= 0xf0) {  // meta and sysex (these don't change running status)
          p++;
          if (status === 0xff) {
            const type = d.getUint8(p++), len = readVar();
            if (type === 0x51 && tempo === null) tempo = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
            p += len;
          } else p += readVar();
          continue;
        }
        if (status & 0x80) { running = status; p++; } else status = running;
        const type = status & 0xf0, ch = status & 0x0f;
        const a = d.getUint8(p++), b = type === 0xc0 || type === 0xd0 ? 0 : d.getUint8(p++);
        if (ch === 9) continue;  // drums
        const key = ch * 128 + a;
        if (type === 0x90 && b > 0) open.set(key, tick);
        else if ((type === 0x80 || type === 0x90) && open.has(key)) {
          const start = open.get(key);
          open.delete(key);
          notes.push({ n: a, t: Math.round(start / division * 48) / 48, dur: Math.max(1 / 48, Math.round((tick - start) / division * 48) / 48) });
        }
      }
      p = end;
    }
    notes.sort((x, y) => x.t - y.t || x.n - y.n);
    return { notes, bpm: tempo ? Math.round(60e6 / tempo) : 120 };
  }

  // ---- Clean-up ---------------------------------------------------------------------------------
  // Keeps only the top note at each moment: the tune, for arrangements with chords and bass.
  function melodyOnly(notes) {
    const top = new Map();
    for (const nt of notes) if (!top.has(nt.t) || nt.n > top.get(nt.t).n) top.set(nt.t, nt);
    return [...top.values()].sort((a, b) => a.t - b.t);
  }

  // Transposes, then shifts whole octaves to fit the keyboard (C2-C7) when possible.
  function fitToKeyboard(notes, semitones, low = 36, high = 96) {
    let moved = notes.map(nt => ({ ...nt, n: nt.n + semitones }));
    let shift = 0;
    if (moved.length) {
      const lo = Math.min(...moved.map(nt => nt.n)), hi = Math.max(...moved.map(nt => nt.n));
      if (lo < low) shift = Math.ceil((low - lo) / 12) * 12;
      else if (hi > high) shift = -Math.ceil((hi - high) / 12) * 12;
      moved = moved.map(nt => {
        let n = nt.n + shift;
        while (n < low) n += 12;  // a song wider than the keyboard: fold the stragglers in
        while (n > high) n -= 12;
        return { ...nt, n };
      });
    }
    // the same key twice at the same moment (unison strings, folded octaves) can't both be pressed
    const seen = new Set();
    moved = moved.filter(nt => { const k = `${nt.n}@${nt.t}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { notes: moved, octaveShift: shift / 12 };
  }

  window.songImport = { parseMusic, parseMidiFile, melodyOnly, fitToKeyboard, chordName };
})();
