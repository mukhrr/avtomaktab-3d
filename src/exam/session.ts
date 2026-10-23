import { subtitle, VoicePlayer, type AudioBackend } from '../audio/voice';
import type { Lang } from '../i18n';
import type { DistrictData, Vec2 } from '../shared/district';
import type { SignalSystem } from '../sim/signals';
import type { SignSystem } from '../sim/signs';
import type { LaneNetwork } from '../traffic/lanes';
import { project as along } from '../traffic/turns';
import type { Gearbox } from '../vehicle/drivetrain';
import { Examiner, type ExamPhase, type ExamResult, type Prompt } from './examiner';
import { MapMatcher } from './mapMatch';
import type { PenaltyEntry, PenaltyId } from './penalties';
import type { ExamRoute, Maneuver, Pose } from './route';
import { CollisionRule } from './rules/collisions';
import { RuleEngine } from './rules/engine';
import { HarshBrakingRule, RollBackRule, StallRule } from './rules/handling';
import { WrongLaneForTurnRule } from './rules/lanes';
import { OncomingLaneRule, StoppedOnCrossingRule } from './rules/position';
import { RoadInfo } from './rules/road';
import { IndicatorRule, MirrorCheckRule, PullOffRule, SeatBeltRule } from './rules/signalling';
import { RedLightRule, StopLinePastRule, YellowEntryRule } from './rules/signals';
import { NoEntryRule, StopSignRule, TurnRestrictionRule, WrongWayOnewayRule } from './rules/signs';
import { SpeedRule, TailgatingRule } from './rules/speed';
import type { Rule } from './rules/types';
import { PedestrianYieldRule, VehicleYieldRule } from './rules/yielding';
import { buildSnapshot, type SnapshotContext, type SnapshotInput } from './snapshot';

export type SessionFrame = Omit<SnapshotInput, 'prevSpeed'>;

export interface ExamSessionDeps {
  d: DistrictData;
  net: LaneNetwork;
  signals: SignalSystem;
  signs: SignSystem;
  peds: SnapshotContext['peds'];
  traffic: SnapshotContext['traffic'];
  route: ExamRoute;
  penalties: Record<PenaltyId, PenaltyEntry>;
  playerLength: number;
  /** Puts the car at rest on `pose` in `gearbox`, belt off, with the traffic around it cleared. */
  placeCar(pose: Pose, gearbox: Gearbox): void;
  rules?: Rule[];
  audio?: AudioBackend;
  audioBase?: string;
}

export function examRules(road: RoadInfo): Rule[] {
  return [
    new RedLightRule(), new YellowEntryRule(), new StopLinePastRule(), new StopSignRule(road), new NoEntryRule(road),
    new TurnRestrictionRule(road), new WrongWayOnewayRule(road), new SpeedRule(), new TailgatingRule(),
    new IndicatorRule(road), new MirrorCheckRule(road), new PullOffRule(), new SeatBeltRule(), new WrongLaneForTurnRule(road),
    new PedestrianYieldRule(), new VehicleYieldRule(road), new OncomingLaneRule(road), new StoppedOnCrossingRule(),
    new CollisionRule(), new HarshBrakingRule(), new StallRule(), new RollBackRule(),
  ];
}

/** One exam drive at a time: matcher, rules, examiner and voice, fed once per fixed step. */
export class ExamSession {
  onPrompt?: (p: Prompt) => void;
  /** Direction and result lines as they are spoken; violations come through onPrompt only. */
  onSubtitle?: (text: string) => void;
  onEnd?: (r: ExamResult) => void;
  readonly routeLine: Vec2[];
  private readonly engine: RuleEngine;
  private examiner: Examiner | null = null;
  private matcher: MapMatcher | null = null;
  private voice: VoicePlayer | null = null;
  private _lang: Lang = 'uz';
  private _prompts: Prompt[] = [];
  private prevSpeed = 0;
  private t0: number | null = null;
  private ended = false;
  private violationLines: string[] = [];

  constructor(private readonly deps: ExamSessionDeps) {
    this.engine = new RuleEngine(deps.rules ?? examRules(new RoadInfo(deps.d, deps.net, deps.signs)));
    this.routeLine = routeLine(deps.net, deps.route);
  }

  get phase(): ExamPhase | null {
    return this.examiner?.phase ?? null;
  }

  get active(): boolean {
    return this.phase === 'briefing' || this.phase === 'driving';
  }

  get lang(): Lang {
    return this._lang;
  }

  get prompts(): readonly Prompt[] {
    return this._prompts;
  }

  get result(): ExamResult | null {
    return this.examiner?.result ?? null;
  }

  /** Sim time of the first step; violation times are absolute. */
  get startT(): number {
    return this.t0 ?? 0;
  }

  get nextManeuver(): { maneuver: Maneuver; distance: number } | null {
    return this.examiner?.nextManeuver ?? null;
  }

  get penalties(): Record<PenaltyId, PenaltyEntry> {
    return this.deps.penalties;
  }

  start(lang: Lang, gearbox: Gearbox): void {
    this.voice?.stop();
    this._lang = lang;
    this.deps.placeCar(this.deps.route.start, gearbox);
    // Rules reset after the car is placed: PullOffRule arms on the first stop it sees.
    this.engine.reset();
    this.matcher = new MapMatcher(this.deps.d, this.deps.net);
    this.examiner = new Examiner(this.deps.route, this.deps.net, this.deps.penalties, this.deps.d, this.engine);
    this.voice = new VoicePlayer(lang, this.deps.audioBase ?? '/audio', this.deps.audio);
    this.voice.onSubtitle = text => {
      const k = this.violationLines.indexOf(text);
      if (k >= 0) this.violationLines.splice(k, 1);
      else this.onSubtitle?.(text);
    };
    this.violationLines = [];
    this._prompts = [];
    this.prevSpeed = 0;
    this.t0 = null;
    this.ended = false;
  }

  step(f: SessionFrame): void {
    const ex = this.examiner;
    if (!ex || !this.matcher || !this.active) return;
    const { d, net, signals, signs, peds, traffic, playerLength } = this.deps;
    const s = buildSnapshot({ d, net, matcher: this.matcher, signals, signs, peds, traffic, playerLength }, { ...f, prevSpeed: this.prevSpeed });
    this.prevSpeed = f.speed;
    const violations = this.engine.update(s);
    const briefing = ex.phase === 'briefing';
    this.t0 ??= f.t;
    this.emit(ex.update(s, briefing ? [] : violations));
    // The brief is one step long: Examiner drops violations while briefing, so rules go live at once.
    if (briefing) ex.start();
    this.checkEnd();
  }

  /** R, a reset or the menu during a drive. */
  abandon(): void {
    if (!this.examiner || !this.active) return;
    this.examiner.abandon();
    this.voice?.stop();
    this.checkEnd();
  }

  /** Leaving the result screen: nothing more should be said. */
  silence(): void {
    this.voice?.stop();
  }

  private emit(prompts: Prompt[]): void {
    for (const p of prompts) {
      this._prompts.push(p);
      if (p.key === 'exam.violation') this.violationLines.push(subtitle(this._lang, p));
      this.voice?.say(p);
      this.onPrompt?.(p);
    }
  }

  private checkEnd(): void {
    if (this.ended || this.active || !this.examiner) return;
    this.ended = true;
    this.onEnd?.(this.examiner.result);
  }
}

/** The route as driven: start pose, each lane and connector, finish pose. */
function routeLine(net: LaneNetwork, route: ExamRoute): Vec2[] {
  const out: Vec2[] = [];
  const last = route.steps.length - 1;
  route.steps.forEach((step, i) => {
    const pts = net.path(step.ref).points;
    const a = i === 0 ? along(pts, route.start.position) : 0;
    const b = i === last ? along(pts, route.finish.position) : Infinity;
    if (i === 0) out.push(route.start.position);
    let s = 0;
    for (let k = 0; k < pts.length; k++) {
      if (k) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (s > a && s < b) out.push(pts[k]);
    }
    if (i === last) out.push(route.finish.position);
    else out.push(...net.connector(step.ref, route.steps[i + 1].ref));
  });
  return out;
}
