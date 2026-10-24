export type CarClass = 'spark' | 'nexia' | 'cobalt' | 'damas' | 'bus';

export const CAR_CLASSES: Record<CarClass, { length: number; width: number; weight: number }> = {
  spark: { length: 3.6, width: 1.6, weight: 25 },
  nexia: { length: 4.5, width: 1.7, weight: 25 },
  cobalt: { length: 4.5, width: 1.74, weight: 30 },
  damas: { length: 3.5, width: 1.5, weight: 12 },
  bus: { length: 11, width: 2.5, weight: 8 },
};
