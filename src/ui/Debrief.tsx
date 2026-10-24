import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { Vec2 } from '../shared/district';
import { fitBounds, markerLayout, project } from './debriefMap';
import type { DebriefData } from './hudStore';

const MAP = { w: 520, h: 360 };
const MAP_MARGIN = 60;
const MARKER_R = 10;
const TIER_COLOURS: Record<string, string> = { fail: '#ff4d3a', high: '#ffb02e', low: '#f2d74e' };

const clock = (s: number) => {
  const whole = Math.max(0, Math.round(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function drawMap(canvas: HTMLCanvasElement, roads: Vec2[][], d: DebriefData): void {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = MAP.w * dpr;
  canvas.height = MAP.h * dpr;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  g.fillStyle = '#1d2126';
  g.fillRect(0, 0, MAP.w, MAP.h);
  const vs = d.result.violations;
  const b = fitBounds([...d.routeLine, ...vs.map(v => v.position)], MAP, MAP_MARGIN);
  const line = (pts: Vec2[], colour: string, width: number) => {
    const px = project(pts, b, MAP);
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    px.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  };
  g.lineCap = g.lineJoin = 'round';
  for (const r of roads) line(r, '#4a525c', 3);
  line(d.routeLine, '#3d8bff', 4);
  const ends = project([d.routeLine[0], d.routeLine[d.routeLine.length - 1]], b, MAP);
  ends.forEach(([x, y], i) => {
    g.fillStyle = i ? '#3ddc5a' : '#fff';
    g.beginPath();
    g.arc(x, y, 5, 0, 2 * Math.PI);
    g.fill();
  });
  const spots = markerLayout(project(vs.map(v => v.position), b, MAP));
  g.font = 'bold 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  spots.forEach(([x, y], i) => {
    g.fillStyle = TIER_COLOURS[d.penalties[vs[i].id].tier] ?? '#fff';
    g.beginPath();
    g.arc(x, y, MARKER_R, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = '#000a';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#111';
    g.fillText(String(i + 1), x, y + 0.5);
  });
}

export function Debrief({ data, roads, onRetry, onMenu }: { data: DebriefData; roads: Vec2[][]; onRetry: () => void; onMenu: () => void }) {
  const L = data.lang, r = data.result;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawMap(canvas.current, roads, data);
  }, [data, roads]);
  const verdict = r.phase === 'abandoned' ? t(L, 'debrief.abandoned') : r.passed ? t(L, 'exam.passed') : t(L, 'exam.failed');
  return (
    <div className="overlay">
      <div className="card debrief">
        <div className="practice">{t(L, 'exam.practiceScoring')}</div>
        <h1 className={r.passed ? 'pass' : 'fail'}>{verdict}</h1>
        <div className="facts">
          <span>{t(L, 'debrief.total')}: <b>{r.total}</b></span>
          <span>{t(L, 'debrief.duration')}: <b>{clock(r.durationS)}</b></span>
          <span>{t(L, 'debrief.distance')}: <b>{t(L, 'debrief.km', { km: (r.distanceM / 1000).toFixed(2) })}</b></span>
        </div>
        <div className="body">
          <canvas ref={canvas} style={{ width: MAP.w, height: MAP.h }} />
          <div className="list">
            <h2>{t(L, 'debrief.violations')}</h2>
            {r.violations.length === 0 && <p>{t(L, 'debrief.none')}</p>}
            <ol>
              {r.violations.map((v, i) => (
                <li key={i}>
                  <i style={{ background: TIER_COLOURS[data.penalties[v.id].tier] }}>{i + 1}</i>
                  <span className="time">{clock(v.t - data.startT)}</span>
                  <span className="text">{t(L, `penalty.${v.id}`, v.detail)}</span>
                  <b>{t(L, 'exam.violation', { points: data.penalties[v.id].points })}</b>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="buttons">
          <button type="button" className="go" onClick={onRetry}>{t(L, 'debrief.retry')}</button>
          <button type="button" onClick={onMenu}>{t(L, 'debrief.menu')}</button>
        </div>
      </div>
    </div>
  );
}
