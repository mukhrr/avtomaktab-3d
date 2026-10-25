export type CarClass = 'spark' | 'nexia' | 'cobalt' | 'lacetti' | 'damas' | 'taxi' | 'bus';

/** weight is the spawn share in percent. */
export const CAR_CLASSES: Record<CarClass, { length: number; width: number; weight: number }> = {
  spark: { length: 3.6, width: 1.6, weight: 14 },
  nexia: { length: 4.5, width: 1.7, weight: 18 },
  cobalt: { length: 4.5, width: 1.74, weight: 26 },
  lacetti: { length: 4.5, width: 1.73, weight: 12 },
  damas: { length: 3.5, width: 1.5, weight: 8 },
  taxi: { length: 4.5, width: 1.74, weight: 14 },
  bus: { length: 11, width: 2.5, weight: 8 },
};

const CLASSES = Object.keys(CAR_CLASSES) as CarClass[];
const CLASS_SUM = CLASSES.reduce((s, c) => s + CAR_CLASSES[c].weight, 0);

export const WHITE = 0xf2f2ef;
export const TAXI_YELLOW = 0xf3c623;
export const TAXI_SIGN = 0xffffff;

export const PAINT: readonly { colour: number; weight: number }[] = [
  { colour: WHITE, weight: 40 },
  { colour: 0xb8bcc0, weight: 22 },
  { colour: 0x1d1f22, weight: 12 },
  { colour: 0x4a4d52, weight: 6 },
  { colour: 0x7a1f24, weight: 5 },
  { colour: 0x1f3f7a, weight: 5 },
  { colour: 0xd8c9a3, weight: 5 },
  { colour: 0x8fb4d6, weight: 5 },
];
const PAINT_SUM = PAINT.reduce((s, p) => s + p.weight, 0);

/** r is one uniform draw in [0, 1). */
export function pickClass(r: number): CarClass {
  let x = r * CLASS_SUM;
  for (const c of CLASSES) {
    x -= CAR_CLASSES[c].weight;
    if (x < 0) return c;
  }
  return CLASSES[CLASSES.length - 1];
}

/** r is always consumed so taxis and buses keep the caller's draw sequence. */
export function pickPaint(r: number, carClass: CarClass): number {
  if (carClass === 'taxi') return TAXI_YELLOW;
  if (carClass === 'bus') return WHITE;
  let x = r * PAINT_SUM;
  for (const p of PAINT) {
    x -= p.weight;
    if (x < 0) return p.colour;
  }
  return PAINT[PAINT.length - 1].colour;
}
