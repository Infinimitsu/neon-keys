// "My Songs": songs added by pasting tabs or letter notes (or opening a MIDI file) in the song
// editor. They're saved in this browser profile (so each user has their own) and appear in the
// lessons menu like the built-in songs. Loaded after tutor.js, before app.js.
'use strict';

const songs = {
  KEY: 'dkb-songs',
  list: [],       // what the user typed: { id, title, bpm, transpose, melodyOnly, music, lyrics, midi }
  editing: null,  // the saved song being edited, or null for a new one
  midi: null,     // { name, notes, bpm, kind? } from an opened MIDI file, or kind 'recording'
  rec: null,      // while recording: { start, open: note -> start second, notes }

  el: id => document.getElementById(id),

  load() {
    try { this.list = JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { this.list = []; }
    this.sync();
  },

  store() {
    localStorage.setItem(this.KEY, JSON.stringify(this.list));
    this.sync();
  },

  // Replaces the "My Songs" entries in LESSONS with the current list.
  sync() {
    for (let i = LESSONS.length - 1; i >= 0; i--) if (LESSONS[i].custom) LESSONS.splice(i, 1);
    for (const song of this.list) {
      const { lesson } = this.build(song);
      if (lesson.notes.length) LESSONS.push(lesson);
    }
  },

  // Parses a song into a playable lesson, plus details for the editor's status line.
  build(song) {
    const transpose = Number(song.transpose) || 0;
    const parsed = song.midi
      ? { format: song.midi.kind === 'recording' ? 'your recording' : 'MIDI file', notes: song.midi.notes }
      : songImport.parseMusic(song.music || '', { kind: song.kind, beatsPerChord: Number(song.chordBeats) || 4 });
    const notes = song.melodyOnly ? songImport.melodyOnly(parsed.notes) : parsed.notes;
    const fit = songImport.fitToKeyboard(notes, transpose);
    let lyrics = (song.lyrics || '').split('\n').map(l => l.trim()).filter(Boolean).join(' / ');
    if (!lyrics && parsed.chords) lyrics = this.chordLyrics(parsed.chords, transpose);
    return {
      parsed, fit,
      lesson: {
        id: song.id, group: 'My Songs', title: song.title || 'Untitled song', bpm: Number(song.bpm) || 90,
        say: 'Your song! Press Listen first to hear how it goes.',
        notes: fit.notes.map(nt => ({ ...nt, hand: 'R' })), lyrics, custom: true,
      },
    };
  },

  // A chord sheet's karaoke: one "[G] words" chunk per chord, keeping the sheet's lines. Spaces and
  // hyphens become non-breaking so each chunk stays a single lyric "syllable".
  chordLyrics(chords, transpose) {
    const lines = [];
    for (const { chord, words, line } of chords) {
      const chunk = `[${songImport.chordName(chord, transpose)}]${words ? ' ' + words : ''}`;
      (lines[line] ??= []).push(chunk.replace(/ /g, '\u00a0').replace(/-/g, '\u2011'));
    }
    return lines.filter(Boolean).map(l => l.join(' ')).join(' / ');
  },

  // ---- Editor -------------------------------------------------------------------------------
  open(song = null) {
    this.editing = song;
    this.midi = song?.midi ?? null;
    this.el('ed-heading').textContent = song ? 'EDIT SONG' : 'ADD A SONG';
    this.el('ed-title').value = song?.title ?? '';
    this.el('ed-bpm').value = song?.bpm ?? 90;
    this.el('ed-transpose').value = song?.transpose ?? 0;
    this.el('ed-melody').checked = song?.melodyOnly ?? false;
    this.el('ed-kind').value = song?.kind ?? 'auto';
    this.el('ed-chordbeats').value = song?.chordBeats ?? 4;
    this.el('ed-music').value = song?.music ?? '';
    this.el('ed-lyrics').value = song?.lyrics ?? '';
    this.el('ed-delete').hidden = !song;
    this.loadExamples();
    tutor.closeMenu();
    this.el('editor').classList.add('show');
    this.refresh();
    this.el('ed-title').focus();
  },

  close() {
    this.el('editor').classList.remove('show');
  },

  get isOpen() { return this.el('editor').classList.contains('show'); },

  current() {
    return {
      id: this.editing?.id ?? `song-${Date.now()}`,
      title: this.el('ed-title').value.trim(),
      bpm: Math.min(240, Math.max(30, Number(this.el('ed-bpm').value) || 90)),
      transpose: Math.min(24, Math.max(-24, Number(this.el('ed-transpose').value) || 0)),
      melodyOnly: this.el('ed-melody').checked,
      kind: this.el('ed-kind').value,
      chordBeats: Math.min(16, Math.max(1, Number(this.el('ed-chordbeats').value) || 4)),
      music: this.el('ed-music').value,
      lyrics: this.el('ed-lyrics').value,
      midi: this.midi,
    };
  },

  // Live feedback: what was found in the music, and whether the lyrics line up with the notes.
  refresh() {
    const song = this.current();
    const { parsed, fit, lesson } = this.build(song);
    this.el('ed-midi').textContent = !this.midi ? ''
      : this.midi.kind === 'recording' ? 'Using your recording. Record again, or type in the music box to use text instead.'
      : `Using MIDI file: ${this.midi.name} (type in the music box to use text instead)`;
    const lines = [];
    let ok = lesson.notes.length > 0;
    if (!ok) {
      lines.push(song.music.trim()
        ? 'No notes found in that yet. Paste a guitar tab, a piano tab, or letter notes like E D C D E E E.'
        : 'Paste music into the box above, or open a MIDI file.');
    } else {
      const ns = lesson.notes.map(nt => nt.n);
      let found = `Found ${parsed.format}: ${lesson.notes.length} notes, ${noteName(Math.min(...ns))} to ${noteName(Math.max(...ns))}`;
      if (fit.octaveShift) found += `, moved ${Math.abs(fit.octaveShift)} octave${Math.abs(fit.octaveShift) > 1 ? 's' : ''} ${fit.octaveShift > 0 ? 'up' : 'down'} to fit the keyboard`;
      lines.push(found + '.');
      if (/tab/.test(parsed.format)) lines.push('Tabs only show the order of notes, so the rhythm is a guess - Wait mode works best.');
      if (parsed.chords) {
        const names = [...new Set(parsed.chords.map(c => songImport.chordName(c.chord, song.transpose)))];
        lines[0] = `Found a chord sheet: ${parsed.chords.length} chords to play (${names.join(', ')}).`;
        lines.push('Chord sheets don\'t say how long each chord lasts - set "Beats per chord" by listening to the song.');
        if (!song.lyrics.trim() && parsed.chords.some(c => c.words)) lines.push('The words come from the chord sheet, shown with each chord.');
      }
      if (song.lyrics.trim()) {
        const syllables = parseLyrics(lesson.lyrics).flat().length;
        const onsets = new Set(lesson.notes.map(nt => nt.t)).size;
        lines.push(syllables === onsets ? `Lyrics: ${syllables} syllables for ${onsets} notes - a perfect match!`
          : syllables < onsets ? `Lyrics: ${syllables} syllables for ${onsets} notes - add hyphens to split words (Straw-ber-ry) or add words.`
          : `Lyrics: ${syllables} syllables for ${onsets} notes - ${syllables - onsets} too many; the extras won't show.`);
      }
    }
    this.el('ed-chordbeats-wrap').hidden = !parsed.chords;
    this.el('ed-status').textContent = lines.join('\n');
    this.el('ed-save').disabled = this.el('ed-play').disabled = !ok;
  },

  submit(listen) {
    const song = this.current();
    if (!this.build(song).lesson.notes.length) return;
    if (!song.title) song.title = 'Untitled song';
    const i = this.list.findIndex(s => s.id === song.id);
    if (i >= 0) this.list[i] = song; else this.list.push(song);
    this.store();
    this.close();
    const lesson = LESSONS.find(l => l.id === song.id);
    if (listen) tutor.start(lesson, true);
    else { tutor.menuIndex = LESSONS.indexOf(lesson); tutor.openMenu(); }
  },

  remove() {
    if (!this.editing || !confirm(`Delete "${this.editing.title}"?`)) return;
    this.list = this.list.filter(s => s.id !== this.editing.id);
    localStorage.removeItem('dkb-stars-' + this.editing.id);
    this.store();
    this.close();
    tutor.menuIndex = 0;
    tutor.openMenu();
  },

  // ---- Recording: play the song on the keyboard (or screen keys) and keep its real rhythm ----
  startRecording() {
    if (demo.on) toggleDemo();
    releaseAll();
    document.activeElement?.blur();  // so the computer-keyboard piano works while recording
    this.rec = { start: null, open: new Map(), notes: [] };
    this.el('editor').classList.remove('show');
    document.body.classList.add('recording');
    this.showRecInfo();
  },

  recordOn(n) {
    const r = this.rec;
    if (r.start === null) r.start = clock();  // the clock starts with the first note
    if (r.open.has(n)) this.recordOff(n);
    r.open.set(n, clock() - r.start);
    this.showRecInfo();
  },

  recordOff(n) {
    const r = this.rec;
    if (!r.open.has(n)) return;
    const t = r.open.get(n);
    r.open.delete(n);
    r.notes.push({ n, t, dur: Math.max(0.05, clock() - r.start - t) });
  },

  stopRecording(keep) {
    const r = this.rec;
    for (const n of [...r.open.keys()]) this.recordOff(n);
    this.rec = null;
    document.body.classList.remove('recording');
    releaseAll();
    if (keep && r.notes.length) {
      // seconds -> beats at the editor's tempo, rounded to the nearest sixteenth note
      const bpm = Number(this.el('ed-bpm').value) || 90;
      const beats = sec => Math.round(sec * bpm / 60 * 4) / 4;
      const notes = r.notes.sort((a, b) => a.t - b.t || a.n - b.n)
        .map(nt => ({ n: nt.n, t: beats(nt.t), dur: Math.max(0.25, beats(nt.dur)) }));
      this.midi = { name: 'recording', kind: 'recording', notes, bpm };
      this.el('ed-music').value = '';
      this.el('ed-melody').checked = false;
      this.el('ed-transpose').value = 0;
    }
    this.el('editor').classList.add('show');
    this.refresh();
  },

  showRecInfo() {
    const count = this.rec.notes.length + this.rec.open.size;
    this.el('rec-info').textContent = count
      ? `${count} note${count === 1 ? '' : 's'} so far. Press Stop when the song is done.`
      : 'Play the song on the keyboard. Recording starts with your first note.';
  },

  // ---- Examples (web/samples), one per format, for trying the editor out --------------------
  async loadExamples() {
    if (this.examples) return;
    try { this.examples = await (await fetch('samples/index.json')).json(); } catch { this.examples = []; }
    for (const [i, ex] of this.examples.entries()) {
      this.el('ed-example').append(new Option(`${ex.title} (${ex.kind})`, i));
    }
  },

  async useExample(i) {
    const ex = this.examples[i];
    const get = name => fetch('samples/' + name);
    this.el('ed-title').value = ex.title;
    this.el('ed-lyrics').value = ex.lyrics ? await (await get(ex.lyrics)).text() : '';
    this.el('ed-transpose').value = 0;
    this.el('ed-melody').checked = false;
    this.el('ed-kind').value = 'auto';
    if (/\.midi?$/.test(ex.music)) {
      await this.openFile(new File([await (await get(ex.music)).arrayBuffer()], ex.music));
    } else {
      this.midi = null;
      this.el('ed-music').value = await (await get(ex.music)).text();
    }
    this.el('ed-bpm').value = ex.bpm;
    this.refresh();
  },

  async openFile(file) {
    try {
      if (/\.midi?$/i.test(file.name)) {
        const { notes, bpm } = songImport.parseMidiFile(await file.arrayBuffer());
        if (!notes.length) throw new Error('that MIDI file has no notes (apart from drums)');
        this.midi = { name: file.name, notes, bpm };
        this.el('ed-music').value = '';
        this.el('ed-bpm').value = bpm;
        this.el('ed-melody').checked = true;  // full arrangements are a lot to play; the tune is a good start
      } else {
        this.midi = null;
        this.el('ed-music').value = await file.text();
      }
      if (!this.el('ed-title').value) this.el('ed-title').value = file.name.replace(/\.[^.]+$/, '');
      this.refresh();
    } catch (err) {
      this.el('ed-status').textContent = `Couldn't open ${file.name}: ${err.message}.`;
    }
  },
};

// ---- Wiring --------------------------------------------------------------------------------
songs.el('ed-music').addEventListener('input', () => { songs.midi = null; songs.refresh(); });
for (const id of ['ed-title', 'ed-bpm', 'ed-transpose', 'ed-melody', 'ed-lyrics', 'ed-kind', 'ed-chordbeats']) {
  songs.el(id).addEventListener('input', () => songs.refresh());
}
songs.el('ed-file').addEventListener('click', () => songs.el('ed-file-input').click());
songs.el('ed-record').addEventListener('click', () => songs.startRecording());
songs.el('rec-stop').addEventListener('click', () => songs.stopRecording(true));
songs.el('rec-cancel').addEventListener('click', () => songs.stopRecording(false));
for (const id of ['rec-stop', 'rec-cancel']) songs.el(id).addEventListener('pointerdown', e => e.preventDefault());
songs.el('ed-example').addEventListener('change', e => {
  if (e.target.value !== '') songs.useExample(Number(e.target.value));
  e.target.value = '';
});
songs.el('ed-file-input').addEventListener('change', e => {
  if (e.target.files[0]) songs.openFile(e.target.files[0]);
  e.target.value = '';
});
songs.el('ed-save').addEventListener('click', () => songs.submit(false));
songs.el('ed-play').addEventListener('click', () => songs.submit(true));
songs.el('ed-delete').addEventListener('click', () => songs.remove());
songs.el('ed-cancel').addEventListener('click', () => { songs.close(); tutor.openMenu(); });
songs.el('editor').addEventListener('keydown', e => {
  if (e.key === 'Escape') { songs.close(); tutor.openMenu(); }
});

songs.load();
