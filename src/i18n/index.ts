import uz from './uz.json';
import ru from './ru.json';

export type Lang = 'uz' | 'ru';

const STRINGS: Record<Lang, Record<string, string>> = { uz, ru };

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const text = STRINGS[lang][key];
  if (text === undefined) {
    console.warn(`i18n: missing ${lang} key "${key}"`);
    return key;
  }
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
