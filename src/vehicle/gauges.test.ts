import { afterEach, expect, test, vi } from 'vitest';
import { createGaugeCanvas } from './gauges';

const state = { speedKmh: 40, rpm: 2000, indicator: null, blinkOn: false, hazard: false, belt: true, steer: 0, running: true };

function stubDocument() {
  const reads: Uint8ClampedArray[] = [];
  const ctx = new Proxy({ getImageData: (_x: number, _y: number, w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    reads.push(data);
    return { data, width: w, height: h };
  } } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? (() => ({ addColorStop() {} })),
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  return reads;
}

afterEach(() => vi.unstubAllGlobals());

test('each redraw hands the canvas readback to the texture without copying it', () => {
  const reads = stubDocument();
  const gauges = createGaugeCanvas()!;
  for (let i = 0; i < 3; i++) {
    gauges.draw(state);
    expect(gauges.texture.image.data).toBe(reads[i]);
  }
  expect(gauges.texture.version).toBe(3);
});
