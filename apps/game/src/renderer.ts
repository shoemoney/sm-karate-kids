import { WebGPURenderer } from 'three/webgpu';

export type BackendLabel = 'WebGPU' | 'WebGL 2';

export interface RendererBundle {
  readonly renderer: WebGPURenderer;
  readonly label: BackendLabel;
}

/**
 * WebGPU where the browser has it, WebGL 2 everywhere else. The PRD's rule is
 * that the game degrades rather than refuses to run, so a failed WebGPU init
 * is a fallback, not an error.
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  forceWebGL: boolean,
): Promise<RendererBundle> {
  const attempt = async (webgl: boolean): Promise<RendererBundle> => {
    const renderer = new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      forceWebGL: webgl,
    });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio ?? 1, 2));
    await renderer.init();
    const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
    return { renderer, label: isWebGPU ? 'WebGPU' : 'WebGL 2' };
  };

  if (forceWebGL) return attempt(true);

  try {
    return await attempt(false);
  } catch {
    return attempt(true);
  }
}
