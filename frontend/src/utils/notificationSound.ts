// Короткий двухтональный beep — без загрузки файлов, чистый WebAudio API.
// Используется для уведомлений о новых сообщениях.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    // Webkit-префикс для старых Safari
    const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Проиграть короткий звук уведомления. Тихий, не раздражающий.
 * Два тона: ноты A5 → E6, общая длительность ~180мс.
 * @param volume 0..1 — множитель базовой громкости (дефолт 1.0)
 */
export function playNotificationSound(volume = 1.0): void {
  const ctx = getCtx();
  if (!ctx) return;

  // В некоторых браузерах контекст создаётся в состоянии 'suspended' до первого
  // пользовательского жеста. Пытаемся возобновить; если не получится — звук
  // просто не воспроизведётся, ошибку не бросаем.
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  const v = Math.max(0, Math.min(1, volume));
  if (v === 0) return;
  // Перцептивно громкость звука логарифмическая: линейное значение `v` умножаем
  // на высокий пик, чтобы 100% был реально громким. Triangle-волна насыщеннее
  // синуса — те же dB звучат заметнее.
  const peak = 0.9 * v;

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  gain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.setValueAtTime(880, now); // A5
  osc1.connect(gain);
  osc1.start(now);
  osc1.stop(now + 0.1);

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(1318, now + 0.1); // E6
  osc2.connect(gain);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.22);
}
