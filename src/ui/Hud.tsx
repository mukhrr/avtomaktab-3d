import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { REDLINE_RPM } from '../vehicle/drivetrain';
import type { HudStore } from './hudStore';

const TACH_MAX = 7000;
const HELP_KEY = 'avtomaktab.helpDismissed';

const readDismissed = () => {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
};

export function Hud({ store, minimap, debug }: { store: HudStore; minimap: HTMLCanvasElement; debug: boolean }) {
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
  return (
    <div className="hud">
      {help && (
        <div className="panel help">
          <b>W/S</b> gas / brake · <b>A/D</b> steer · <b>Space</b> handbrake<br />
          Manual: <b>Shift</b> clutch · <b>E/Q</b> gear up/down · <b>I</b> ignition<br />
          <b>G</b> auto/manual (when stopped) · <b>C</b> camera · <b>R</b> reset · <b>H</b> hide help
        </div>
      )}
      {debug && <div className="panel stats">{s.fps} fps · {s.drawCalls} draw calls</div>}
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
        {!s.running && <div className="stalled">STALLED, press I</div>}
        <div className="street">{s.street}</div>
      </div>
      <div className="minimap" ref={mapHost} />
    </div>
  );
}
