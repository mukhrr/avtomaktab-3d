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

export function loadPenalties(): Record<PenaltyId, PenaltyEntry> {
  const raw = table as Record<string, Omit<PenaltyEntry, 'id'>>;
  const out = {} as Record<PenaltyId, PenaltyEntry>;
  for (const id of PENALTY_IDS) out[id] = { id, ...raw[id] } as PenaltyEntry;
  return out;
}
