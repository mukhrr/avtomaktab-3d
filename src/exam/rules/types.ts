import type { Vec2 } from '../../shared/district';
import type { PenaltyId } from '../penalties';
import type { DriveSnapshot } from '../snapshot';

export interface Violation {
  id: PenaltyId;
  t: number;
  position: Vec2;
  detail?: Record<string, string | number>;
}

export interface Rule {
  id: string;
  update(s: DriveSnapshot): Violation[];
  reset(): void;
}

export const violation = (id: PenaltyId, s: DriveSnapshot, detail?: Violation['detail']): Violation =>
  detail ? { id, t: s.t, position: s.position, detail } : { id, t: s.t, position: s.position };
