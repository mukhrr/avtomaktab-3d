import { useEffect, useState } from 'react';
import { t, type Lang } from '../i18n';
import { needsReload } from '../render/probe';
import type { Quality } from '../render/quality';
import type { TimeOfDay } from '../render/timeOfDay';
import { saveChoice, type StartChoice } from './choices';

function Pick<T extends string>({ value, options, onPick, disabled }: { value: T; options: [T, string][]; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="pick">
      {options.map(([v, label]) => (
        <button key={v} type="button" disabled={disabled} className={v === value ? 'on' : ''} onClick={() => onPick(v)}>{label}</button>
      ))}
    </div>
  );
}

interface StartScreenProps {
  initial: StartChoice;
  routes: { id: string; km: number }[];
  quality: Quality;
  loadedQuality: Quality;
  probing: boolean;
  onStart: (c: StartChoice, quality: Quality) => void;
}

export function StartScreen({ initial, routes, quality, loadedQuality, probing, onStart }: StartScreenProps) {
  const [c, setC] = useState(initial);
  const [q, setQ] = useState(quality);
  useEffect(() => setQ(quality), [quality]);
  const L = c.lang;
  const set = (p: Partial<StartChoice>) => setC(prev => ({ ...prev, ...p }));
  const langs: [Lang, string][] = [['uz', t(L, 'lang.uz')], ['ru', t(L, 'lang.ru')]];
  const picked = routes.find(r => r.id === c.route);
  const kms = routes.map(r => r.km);
  const [lo, hi] = [Math.min(...kms), Math.max(...kms)];
  const examLength = hi - lo < 0.05 ? t(L, 'ui.route', { km: lo.toFixed(1) }) : t(L, 'ui.routeRange', { min: lo.toFixed(1), max: hi.toFixed(1) });
  const routeOptions: [string, string][] = [['', t(L, 'ui.routeNone')], ...routes.map((r): [string, string] => [r.id, t(L, 'ui.routeName', { n: r.id.replace(/^route-/, '') })])];
  return (
    <div className="overlay">
      <div className="card start">
        <h1>Avtomaktab 3D</h1>
        <div className="practice">{t(L, 'exam.practiceScoring')}</div>
        <label>{t(L, 'ui.mode')}</label>
        <Pick value={c.mode} options={[['free', t(L, 'ui.free')], ['exam', t(L, 'ui.exam')]]} onPick={mode => set({ mode })} />
        {c.mode === 'free' && (
          <>
            <label>{t(L, 'ui.routeChoice')}</label>
            <Pick value={picked?.id ?? ''} options={routeOptions} onPick={id => set({ route: id || null })} />
          </>
        )}
        <label>{t(L, 'ui.language')}</label>
        <Pick value={c.lang} options={langs} onPick={lang => set({ lang })} />
        <label>{t(L, 'ui.gearbox')}</label>
        <Pick value={c.gearbox} options={[['auto', t(L, 'ui.auto')], ['manual', t(L, 'ui.manual')]]} onPick={gearbox => set({ gearbox })} />
        <label>{t(L, 'ui.timeOfDay')}</label>
        <Pick<TimeOfDay> value={c.timeOfDay} options={[['morning', t(L, 'ui.morning')], ['noon', t(L, 'ui.noon')], ['evening', t(L, 'ui.evening')]]} onPick={timeOfDay => set({ timeOfDay })} />
        <label>{t(L, 'ui.sound')}</label>
        <Pick<'on' | 'off'> value={c.sound ? 'on' : 'off'} options={[['on', t(L, 'ui.on')], ['off', t(L, 'ui.off')]]} onPick={v => set({ sound: v === 'on' })} />
        <label htmlFor="volume">{t(L, 'ui.volume')} · {Math.round(c.volume * 100)}%</label>
        <input id="volume" className="volume" type="range" min={0} max={100} step={5} value={Math.round(c.volume * 100)} disabled={!c.sound} onChange={e => set({ volume: Number(e.target.value) / 100 })} />
        <label>{t(L, 'ui.quality')}</label>
        <Pick<Quality> value={q} options={[['low', t(L, 'ui.low')], ['medium', t(L, 'ui.medium')], ['high', t(L, 'ui.high')]]} onPick={setQ} disabled={probing} />
        {probing && <p className="note">{t(L, 'ui.checkingGraphics')}</p>}
        {!probing && needsReload(loadedQuality, q) && <p className="note">{t(L, 'ui.reloadForAA')}</p>}
        {c.mode === 'exam' && <p className="note">{examLength} · {t(L, 'ui.examKeys')}</p>}
        {c.mode === 'free' && picked && <p className="note">{t(L, 'ui.route', { km: picked.km.toFixed(1) })}</p>}
        <button
          type="button"
          className="go"
          disabled={probing}
          onClick={() => {
            saveChoice(c);
            onStart(c, q);
          }}
        >
          {t(L, 'ui.start')}
        </button>
      </div>
    </div>
  );
}
