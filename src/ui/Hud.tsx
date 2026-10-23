import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HELP_LINES, t } from '../i18n';
import { REDLINE_RPM } from '../vehicle/drivetrain';
import type { Vec2 } from '../shared/district';
import type { StartChoice } from './choices';
import { Debrief } from './Debrief';
import { ExamHud } from './ExamHud';
import type { HudStore } from './hudStore';
import { StartScreen } from './StartScreen';

export interface HudApp {
  roads: Vec2[][];
  routeKm: number;
  choice: () => StartChoice;
  onStart(c: StartChoice): void;
  onRetry(): void;
  onMenu(): void;
}

const TACH_MAX = 7000;
const HELP_KEY = 'avtomaktab.helpDismissed';

/** "[Z/X] indicators" with the bracketed keys in bold. */
const keyed = (text: string) => text.split(/\[([^\]]+)\]/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));

const readDismissed = () => {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
};

export function Hud({ store, minimap, debug, app }: { store: HudStore; minimap: HTMLCanvasElement; debug: boolean; app: HudApp }) {
  const s = useSyncExternalStore(store.subscribe, store.get);
  const [help, setHelp] = useState(!readDismissed());
  const mapHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mapHost.current?.append(minimap);
  }, [minimap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH') return;
      setHelp(h => {
        try {
          localStorage.setItem(HELP_KEY, h ? '1' : '0');
        } catch {
          // Private mode: the help panel just reappears next visit.
        }
        return !h;
      });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const tach = Math.min(1, s.rpm / TACH_MAX);
  const L = s.exam?.lang ?? app.choice().lang;
  return (
    <div className="hud">
      {help && (
        <div className="panel help">
          {HELP_LINES.map((k, i) => <Fragment key={k}>{i > 0 && <br />}{keyed(t(L, k))}</Fragment>)}
        </div>
      )}
      {debug && <div className="panel stats">{s.fps} fps · {s.drawCalls} draw calls · {s.activeCars ?? 0} cars · {s.activePeds ?? 0} peds · {s.controllers ?? 0} controllers · sim {(s.simMs ?? 0).toFixed(2)} ms</div>}
      <div className="dash">
        <div className="speed">{s.speedKmh}<small> km/h</small></div>
        <div className="row">
          <span className="gear">{s.gear}</span>
          <div className="tach">
            <div className="fill" style={{ width: `${tach * 100}%`, background: s.rpm >= REDLINE_RPM - 200 ? '#ff4d3a' : '#f2f2f2' }} />
            <div className="red" style={{ left: `${((REDLINE_RPM - 200) / TACH_MAX) * 100}%` }} />
          </div>
          <span className="box">{s.gearbox === 'auto' ? 'AUTO' : 'MANUAL'}</span>
        </div>
        {!s.running && <div className="stalled">{t(L, 'hud.stalled')}</div>}
        <div className="cabin">
          <span className={`arrow${s.indicator === 'left' || s.hazard ? ' blink' : ''}`}>{'\u25C0'}</span>
          <span className={`hazard${s.hazard ? ' blink' : ''}`}>{'\u26A0'}</span>
          <span className={`arrow${s.indicator === 'right' || s.hazard ? ' blink' : ''}`}>{'\u25B6'}</span>
          <span className={`belt${s.belt ? '' : ' off'}`} title={t(L, s.belt ? 'hud.beltOn' : 'hud.beltOff')}>{'\u{1F9CD}'}</span>
          <span className="mirrors">
            {(['left', 'rear', 'right'] as const).map(g => <i key={g} className={s.glance === g ? 'on' : ''} />)}
          </span>
        </div>
        <div className="street">{s.street}</div>
      </div>
      <div className="minimap" ref={mapHost} />
      {s.screen === 'drive' && s.exam && <ExamHud exam={s.exam} toast={s.toast} subtitle={s.subtitle} />}
      {s.screen === 'menu' && <StartScreen initial={app.choice()} routeKm={app.routeKm} onStart={app.onStart} />}
      {s.screen === 'debrief' && s.debrief && <Debrief data={s.debrief} roads={app.roads} onRetry={app.onRetry} onMenu={app.onMenu} />}
    </div>
  );
}
