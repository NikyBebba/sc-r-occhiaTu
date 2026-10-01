// Effetti brevi generati nel browser; nessun file audio o riproduzione automatica.
// La scelta è locale al dispositivo e parte sempre spenta.
const AUDIO_KEY = 'scorochiatu_audio';
let audioEnabled = false;
let audioContext = null;

function audioSupported() {
  return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
}

function loadAudioPreference() {
  try { audioEnabled = localStorage.getItem(AUDIO_KEY) === 'on'; }
  catch (error) { audioEnabled = false; }
  renderAudioControl();
}

function renderAudioControl() {
  const button = document.getElementById('audioToggle');
  if (!button) return;
  const supported = audioSupported();
  button.classList.toggle('hidden', !supported);
  button.classList.toggle('bg-indigo-600/30', supported && audioEnabled);
  button.setAttribute('aria-pressed', String(supported && audioEnabled));
  const label = audioEnabled ? 'Disattiva suoni' : 'Attiva suoni';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  const text = document.getElementById('audioLabel');
  if (text) text.textContent = `Suoni su questo telefono: ${audioEnabled ? 'attivi' : 'spenti'}`;
}

function toggleAudio() {
  if (!audioSupported()) return;
  audioEnabled = !audioEnabled;
  try { localStorage.setItem(AUDIO_KEY, audioEnabled ? 'on' : 'off'); }
  catch (error) { /* La scelta resta valida fino alla chiusura della pagina. */ }
  renderAudioControl();
  if (audioEnabled) playSound('toggle');
  else if (audioContext && audioContext.state === 'running') {
    try { audioContext.suspend().catch(() => {}); }
    catch (error) { /* Un contesto audio non sospendibile resta silenzioso. */ }
  }
}

function audioTone(ctx, frequency, offset, duration) {
  const start = ctx.currentTime + offset;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(0.035, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function playSound(kind) {
  if (!audioEnabled || !audioSupported() || document.visibilityState === 'hidden') return false;
  const patterns = {
    toggle: [[660, 0, 0.08]],
    like: [[520, 0, 0.075], [740, 0.08, 0.105]],
    nope: [[370, 0, 0.09]],
    wheelStart: [[440, 0, 0.07]],
    wheelWin: [[523, 0, 0.11], [659, 0.11, 0.11], [784, 0.22, 0.18]],
    match: [[659, 0, 0.09], [784, 0.09, 0.1], [1047, 0.2, 0.2]]
  };
  const notes = patterns[kind];
  if (!notes) return false;
  const requestedAt = Date.now();
  try {
    if (audioContext && audioContext.state === 'closed') audioContext = null;
    if (!audioContext) {
      const Context = window.AudioContext || window.webkitAudioContext;
      audioContext = new Context();
    }
    const schedule = () => {
      // Un resume sbloccato molto più tardi non deve riprodurre un vecchio cue.
      if (audioEnabled && document.visibilityState !== 'hidden' && Date.now() - requestedAt < 700) {
        notes.forEach(([frequency, offset, duration]) => audioTone(audioContext, frequency, offset, duration));
      }
    };
    if (audioContext.state !== 'running') audioContext.resume().then(schedule).catch(() => {});
    else schedule();
    return true;
  } catch (error) { return false; }
}
