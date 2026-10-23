import type { DriveSnapshot } from '../snapshot';
import { COLLISION_DEBOUNCE, COLLISION_NOT_AT_FAULT, COLLISION_STANDING, EPS, OBSTACLE_MIN_SPEED } from './thresholds';
import { violation, type Rule, type Violation } from './types';

/**
 * One crash is one violation however many contacts it makes. GameEvent names no partner for cars or buildings, so
 * each kind (car, building, pedestrian) debounces as one partner from its last charged contact.
 */
export class CollisionRule implements Rule {
  readonly id = 'collision';
  private lastCar = -Infinity;
  private lastWall = -Infinity;
  private lastPed = -Infinity;
  /** The step before, since the impact has already changed this step's speed. */
  private prevSpeed: number | null = null;

  update(s: DriveSnapshot): Violation[] {
    const before = Math.abs(this.prevSpeed ?? s.speed);
    this.prevSpeed = s.speed;
    if (!s.events.length) return [];
    let out: Violation[] | null = null;
    for (const e of s.events) {
      if (e.type === 'pedestrianHit') {
        if (s.t - this.lastPed < COLLISION_DEBOUNCE - EPS) continue;
        this.lastPed = s.t;
        (out ??= []).push(violation('collisionPedestrian', s, { ped: e.pedId }));
      } else if (e.with === 'car') {
        // Standing still, or not moving into the AI car while it moves into the player: rear-ended or cut into.
        const hit = e.approach !== undefined && e.approach.player <= COLLISION_NOT_AT_FAULT && e.approach.other > e.approach.player;
        if (before < COLLISION_STANDING || hit || s.t - this.lastCar < COLLISION_DEBOUNCE - EPS) continue;
        this.lastCar = s.t;
        (out ??= []).push(violation('collisionCar', s, { speed: Math.round(e.speed * 10) / 10 }));
      } else {
        if (e.speed <= OBSTACLE_MIN_SPEED || s.t - this.lastWall < COLLISION_DEBOUNCE - EPS) continue;
        this.lastWall = s.t;
        (out ??= []).push(violation('collisionObstacle', s, { speed: Math.round(e.speed * 10) / 10 }));
      }
    }
    return out ?? [];
  }

  reset(): void {
    this.lastCar = this.lastWall = this.lastPed = -Infinity;
    this.prevSpeed = null;
  }
}
