import { useSettingsStore } from '@/stores/settingsStore';

let ctx: AudioContext | null = null;

function soundConfig() {
  return useSettingsStore.getState();
}

function ac(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq: number, endFreq: number, dur: number, vol: number, type: OscillatorType = 'sine') {
  try {
    const settings = soundConfig();
    if (!settings.uiSounds || settings.uiSoundStyle === 'minimal') return;
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.connect(g); g.connect(c.destination);
    o.type = settings.uiSoundStyle === 'arcade' ? 'square' : type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(endFreq, c.currentTime + dur);
    g.gain.setValueAtTime(vol * Math.max(0, Math.min(100, settings.masterVolume)) / 100, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.start(c.currentTime);
    o.stop(c.currentTime + dur + 0.01);
  } catch {}
}

export function playClick() { tone(520, 420, 0.06, 0.08); }
export function playSuccess() {
  try {
    const settings = soundConfig();
    if (!settings.uiSounds || !settings.playInstallSound || settings.uiSoundStyle === 'minimal') return;
    const c = ac();
    [440, 554, 660].forEach((f, i) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = settings.uiSoundStyle === 'arcade' ? 'square' : 'sine'; o.frequency.value = f;
      const t = c.currentTime + i * 0.08;
      g.gain.setValueAtTime(0.1 * Math.max(0, Math.min(100, settings.masterVolume)) / 100, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.start(t); o.stop(t + 0.2);
    });
  } catch {}
}
export function playError()  { if (soundConfig().playErrorSound) tone(380, 200, 0.18, 0.09); }
export function playNav()    { if (soundConfig().playNavigationSound) tone(360, 480, 0.07, 0.07); }
export function playOpen()   { tone(480, 600, 0.09, 0.07); }
export function playClose()  { tone(600, 380, 0.07, 0.06); }
export function playToggle() { tone(500, 500, 0.04, 0.06, 'square'); }

/** Один короткий тройной щелчок для скрытого достижения Manus. */
export function playManusClick() {
  try {
    const settings = soundConfig();
    if (!settings.uiSounds || settings.uiSoundStyle === 'minimal') return;
    const c = ac();
    [0, 0.055, 0.11].forEach((offset, index) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = settings.uiSoundStyle === 'arcade' ? 'square' : 'triangle';
      const time = c.currentTime + offset;
      const frequency = [1260, 1480, 1760][index];
      o.frequency.setValueAtTime(frequency, time);
      g.gain.setValueAtTime(0.075 * Math.max(0, Math.min(100, settings.masterVolume)) / 100, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
      o.start(time); o.stop(time + 0.06);
    });
  } catch {}
}
