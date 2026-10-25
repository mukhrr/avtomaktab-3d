import { loadWorld } from '../exam/testDriver';

const DT = 1 / 60;

// Before lane changes these runs cleared 6 to 11 jammed cars each and no car stood longer than 70 s.
describe.each([1, 3, 7, 9, 11])('seed %i, 600 s on the real district with lane changes', seed => {
  test('no NaN, no lasting gridlock, and cars do change lanes', () => {
    const w = loadWorld({ cars: 60, crossers: 40, walkers: 80, seed });
    const player = { position: w.route.start.position, heading: w.route.start.heading, speed: 0, length: 4.48, width: 1.74 };
    const still = new Map<number, { s: number; gen: number }>();
    let cleared = 0, longest = 0;
    for (let i = 0; i < 600 / DT; i++) {
      w.signals.update(DT);
      w.traffic.step(DT, player, w.peds);
      w.peds.step(DT, player, w.traffic.agents, w.signals);
      for (const a of w.traffic.agents) {
        const gen = a.active ? w.traffic.inspect(a.id)!.generation : -1;
        const prev = still.get(a.id);
        if (prev && prev.gen !== gen && prev.s > 60) cleared++;
        if (!a.active) {
          still.set(a.id, { s: 0, gen });
          continue;
        }
        expect(Number.isFinite(a.position[0]) && Number.isFinite(a.position[1])).toBe(true);
        const s = a.speed < 0.5 && prev?.gen === gen ? prev.s + DT : 0;
        longest = Math.max(longest, s);
        still.set(a.id, { s, gen });
      }
    }
    expect(cleared).toBeLessThanOrEqual(20);
    expect(longest).toBeLessThan(125);
    expect(w.traffic.laneChanges).toBeGreaterThan(0);
  }, 60_000);
});
