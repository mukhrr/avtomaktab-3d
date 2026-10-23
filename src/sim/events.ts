export type GameEvent =
  | { type: 'collision'; with: 'car' | 'building'; speed: number; time: number }
  | { type: 'pedestrianHit'; pedId: number; speed: number; time: number };

export class EventBus {
  private queue: GameEvent[] = [];
  private listeners = new Set<(e: GameEvent) => void>();

  emit(e: GameEvent): void {
    this.queue.push(e);
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
