import { HELP_LINES, t } from './index';
import ruStrings from './ru.json';
import uzStrings from './uz.json';

test('substitutes {speed} vars', () => {
  const uz = t('uz', 'penalty.speeding', { speed: 72 });
  const ru = t('ru', 'penalty.speeding', { speed: 72 });
  expect(uz).toContain('72');
  expect(ru).toContain('72');
  expect(uz).not.toContain('{speed}');
  expect(ru).not.toContain('{speed}');
});

test('a missing key returns the key and logs a warning', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(t('uz', 'no.such.key')).toBe('no.such.key');
  expect(t('ru', 'no.such.key')).toBe('no.such.key');
  expect(warn).toHaveBeenCalledTimes(2);
  warn.mockRestore();
});

test('practice scoring label exists in both languages', () => {
  expect(t('uz', 'exam.practiceScoring')).toBe('Amaliy baholash');
  expect(t('ru', 'exam.practiceScoring')).toBe('Учебная оценка');
});

test('uz and ru have the same keys', () => {
  expect(Object.keys(uzStrings).sort()).toEqual(Object.keys(ruStrings).sort());
});

test('the controls help names every key that costs points when unknown, in both languages', () => {
  for (const lang of ['uz', 'ru'] as const) {
    const help = HELP_LINES.map(k => t(lang, k)).join(' ');
    for (const key of ['[W/S]', '[A/D]', '[Z/X]', '[V]', '[B]', '[1/2/3]', '[H]']) expect(help).toContain(key);
    const reminder = t(lang, 'ui.examKeys');
    for (const key of ['Z/X', '1/2/3', 'V', 'B']) expect(reminder).toContain(key);
  }
});

test('Uzbek uses the plain apostrophe', () => {
  expect(Object.values(uzStrings).join('')).not.toMatch(/[‘’ʻʼ]/);
});
