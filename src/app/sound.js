// Synthesized sound for the board (Web Audio API): no samples, no downloads, no third-party music.
// Silent until a person turns it on, because browsers only allow audio after a gesture.
// The board and the payment flow never call this directly; main.js routes bus events here.

let ctx = null;
let master = null;
let wet = null;
let enabled = false;
const played = [];

// D major pentatonic, so every cue sounds like part of the same small world.
const NOTE = { D4: 293.66, E4: 329.63, Fs4: 369.99, A4: 440, B4: 493.88, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, D6: 1174.66 };

function ensureContext() {
  if (!ctx) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    ctx = new Context();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14; limiter.ratio.value = 6;
    limiter.connect(ctx.destination);
    master = ctx.createGain(); master.gain.value = 0.22; master.connect(limiter);
    // A small room: impulse response generated from decaying noise with a few early reflections.
    const seconds = 1.1;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
      for (const ms of [23, 41, 67, 103]) { const at = Math.floor((ms / 1000) * ctx.sampleRate); data[at] += channel ? 0.45 : 0.5; }
    }
    const convolver = ctx.createConvolver(); convolver.buffer = impulse;
    wet = ctx.createGain(); wet.gain.value = 0.28;
    convolver.connect(wet).connect(limiter);
    wet.input = convolver;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(frequency, start, duration, { type = 'triangle', gain = 0.3, reverb = true, glide = null } = {}) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, start + duration);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(amp).connect(master);
  if (reverb) amp.connect(wet.input);
  osc.start(start); osc.stop(start + duration + 0.05);
}

function tap(start, pitch = 1) {
  // Wooden footstep: a band-passed noise click over a short low thump.
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const noise = ctx.createBufferSource(); noise.buffer = buffer;
  const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 1300 * pitch; band.Q.value = 3;
  const amp = ctx.createGain(); amp.gain.value = 0.5;
  noise.connect(band).connect(amp).connect(master);
  noise.start(start);
  tone(170 * pitch, start, 0.08, { type: 'sine', gain: 0.25, reverb: false, glide: 110 * pitch });
}

const CUES = {
  hop: (t, detail) => tap(t, detail?.direction < 0 ? 0.8 : 1 + ((detail?.position ?? 0) % 3) * 0.06),
  chime: (t) => { tone(NOTE.E5 * 2, t, 0.35, { type: 'sine', gain: 0.18 }); tone(NOTE.A5 * 1.5, t + 0.07, 0.5, { type: 'sine', gain: 0.16 }); },
  fanfare: (t, detail) => {
    const tier = Math.max(1, Math.min(3, detail?.tier ?? 1));
    const phrase = [NOTE.D4, NOTE.Fs4, NOTE.A4, NOTE.D5, NOTE.Fs5, NOTE.A5].slice(0, 3 + tier);
    phrase.forEach((f, i) => tone(f, t + i * 0.12, 0.5, { gain: 0.24 }));
    tone(phrase.at(-1), t + phrase.length * 0.12, 1.1, { gain: 0.22 });
    tone(phrase.at(-1) / 2, t + phrase.length * 0.12, 1.1, { type: 'sine', gain: 0.16 });
  },
  sprout: (t) => { tone(NOTE.B4, t, 0.22, { type: 'sine', gain: 0.2, glide: NOTE.E5 }); tone(NOTE.E5, t + 0.12, 0.3, { type: 'sine', gain: 0.16 }); },
  soft: (t) => { tone(NOTE.A4, t, 0.25, { type: 'sine', gain: 0.16 }); tone(NOTE.Fs4, t + 0.16, 0.4, { type: 'sine', gain: 0.14 }); },
};

export const sound = {
  get enabled() { return enabled; },
  /** Turn sound on or off. Must be called from a user gesture the first time. */
  setEnabled(on) {
    enabled = Boolean(on) && Boolean(ensureContext());
    if (enabled) CUES.chime(ctx.currentTime + 0.02);
    return enabled;
  },
  cue(name, detail) {
    if (!enabled || !ctx || !CUES[name]) return false;
    CUES[name](ctx.currentTime + 0.01, detail);
    played.push(name);
    if (played.length > 50) played.shift();
    return true;
  },
  /** Test hook: names of the most recent cues played. */
  played: () => [...played],
};
