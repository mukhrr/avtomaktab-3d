const WINDOW = 300;

const percentile = (sorted: number[], p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];

export interface FrameSummary {
  cpuP50: number;
  cpuP95: number;
  gpuP50: number | null;
  gpuP95: number | null;
  frames: number;
}

export class FrameStats {
  private cpu: number[] = [];
  private gpu: (number | null)[] = [];

  add(cpuMs: number, gpuMs: number | null): void {
    this.cpu.push(cpuMs);
    this.gpu.push(gpuMs);
    if (this.cpu.length > WINDOW) {
      this.cpu.shift();
      this.gpu.shift();
    }
  }

  summary(): FrameSummary {
    const cpu = [...this.cpu].sort((a, b) => a - b);
    const gpu = this.gpu.filter((v): v is number => v !== null).sort((a, b) => a - b);
    return {
      cpuP50: cpu.length ? percentile(cpu, 0.5) : 0,
      cpuP95: cpu.length ? percentile(cpu, 0.95) : 0,
      gpuP50: gpu.length ? percentile(gpu, 0.5) : null,
      gpuP95: gpu.length ? percentile(gpu, 0.95) : null,
      frames: cpu.length,
    };
  }

  reset(): void {
    this.cpu = [];
    this.gpu = [];
  }
}

export interface GpuTimer {
  begin(): void;
  end(): void;
  poll(): number | null;
}

/** Null without EXT_disjoint_timer_query_webgl2. Results arrive a few frames late, so poll() drains finished queries and returns the newest. */
export function createGpuTimer(gl: WebGL2RenderingContext): GpuTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pending: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;
  return {
    begin() {
      if (open || pending.length > 8) return;
      open = gl.createQuery();
      if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    poll() {
      let result: number | null = null;
      while (pending.length) {
        const q = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        if (!disjoint) result = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        gl.deleteQuery(q);
      }
      return result;
    },
  };
}
