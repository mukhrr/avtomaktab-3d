import table from '../../data/exam/penalties.json';

export const PENALTY_IDS = [
  'redLight', 'yellowEntry', 'stopLinePast', 'noFullStopAtStopSign', 'pedestrianNotYielded',
  'vehicleNotYielded', 'oncomingLane', 'wrongWayOneway', 'noEntry', 'turnRestriction',
  'collisionCar', 'collisionPedestrian', 'collisionObstacle', 'speeding', 'speedingSevere',
  'noIndicator', 'noMirrorCheck', 'wrongLaneForTurn', 'tailgating', 'harshBraking', 'stall',
  'rollBack', 'noSeatBelt', 'stoppedOnCrossing', 'noIndicatorPullOff',
] as const;

export type PenaltyId = (typeof PENALTY_IDS)[number];
export type Tier = 'fail' | 'high' | 'low';

export interface PenaltyEntry {
  id: PenaltyId;
  tier: Tier;
  points: number;
  clause: string | null;
  source: string | null;
  unverified: boolean;
}

const TIER_POINTS: Record<Tier, number> = { fail: 100, high: 20, low: 5 };

export function validatePenalties(raw: unknown): Record<PenaltyId, PenaltyEntry> {
  const rows = (raw ?? {}) as Record<string, Partial<Omit<PenaltyEntry, 'id'>> | undefined>;
  const out = {} as Record<PenaltyId, PenaltyEntry>;
  for (const id of PENALTY_IDS) {
    const e = rows[id];
    if (!e) throw new Error(`penalties: missing entry "${id}"`);
    if (!e.tier || !(e.tier in TIER_POINTS)) throw new Error(`penalties: "${id}" has unknown tier "${e.tier}"`);
    if (e.points !== TIER_POINTS[e.tier]) {
      throw new Error(`penalties: "${id}" points ${e.points} do not match tier ${e.tier} (${TIER_POINTS[e.tier]})`);
    }
    const sourced = Boolean(e.clause) && Boolean(e.source);
    if (e.unverified ? e.clause != null : !sourced) {
      throw new Error(`penalties: "${id}" needs clause and source, or clause null with unverified true`);
    }
    out[id] = { id, tier: e.tier, points: e.points, clause: e.clause ?? null, source: e.source ?? null, unverified: Boolean(e.unverified) };
  }
  return out;
}

export function loadPenalties(): Record<PenaltyId, PenaltyEntry> {
  return validatePenalties(table);
}
