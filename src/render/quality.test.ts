import { afterEach, describe, expect, it } from 'vitest';
import { loadQuality, pickQuality, QUALITY, saveQuality } from './quality';

describe('pickQuality', () => {
  it('uses thresholds 5 and 10 on cpu when gpu is null', () => {
    expect(pickQuality(null, 5)).toBe('high');
    expect(pickQuality(null, 5.01)).toBe('medium');
    expect(pickQuality(null, 10)).toBe('medium');
    expect(pickQuality(null, 10.01)).toBe('low');
  });

  it('uses the slower of gpu and cpu', () => {
    expect(pickQuality(8, 2)).toBe('medium');
    expect(pickQuality(2, 12)).toBe('low');
    expect(pickQuality(3, 4)).toBe('high');
  });
});

describe('QUALITY', () => {
  it('matches the spec values', () => {
    expect(QUALITY.low.cascades).toBe(1);
    expect(QUALITY.medium.shadowFar).toBe(300);
    expect(QUALITY.high.pixelRatioCap).toBe(2);
    expect(QUALITY.low.groundTextures).toBe(false);
  });
});

describe('quality storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  function stubStorage(): Map<string, string> {
    const m = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
      },
    });
    return m;
  }

  it('round trips a saved value', () => {
    stubStorage();
    saveQuality('high');
    expect(loadQuality()).toBe('high');
  });

  it('returns null when nothing is stored', () => {
    stubStorage();
    expect(loadQuality()).toBeNull();
  });

  it('returns null for an unknown stored value', () => {
    const m = stubStorage();
    m.set('avtomaktab.quality', 'ultra');
    expect(loadQuality()).toBeNull();
  });

  it('survives blocked storage', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    expect(loadQuality()).toBeNull();
    expect(() => saveQuality('low')).not.toThrow();
  });
});
