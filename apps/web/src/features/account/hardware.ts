import type { HardwareSignals } from '@vertex-hub/contracts';

/** The screen's long and short edge in device pixels, as every browser on the machine reports it. */
export function screenEdges(
  width: number,
  height: number,
  pixelRatio: number,
): HardwareSignals['screen'] {
  const edges = [width, height].map((edge) => Math.round(edge * (pixelRatio || 1)));
  const [long, short] = edges.sort((a, b) => b - a) as [number, number];
  return short >= 1 && long <= 20000 ? { long, short } : null;
}

/** The GPU model from WebGL, unmasked where the browser allows it; null when WebGL is blocked. */
function gpuRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer: unknown = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof renderer === 'string' && renderer ? renderer.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * F01B rule 5: the signals the same machine gives alike in every browser. A signal the browser
 * hides is null; the API normalizes them and keys them only when at least three are known.
 */
export function hardwareSignals(): HardwareSignals {
  const cores = navigator.hardwareConcurrency;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    cores: Number.isInteger(cores) && cores >= 1 && cores <= 512 ? cores : null,
    timeZone: timeZone && timeZone.length <= 64 ? timeZone : null,
    screen: screenEdges(window.screen.width, window.screen.height, window.devicePixelRatio),
    gpu: gpuRenderer(),
  };
}
