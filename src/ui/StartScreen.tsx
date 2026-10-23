import { useState } from 'react';
import { t, type Lang } from '../i18n';
import { saveChoice, type StartChoice } from './choices';

function Pick<T extends string>({ value, options, onPick }: { value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div className="pick">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={v === value ? 'on' : ''} onClick={() => onPick(v)}>{label}</button>
      ))}
    </div>
  );
}

export function StartScreen({ initial, routeKm, onStart }: { initial: StartChoice; routeKm: number; onStart: (c: StartChoice) => void }) {
  const [c, setC] = useState(initial);
  const L = c.lang;
  const set = (p: Partial<StartChoice>) => setC(prev => ({ ...prev, ...p }));
  const langs: [Lang, string][] = [['uz', t(L, 'lang.uz')], ['ru', t(L, 'lang.ru')]];
  return (
    <div className="overlay">
      <div className="card start">
        <h1>Avtomaktab 3D</h1>
        <div className="practice">{t(L, 'exam.practiceScoring')}</div>
        <label>{t(L, 'ui.mode')}</label>
        <Pick value={c.mode} options={[['free', t(L, 'ui.free')], ['exam', t(L, 'ui.exam')]]} onPick={mode => set({ mode })} />
        <label>{t(L, 'ui.language')}</label>
        <Pick value={c.lang} options={langs} onPick={lang => set({ lang })} />
        <label>{t(L, 'ui.gearbox')}</label>
        <Pick value={c.gearbox} options={[['auto', t(L, 'ui.auto')], ['manual', t(L, 'ui.manual')]]} onPick={gearbox => set({ gearbox })} />
        {c.mode === 'exam' && <p className="note">{t(L, 'ui.route', { km: routeKm.toFixed(1) })} · {t(L, 'ui.examKeys')}</p>}
        <button
          type="button"
          className="go"
          onClick={() => {
            saveChoice(c);
            onStart(c);
          }}
        >
          {t(L, 'ui.start')}
        </button>
      </div>
    </div>
  );
}
