export type GameEvent =
  | {
    type: 'collision'; with: 'car' | 'building'; speed: number; time: number;
    /** Car contacts: how fast each moved toward the other's centre at contact, m/s (negative: away). */
    approach?: { player: number; other: number };
  }
  | { type: 'pedestrianHit'; pedId: number; speed: number; time: number };

const QUEUE_CAP = 256;

export class EventBus {
  private queue: GameEvent[] = [];
  private listeners = new Set<(e: GameEvent) => void>();

  emit(e: GameEvent): void {
    this.queue.push(e);
    // Nothing drains the queue until M3 scores events, so it would otherwise grow by one per collision.
    if (this.queue.length > QUEUE_CAP) this.queue.shift();
    this.listeners.forEach(fn => fn(e));
  }

  on(fn: (e: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Events emitted since the previous drain. */
  drain(): GameEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}
