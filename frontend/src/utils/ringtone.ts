// Зацикленный звук входящего звонка. Два чередующихся тона по 400мс
// с короткой паузой — похоже на классический телефонный rings.
// Играется до явного stop'а (или принудительного timeout-а).

let activeStop: (() => void) | null = null;

function getCtx(): AudioContext | null {
  try {
    const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * Запускает ringtone. Возвращает stop-функцию. Если уже играет другой —
 * новый заменяет старый (нельзя звонить двумя голосами одновременно).
 *
 * @param volume 0..1 — общая громкость.
 */
export function startRingtone(volume = 1.0): () => void {
  stopRingtone();  // один звонок одновременно

  const v = Math.max(0, Math.min(1, volume));
  if (v === 0) {
    // Если громкость нулевая — запомним stop-заглушку, чтобы API был консистентным.
    activeStop = () => { activeStop = null; };
    return activeStop;
  }

  const ctx = getCtx();
  if (!ctx) {
    activeStop = () => { activeStop = null; };
    return activeStop;
  }

  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const peak = 0.55 * v;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const oscillators: OscillatorNode[] = [];

  // Одна «нота»: два тона подряд = 1 гудок + пауза. Потом повтор.
  const playOneRing = (startTime: number) => {
    if (cancelled) return;

    const tone = (when: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, when);

      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0, when);
      noteGain.gain.linearRampToValueAtTime(peak, when + 0.02);
      noteGain.gain.linearRampToValueAtTime(peak, when + dur - 0.05);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, when + dur);

      osc.connect(noteGain);
      noteGain.connect(master);
      master.gain.setValueAtTime(1, when);  // master всегда открыт

      osc.start(when);
      osc.stop(when + dur + 0.02);
      oscillators.push(osc);
    };

    tone(startTime, 440, 0.4);
    tone(startTime + 0.5, 550, 0.4);

    // Следующий повтор через 2 секунды (total цикл ~2с)
    const id = setTimeout(() => playOneRing(ctx.currentTime + 0.02), 2000);
    timers.push(id);
  };

  playOneRing(ctx.currentTime + 0.05);

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    timers.forEach(clearTimeout);
    oscillators.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } });
    // Плавное затухание чтобы не щёлкнуло
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.05);
    setTimeout(() => { ctx.close().catch(() => {}); }, 200);
    if (activeStop === stop) activeStop = null;
  };

  activeStop = stop;
  return stop;
}

export function stopRingtone(): void {
  activeStop?.();
  activeStop = null;
}
