import type { Lang } from '../i18n';
import type { TimeOfDay } from '../render/timeOfDay';
import type { Gearbox } from '../vehicle/drivetrain';

export interface StartChoice {
  mode: 'free' | 'exam';
  lang: Lang;
  gearbox: Gearbox;
  timeOfDay: TimeOfDay;
}

const KEY = 'avtomaktab.start';
export const DEFAULT_CHOICE: StartChoice = { mode: 'exam', lang: 'uz', gearbox: 'auto', timeOfDay: 'noon' };

export function loadChoice(): StartChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<StartChoice>;
    return {
      mode: raw.mode === 'free' ? 'free' : raw.mode === 'exam' ? 'exam' : DEFAULT_CHOICE.mode,
      lang: raw.lang === 'ru' ? 'ru' : raw.lang === 'uz' ? 'uz' : DEFAULT_CHOICE.lang,
      gearbox: raw.gearbox === 'manual' ? 'manual' : raw.gearbox === 'auto' ? 'auto' : DEFAULT_CHOICE.gearbox,
      timeOfDay: raw.timeOfDay === 'morning' || raw.timeOfDay === 'evening' || raw.timeOfDay === 'noon' ? raw.timeOfDay : DEFAULT_CHOICE.timeOfDay,
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
