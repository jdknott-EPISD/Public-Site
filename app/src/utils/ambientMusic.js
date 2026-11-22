// Soft instrumental background music, made live in the browser (Web Audio): warm pads, a quiet
// bass note, and gentle piano over slow worship-style chord progressions. Nothing is
// recorded or downloaded, so there's no copyright to clear and it never repeats exactly.
//
//   const music = new AmbientMusic(audioContext, destinationNode);
//   music.start('piano');  ...  music.stop();

export const AMBIENT_STYLES = [
  { id: 'piano', name: 'Soft piano', hint: 'Gentle piano over warm pads', key: 62, bpm: 66, chords: [0, 4, 5, 3], barsPerChord: 1, piano: 0.55, arpeggio: false, pad: 0.8 },
  { id: 'pads', name: 'Warm pads', hint: 'Slow, quiet, for prayer and reflection', key: 60, bpm: 50, chords: [0, 3, 5, 3], barsPerChord: 2, piano: 0.12, arpeggio: false, pad: 1 },
  { id: 'reflective', name: 'Reflective', hint: 'Thoughtful, a little minor', key: 60, bpm: 60, chords: [5, 3, 0, 4], barsPerChord: 1, piano: 0.45, arpeggio: false, pad: 0.85 },
  { id: 'hopeful', name: 'Hopeful', hint: 'Brighter, with flowing piano', key: 67, bpm: 72, chords: [0, 3, 5, 4], barsPerChord: 1, piano: 0.35, arpeggio: true, pad: 0.7 },
  // Upbeat: piano chord rhythm, bouncing bass, and soft kick, snare and shaker
  { id: 'joyful', name: 'Joyful', hint: 'Upbeat and warm, with a light groove', key: 62, bpm: 100, chords: [0, 4, 5, 3], barsPerChord: 1, piano: 0.3, arpeggio: false, pad: 0.45, groove: 0.8 },
  { id: 'praise', name: 'Praise', hint: 'Bright and joyful, a little faster', key: 64, bpm: 112, chords: [3, 0, 4, 5], barsPerChord: 1, piano: 0.25, arpeggio: false, pad: 0.4, groove: 1 }
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTATONIC = [0, 2, 4, 7, 9];
const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Place a pitch class inside [low, low + 12)
const inRange = (pc, low) => low + ((((pc - low) % 12) + 12) % 12);

// Notes of the chord on a scale degree (0 = I), as pitch classes: root, third, fifth, seventh, ninth
const chordTones = (key, degree) => [0, 2, 4, 6, 8].map((step) => {
  const i = degree + step;
  return key + MAJOR[i % 7] + 12 * Math.floor(i / 7);
});

// A gentle hall reverb: decaying stereo noise
const makeReverb = (ctx, seconds = 4.5) => {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  const node = ctx.createConvolver();
  node.buffer = buffer;
  return node;
};

export class AmbientMusic {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.55;
    this.dry.connect(this.out);
    this.reverb = makeReverb(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.6;
    this.reverb.connect(this.wet);
    this.wet.connect(this.out);
    // Everything goes through here, to both the dry path and the reverb
    this.bus = ctx.createGain();
    this.bus.connect(this.dry);
    this.bus.connect(this.reverb);
    // Drums mostly skip the reverb, so they stay clean and don't muddy the sound
    this.drums = ctx.createGain();
    this.drums.connect(this.dry);
    const drumVerb = ctx.createGain();
    drumVerb.gain.value = 0.15;
    this.drums.connect(drumVerb);
    drumVerb.connect(this.reverb);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.style = null;
    this.timer = null;
  }

  get playing() { return !!this.style; }

  start(styleId) {
    const style = AMBIENT_STYLES.find((s) => s.id === styleId) || AMBIENT_STYLES[0];
    const now = this.ctx.currentTime;
    if (this.timer) clearInterval(this.timer);
    this.style = style;
    this.beat = 60 / style.bpm;
    this.nextBar = now + 0.1;
    this.bar = 0;
    this.melody = style.key + 12;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(1, now + 3);
    this.timer = setInterval(() => this.schedule(), 200);
    this.schedule();
  }

  // Fade out over a few seconds
  stop() {
    if (!this.style) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 2.5);
    clearInterval(this.timer);
    this.timer = null;
    this.style = null;
  }

  destroy() {
    this.stop();
    this.out.disconnect();
  }

  // Plan bars a little ahead of time so the timing stays smooth
  schedule() {
    if (!this.style) return;
    while (this.nextBar < this.ctx.currentTime + 1.5) {
      this.playBar(this.nextBar);
      this.nextBar += this.beat * 4;
      this.bar += 1;
    }
  }

  playBar(t) {
    const s = this.style;
    const barLen = this.beat * 4;
    const chordIndex = Math.floor(this.bar / s.barsPerChord) % s.chords.length;
    const firstBarOfChord = this.bar % s.barsPerChord === 0;
    const tones = chordTones(s.key, s.chords[chordIndex]);

    // Pads and bass change with the chord and overlap into the next one
    if (firstBarOfChord) {
      const chordLen = barLen * s.barsPerChord;
      const padNotes = [tones[0], tones[2], tones[1] + 12, tones[4]].map((pc) => inRange(pc, 55));
      padNotes.forEach((n) => this.pad(freq(n), t, chordLen + 1.5, 0.035 * s.pad));
      this.bass(freq(inRange(tones[0], 38)), t, chordLen + 1, 0.09 * s.pad);
    }

    if (s.groove) this.grooveBar(t, tones, s.groove);

    // Piano: a few quiet notes per bar, or a flowing arpeggio
    if (s.arpeggio) {
      const arp = [tones[0], tones[2], tones[4], tones[1] + 12].map((pc) => inRange(pc, 60));
      for (let i = 0; i < 8; i++) {
        if (Math.random() < 0.85) this.piano(freq(arp[i % 4] + (i >= 4 ? 12 : 0)), t + i * this.beat / 2, 0.05 + Math.random() * 0.02);
      }
    }
    for (let b = 0; b < 4; b++) {
      const chance = b === 0 ? s.piano + 0.3 : s.piano * (b === 2 ? 0.8 : 0.5);
      if (Math.random() >= chance) continue;
      const note = b === 0 ? this.nearest(tones.slice(0, 3)) : this.step();
      this.piano(freq(note), t + b * this.beat + Math.random() * 0.03, 0.07 + Math.random() * 0.03);
      // Now and then, a soft note under it
      if (b === 0 && Math.random() < 0.5) this.piano(freq(inRange(tones[2], 55)), t + 0.02, 0.04);
    }
  }

  // The chord tone closest to the last melody note
  nearest(pcs) {
    let best = this.melody;
    let bestDist = Infinity;
    pcs.forEach((pc) => {
      for (let o = 60; o < 86; o += 12) {
        const n = inRange(pc, o);
        const d = Math.abs(n - this.melody);
        if (n >= 64 && n <= 81 && d < bestDist) { best = n; bestDist = d; }
      }
    });
    this.melody = best;
    return best;
  }

  // A small step up or down the pentatonic scale
  step() {
    const scale = [];
    for (let o = 48; o < 96; o += 12) PENTATONIC.forEach((p) => scale.push(this.style.key + o - 60 + p + 12));
    const inBounds = scale.filter((n) => n >= 64 && n <= 81);
    let i = inBounds.findIndex((n) => n >= this.melody);
    if (i < 0) i = inBounds.length - 1;
    i = Math.max(0, Math.min(inBounds.length - 1, i + pick([-2, -1, -1, 1, 1, 2, 0])));
    this.melody = inBounds[i];
    return this.melody;
  }

  // One bar of the upbeat styles
  grooveBar(t, tones, amount) {
    const b = this.beat;
    // Piano chords on a gentle syncopated rhythm (1, 2-and, 3, 4-and)
    const chord = [tones[0], tones[1], tones[2]].map((pc) => inRange(pc, 57));
    [[0, 1], [1.5, 0.7], [2, 0.85], [3.5, 0.7]].forEach(([at, accent]) => {
      chord.forEach((n, i) => this.piano(freq(n), t + at * b + i * 0.008, 0.035 * accent));
    });
    // Bass: root notes that bounce, walking to the fifth at the end of some bars
    const root = inRange(tones[0], 38);
    const fifth = inRange(tones[2], 38);
    [[0, root], [1.5, root], [2, root], [3, Math.random() < 0.5 ? fifth : root], [3.5, root + 12]].forEach(([at, n], i) => {
      if (i === 4 && Math.random() < 0.6) return;
      this.pluck(freq(n), t + at * b, b * (i === 0 ? 1.4 : 0.45), 0.16);
    });
    // Drums: kick on 1 and 3, soft snare on 2 and 4, shaker on the eighths
    this.kick(t, 0.45 * amount);
    this.kick(t + 2 * b, 0.4 * amount);
    if (Math.random() < 0.35) this.kick(t + 2.5 * b, 0.25 * amount);
    this.snare(t + b, 0.09 * amount);
    this.snare(t + 3 * b, 0.1 * amount);
    for (let i = 0; i < 8; i++) this.shaker(t + i * b / 2, (i % 2 ? 0.035 : 0.018) * amount);
  }

  pluck(f, t, len, level) {
    const { ctx } = this;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(level * 0.4, t + len * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len + 0.15);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.connect(gain);
    gain.connect(this.drums);
    [['sine', 1], ['triangle', 0.5]].forEach(([type, amount]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = amount;
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(t + len + 0.2);
    });
  }

  kick(t, level) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    osc.connect(gain);
    gain.connect(this.drums);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  // A burst of filtered noise: a soft snare or a shaker
  noiseHit(t, level, type, frequency, length, destination) {
    const { ctx } = this;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.05);
  }
  snare(t, level) { this.noiseHit(t, level, 'bandpass', 1800, 0.18, this.bus); }
  shaker(t, level) { this.noiseHit(t, level, 'highpass', 7000, 0.06, this.drums); }

  // Warm pad: two slightly detuned saws, softened, with a slow swell in and out
  pad(f, t, dur, level) {
    const { ctx } = this;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700 + Math.random() * 300;
    filter.Q.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + Math.min(2.5, dur / 3));
    gain.gain.setValueAtTime(level, t + dur - 2.5);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    filter.connect(gain);
    gain.connect(this.bus);
    [-6, 6].forEach((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    });
  }

  bass(f, t, dur, level) {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 1.2);
    gain.gain.setValueAtTime(level, t + dur - 1.5);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  // Soft piano-like note: a quick touch, then a long natural fade
  piano(f, t, level) {
    const { ctx } = this;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(level * 0.3, t + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 2);
    filter.connect(gain);
    gain.connect(this.bus);
    [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]].forEach(([mult, type, amount]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.value = amount;
      osc.connect(g);
      g.connect(filter);
      osc.start(t);
      osc.stop(t + 4.1);
    });
  }
}
