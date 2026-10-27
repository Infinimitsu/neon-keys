// Lesson library for tutorial mode. Every song here is public domain.
//
// A lesson is a list of steps: [caption, rightHand, leftHand?, lyrics?]. An empty caption keeps the
// last one. Lyrics give one syllable per right-hand note (hyphens split words into syllables) and
// ' / ' starts a new karaoke line.
// Notation: space-separated tokens NOTE[/beats] (1 beat if omitted). Join notes with '+' for a
// chord, 'r' is a rest, and '|' bar lines are only there for reading. C4 is middle C; sharps
// are written C#4, flats Bb3.
'use strict';

const LESSONS = [
  // ---- Basics ----
  { id: 'middle-c', group: 'Basics', title: 'Find Middle C', bpm: 70, steps: [
    ['Black keys come in groups of 2 and 3. C is the white key just left of each group of 2. Middle C (C4) is the one nearest the center - play it.',
      'C4/2 C4/2 C4/2 C4/2'],
    ['Every group of 2 has a C beside it. Here are the C below middle C (C3) and the C above (C5).',
      'C3/2 C4/2 C5/2 C4/2'],
    ['Your keyboard has six Cs, from C2 at the far left to C7 at the far right. Walk up them all.',
      'C2/2 C3/2 C4/2 C5/2 C6/2 C7/2'],
  ] },
  { id: 'cde', group: 'Basics', title: 'C, D and E', bpm: 75, steps: [
    ['D sits between the two black keys, and E is just right of them. Play C, D, E and back.',
      'C4 D4 E4/2 | E4 D4 C4/2'],
    ['Little patterns with just three notes.', 'C4 D4 E4 C4 | E4 D4 C4/2 | E4 E4 D4 D4 | C4/4'],
    ['The same notes one octave higher.', 'C5 D5 E5/2 | E5 D5 C5/2'],
  ] },
  { id: 'fgab', group: 'Basics', title: 'F, G, A and B', bpm: 75, steps: [
    ['F is the white key just left of the group of 3 black keys. G and A sit inside the group, and B is just right of it.',
      'F4 G4 A4 B4/2 | B4 A4 G4 F4/2'],
    ['The musical alphabet only runs A to G, then starts over. Play A B C D E F G.', 'A3 B3 C4 D4 E4 F4 G4/2'],
    ['Skipping around - read each note as it falls.', 'G4 E4 A4 F4 | B4 G4 C5/2'],
  ] },
  { id: 'scale', group: 'Basics', title: 'The C Major Scale', bpm: 80, steps: [
    ['All the white keys from one C to the next make the C major scale. Up...', 'C4 D4 E4 F4 G4 A4 B4 C5/2'],
    ['...and back down. Keep a steady pulse.', 'C5 B4 A4 G4 F4 E4 D4 C4/2'],
    ['Now with your left hand, one octave lower (left-hand notes have an outline).', '', 'C3 D3 E3 F3 G3 A3 B3 C4/2'],
  ] },
  { id: 'octaves', group: 'Basics', title: 'Octaves', bpm: 70, steps: [
    ['An octave is the next key up with the same name, 8 white keys away. It sounds like the same note, only higher.',
      'C3/2 C4/2 C5/2 C6/2'],
    ['Play both notes of an octave at once - thumb and pinky.', 'C4+C5/2 D4+D5/2 E4+E5/2 G4+G5/2 | C4+C5/4'],
    ['Octaves work for every note. Here are the As, then the Gs.', 'A2 A3 A4 A5/2 | G5 G4 G3 G2/2'],
  ] },
  { id: 'sharps', group: 'Basics', title: 'Sharps and Flats', bpm: 75, steps: [
    ['Black keys are named after their neighbours. The one just right of C is C# (C sharp), which is also Db (D flat).',
      'C4/2 C#4/2 D4/2 D#4/2 E4/2'],
    ['The black keys alone make a pentatonic scale - it is hard to play a wrong note.',
      'C#4 D#4 F#4 G#4 A#4 C#5/2 | A#4 G#4 F#4 D#4 C#4/2'],
    ['Every key in a row, white and black, is the chromatic scale: 12 steps to the octave.',
      'C4/.5 C#4/.5 D4/.5 D#4/.5 E4/.5 F4/.5 F#4/.5 G4/.5 G#4/.5 A4/.5 A#4/.5 B4/.5 C5/2'],
  ] },

  // ---- Chords ----
  { id: 'c-major', group: 'Chords', title: 'Your First Chord: C Major', bpm: 70, steps: [
    ['A major chord is three notes: the root, then skip a white key, twice. C major = C + E + G. Press them together.',
      'C4+E4+G4/2 r/2 C4+E4+G4/2 r/2 C4+E4+G4/4'],
    ['One note at a time, it is a broken chord (an arpeggio).', 'C4 E4 G4 C5 | G4 E4 C4/2'],
    ['Add the root in your left hand, an octave down.', 'C4+E4+G4/2 C4+E4+G4/2 C4+E4+G4/4', 'C3/2 C3/2 C3/4'],
  ] },
  { id: 'f-g', group: 'Chords', title: 'F and G Major', bpm: 70, steps: [
    ['Slide the same shape up: F major = F + A + C.', 'F4+A4+C5/2 r/2 F4+A4+C5/2'],
    ['G major = G + B + D.', 'G4+B4+D5/2 r/2 G4+B4+D5/2'],
    ['C - F - G - C: the most-used chord progression there is.', 'C4+E4+G4/2 F4+A4+C5/2 G4+B4+D5/2 C4+E4+G4/2'],
  ] },
  { id: 'minor', group: 'Chords', title: 'Minor Chords', bpm: 70, steps: [
    ['Lower the middle note of a major chord by one key and it turns minor - darker, sadder. C major, then C minor.',
      'C4+E4+G4/2 C4+Eb4+G4/2 C4+E4+G4/2 C4+Eb4+G4/2'],
    ['Three minor chords on white keys only: A minor (A C E), D minor (D F A), E minor (E G B).',
      'A3+C4+E4/2 D4+F4+A4/2 E4+G4+B4/2 A3+C4+E4/2'],
  ] },
  { id: 'four-chords', group: 'Chords', title: 'The Four-Chord Progression', bpm: 80, steps: [
    ['C, G, A minor, F - the progression under countless pop songs. G and F are rearranged (inversions) so your hand barely moves.',
      'C4+E4+G4/4 B3+D4+G4/4 A3+C4+E4/4 A3+C4+F4/4'],
    ['Again, with each chord\'s root in your left hand.',
      'C4+E4+G4/4 B3+D4+G4/4 A3+C4+E4/4 A3+C4+F4/4', 'C3/4 G2/4 A2/4 F2/4'],
  ] },

  // ---- Songs ----
  { id: 'mary', group: 'Songs', title: 'Mary Had a Little Lamb', bpm: 90, gap: 0, steps: [
    ['Mary Had a Little Lamb - American, 1830. Just C, D, E and G.',
      'E4 D4 C4 D4 | E4 E4 E4/2 | D4 D4 D4/2 | E4 G4 G4/2 | E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4/4', '',
      'Ma-ry had a lit-tle lamb, lit-tle lamb, lit-tle lamb, / Ma-ry had a lit-tle lamb, its fleece was white as snow.'],
  ] },
  { id: 'twinkle', group: 'Songs', title: 'Twinkle Twinkle Little Star', bpm: 90, gap: 0, steps: [
    ['Twinkle Twinkle Little Star - the French tune Mozart wrote variations on.',
      'C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2', '',
      'Twin-kle, twin-kle, lit-tle star, / how I won-der what you are!'],
    ['', 'G4 G4 F4 F4 | E4 E4 D4/2 | G4 G4 F4 F4 | E4 E4 D4/2', '',
      'Up a-bove the world so high, / like a dia-mond in the sky.'],
    ['', 'C4 C4 G4 G4 | A4 A4 G4/2 | F4 F4 E4 E4 | D4 D4 C4/2', '',
      'Twin-kle, twin-kle, lit-tle star, / how I won-der what you are!'],
  ] },
  { id: 'frere', group: 'Songs', title: 'Frère Jacques', bpm: 100, gap: 0, steps: [
    ['Frère Jacques (Are You Sleeping?) - French, 1700s.',
      'C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4/2 | E4 F4 G4/2 | G4/.5 A4/.5 G4/.5 F4/.5 E4 C4 | G4/.5 A4/.5 G4/.5 F4/.5 E4 C4 | C4 G3 C4/2 | C4 G3 C4/2', '',
      'Are you sleep-ing, are you sleep-ing, / Bro-ther John, Bro-ther John? / Morn-ing bells are ring-ing, morn-ing bells are ring-ing, / ding, dang, dong, ding, dang, dong!'],
  ] },
  { id: 'row', group: 'Songs', title: 'Row, Row, Row Your Boat', bpm: 100, beatsPerBar: 3, gap: 0, steps: [
    ['Row, Row, Row Your Boat - American, 1852. It is in 6/8 time, so it rocks like a boat.',
      'C4/1.5 C4/1.5 | C4/1 D4/.5 E4/1.5 | E4/1 D4/.5 E4/1 F4/.5 | G4/3 | C5/.5 C5/.5 C5/.5 G4/.5 G4/.5 G4/.5 | E4/.5 E4/.5 E4/.5 C4/.5 C4/.5 C4/.5 | G4/1 F4/.5 E4/1 D4/.5 | C4/3', '',
      'Row, row, row your boat, gent-ly down the stream. / Mer-ri-ly, mer-ri-ly, mer-ri-ly, mer-ri-ly, / life is but a dream.'],
  ] },
  // Beethoven's words are German, and the usual English ones are a hymn, so these are new.
  { id: 'ode', group: 'Songs', title: 'Ode to Joy', bpm: 100, gap: 0, steps: [
    ['Ode to Joy - Beethoven, Symphony No. 9 (1824). Almost all stepwise: each note is next to the last.',
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/1.5 D4/.5 D4/2', '',
      'Hap-py mu-sic, fill the room now, / ring out loud and clear and bright,'],
    ['', 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/1.5 C4/.5 C4/2', '',
      'ev-\'ry key a lit-tle sun-beam, / play-ing songs from day to night.'],
    ['The middle part jumps around a little more.',
      'D4 D4 E4 C4 | D4 E4/.5 F4/.5 E4 C4 | D4 E4/.5 F4/.5 E4 D4 | C4 D4 G3/2', '',
      'Fin-gers march-ing, up and down the keys, / lis-ten how they sing it out loud!'],
    ['And the main theme one last time.', 'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/1.5 C4/.5 C4/2', '',
      'Hap-py mu-sic, fill the room now, / ev-\'ry-bo-dy sing and play!'],
  ] },
  { id: 'ode-hands', group: 'Songs', title: 'Ode to Joy (Hands Together)', bpm: 80, gap: 0, steps: [
    ['Ode to Joy with a left-hand bass line. Try it in Wait mode first.',
      'E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/1.5 D4/.5 D4/2 | E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/1.5 C4/.5 C4/2',
      'C3/4 | G2/4 | C3/2 E3/2 | G2/4 | C3/4 | G2/4 | C3/2 E3/2 | G2/2 C3/2',
      'Hap-py mu-sic, fill the room now, / ring out loud and clear and bright, / ev-\'ry key a lit-tle sun-beam, / play-ing songs from day to night.'],
  ] },
  { id: 'jingle', group: 'Songs', title: 'Jingle Bells', bpm: 110, gap: 0, steps: [
    ['Jingle Bells - James Lord Pierpont, 1857.',
      'E4 E4 E4/2 | E4 E4 E4/2 | E4 G4 C4/1.5 D4/.5 | E4/4 | F4 F4 F4 F4 | F4 E4 E4 E4/.5 E4/.5 | E4 D4 D4 E4 | D4/2 G4/2', '',
      'Jin-gle bells, jin-gle bells, jin-gle all the way! / Oh, what fun it is to ride in a one-horse o-pen sleigh, hey!'],
    ['', 'E4 E4 E4/2 | E4 E4 E4/2 | E4 G4 C4/1.5 D4/.5 | E4/4 | F4 F4 F4 F4 | F4 E4 E4 E4/.5 E4/.5 | G4 G4 F4 D4 | C4/4', '',
      'Jin-gle bells, jin-gle bells, jin-gle all the way! / Oh, what fun it is to ride in a one-horse o-pen sleigh!'],
  ] },
  { id: 'elise', group: 'Songs', title: 'Für Elise (Opening)', bpm: 110, beatsPerBar: 3, barOffset: 1, gap: 0, steps: [
    ['Für Elise - Beethoven, 1810. The E - D# wiggle is the famous part; your left hand answers with A - E - A.',
      'E5/.5 D#5/.5 | E5/.5 D#5/.5 E5/.5 B4/.5 D5/.5 C5/.5 | A4/1.5 C4/.5 E4/.5 A4/.5 | B4/1.5 E4/.5 G#4/.5 B4/.5 | C5/1.5 E4/.5 E5/.5 D#5/.5 | E5/.5 D#5/.5 E5/.5 B4/.5 D5/.5 C5/.5 | A4/1.5 C4/.5 E4/.5 A4/.5 | B4/1.5 E4/.5 C5/.5 B4/.5 | A4/3',
      'r/1 | r/3 | A2/.5 E3/.5 A3/.5 r/1.5 | E2/.5 E3/.5 G#3/.5 r/1.5 | A2/.5 E3/.5 A3/.5 r/1.5 | r/3 | A2/.5 E3/.5 A3/.5 r/1.5 | E2/.5 E3/.5 G#3/.5 r/1.5 | A2/.5 E3/.5 A3/.5'],
  ] },
];

const NOTE_STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseNote(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  return 12 * (Number(m[3]) + 1) + NOTE_STEPS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function parseNotation(str, start, hand) {
  const notes = [];
  let t = start;
  for (const tok of str.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [pitches, len] = tok.split('/');
    const dur = len ? Number(len) : 1;
    if (pitches !== 'r') for (const p of pitches.split('+')) notes.push({ n: parseNote(p), t, dur, hand });
    t += dur;
  }
  return { notes, end: t };
}

// Splits lyrics into karaoke lines of syllables: 'Twin-kle, twin-kle / how I' ->
// [['Twin-', 'kle,', 'twin-', 'kle'], ['how', 'I']]. A hyphen stays on the syllable it ends.
function parseLyrics(str) {
  // only plain spaces separate syllables: chord-sheet chunks use non-breaking ones to stay whole
  return str.split(' / ').map(line => line.trim().split(/[ \t]+/).flatMap(word =>
    word.split('-').map((part, i, parts) => (i < parts.length - 1 ? part + '-' : part))));
}

// Adds karaoke lines for `lyrics` to `lines`, one syllable per onset note (sets note.lyric).
function attachLyrics(lines, onsets, lyrics, id) {
  const parsed = parseLyrics(lyrics);
  const count = parsed.flat().length;
  if (count !== onsets.length) console.warn(`${id}: ${count} syllables for ${onsets.length} notes`);
  let i = 0;
  for (const line of parsed) {
    lines.push({ syllables: line.map(text => {
      const note = onsets[i++];
      if (note) note.lyric = text;
      return { text, note };
    }) });
  }
}

// Flattens a lesson into time-ordered notes (in beats), the beat where each caption starts, and
// karaoke lines ({ syllables: [{ text, note }] }) whose syllables point at the notes they're sung on.
// Built-in lessons are written as steps; songs added in the song editor carry ready-made notes.
function buildLesson(lesson) {
  if (lesson.notes) {
    const notes = lesson.notes.map(nt => ({ ...nt })).sort((a, b) => a.t - b.t || a.n - b.n);
    const lines = [];
    if (lesson.lyrics) {  // sung on the top note of each moment
      const onsets = [];
      for (const nt of notes) {
        const last = onsets[onsets.length - 1];
        if (last && last.t === nt.t) { if (nt.n > last.n) onsets[onsets.length - 1] = nt; } else onsets.push(nt);
      }
      attachLyrics(lines, onsets, lesson.lyrics, lesson.id);
    }
    const end = notes.reduce((m, nt) => Math.max(m, nt.t + nt.dur), 0);
    return { notes, steps: [{ t: 0, say: lesson.say || '' }], lines, end };
  }

  const gap = lesson.gap ?? 2;  // beats of breathing room between steps
  const notes = [], steps = [], lines = [];
  let t = 0, end = 0;
  for (const [say, right, left, lyrics] of lesson.steps) {
    if (say) steps.push({ t, say });
    end = t;
    for (const [hand, str] of [['R', right], ['L', left]]) {
      if (!str) continue;
      const part = parseNotation(str, t, hand);
      notes.push(...part.notes);
      end = Math.max(end, part.end);
      if (hand === 'R' && lyrics) {  // one syllable per right-hand onset (a chord gets one)
        attachLyrics(lines, part.notes.filter((nt, i, all) => i === 0 || all[i - 1].t !== nt.t), lyrics, lesson.id);
      }
    }
    t = end + gap;
  }
  notes.sort((a, b) => a.t - b.t || a.n - b.n);
  return { notes, steps, lines, end };
}
