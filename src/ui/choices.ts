import type { Lang } from '../i18n';
import type { TimeOfDay } from '../render/timeOfDay';
import type { Gearbox } from '../vehicle/drivetrain';

export interface StartChoice {
  mode: 'free' | 'exam';
  lang: Lang;
  gearbox: Gearbox;
  timeOfDay: TimeOfDay;
  sound: boolean;
  /** 0 to 1. */
  volume: number;
}

const KEY = 'avtomaktab.start';
export const DEFAULT_CHOICE: StartChoice = { mode: 'exam', lang: 'uz', gearbox: 'auto', timeOfDay: 'noon', sound: true, volume: 0.7 };

export function loadChoice(): StartChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StartChoice>;
    return {
      mode: raw.mode === 'free' ? 'free' : raw.mode === 'exam' ? 'exam' : DEFAULT_CHOICE.mode,
      lang: raw.lang === 'ru' ? 'ru' : raw.lang === 'uz' ? 'uz' : DEFAULT_CHOICE.lang,
      gearbox: raw.gearbox === 'manual' ? 'manual' : raw.gearbox === 'auto' ? 'auto' : DEFAULT_CHOICE.gearbox,
      timeOfDay: raw.timeOfDay === 'morning' || raw.timeOfDay === 'evening' || raw.timeOfDay === 'noon' ? raw.timeOfDay : DEFAULT_CHOICE.timeOfDay,
      sound: typeof raw.sound === 'boolean' ? raw.sound : DEFAULT_CHOICE.sound,
      volume: typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULT_CHOICE.volume,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function saveChoice(c: StartChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage blocked: the choice is only kept for this visit.
  }
}
