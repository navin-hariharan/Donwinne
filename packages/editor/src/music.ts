// Music nets: transitions play a note when they fire (Web Audio, no samples needed).

export const INSTRUMENTS = ["piano", "sine", "square", "sawtooth", "triangle", "drum"] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES: string[] = [];
for (let o = 2; o <= 6; o++) for (const n of NAMES) NOTE_NAMES.push(`${n}${o}`);

/** Frequency of a note name such as A4 (440 Hz) or C#5. */
export function noteFrequency(note: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note.trim());
  if (!m) return 440;
  let i = NAMES.indexOf(m[1]) + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + i;
  i = midi - 69;
  return 440 * Math.pow(2, i / 12);
}

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playNote(note: string, duration = 0.3, instrument: string = "piano") {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  const gain = ac.createGain();
  gain.connect(ac.destination);
  if (instrument === "drum") {
    // Short noise burst through a band-pass filter, pitched by the note.
    const len = Math.max(0.05, Math.min(duration, 0.4));
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * len), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = noteFrequency(note);
    src.connect(f).connect(gain);
    gain.gain.setValueAtTime(0.9, t0);
    src.start(t0);
    return;
  }
  const osc = ac.createOscillator();
  osc.frequency.value = noteFrequency(note);
  osc.type = instrument === "piano" ? "triangle" : (instrument as OscillatorType);
  osc.connect(gain);
  const peak = instrument === "square" || instrument === "sawtooth" ? 0.12 : 0.3;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01);
  // Piano-like: quick decay to a lower sustain.
  if (instrument === "piano") gain.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + Math.min(0.25, duration));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}
