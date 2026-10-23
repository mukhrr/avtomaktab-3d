import { t } from './index';

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
