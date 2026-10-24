import { useEffect, useState } from 'react';
import type { Maneuver } from '../exam/route';
import { t } from '../i18n';
import type { ExamHudState, Subtitle, Toast } from './hudStore';

const TOAST_MS = 2500;
const SUBTITLE_MS = 4000;
const ARROWS: Record<Maneuver, string> = {
  start: '↑', straight: '↑', left: '↰', right: '↱', uturn: '↶', finish: '⚑',
};

/** Shows `item` until `ms` after it last changed. */
function useFresh<T extends { seq: number }>(item: T | null, ms: number): T | null {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    setShown(item);
    if (!item) return;
    const id = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(id);
  }, [item?.seq]);
  return shown;
}

export function ExamHud({ exam, toast, subtitle }: { exam: ExamHudState; toast: Toast | null; subtitle: Subtitle | null }) {
  const L = exam.lang;
  const shownToast = useFresh(toast, TOAST_MS);
  const shownSub = useFresh(subtitle, SUBTITLE_MS);
  return (
    <>
      <div className="panel exam">
        <div className="practice">{t(L, 'exam.practiceScoring')}</div>
        {exam.maneuver && (
          <div className="next">
            <span className="dir">{ARROWS[exam.maneuver]}</span>
            <span>{t(L, 'hud.metres', { m: Math.max(0, Math.round(exam.distance / 10) * 10) })}</span>
          </div>
        )}
        <div className="points">{t(L, 'hud.points', { points: exam.total })}</div>
      </div>
      {shownToast && (
        <div className={`toast tier-${shownToast.tier}`}>
          {t(L, `penalty.${shownToast.id}`, shownToast.vars)} · {t(L, 'exam.violation', { points: shownToast.points })}
        </div>
      )}
      {shownSub && <div className="subtitle">{shownSub.text}</div>}
    </>
  );
}
