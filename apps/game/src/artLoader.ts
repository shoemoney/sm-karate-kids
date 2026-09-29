import { RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three/webgpu';
import type { Texture } from 'three/webgpu';

/**
 * The one door every generated art asset comes through.
 *
 * Both the stage (room plates) and the juice (impact VFX) load from
 * `apps/game/public/generated/`, and both must survive a missing file: the game
 * boots with an empty room or an untextured hit, never with an exception in the
 * console and a blank canvas. Sharing the loader is what keeps that promise from
 * being two slightly different implementations.
 */

function loadTexture(url: string, opts: { repeat?: number } = {}): Promise<Texture> {
  return new Promise<Texture>((resolve, reject) => {
    new TextureLoader().load(
      url,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        if (opts.repeat !== undefined) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
          texture.repeat.set(opts.repeat, opts.repeat);
        }
        resolve(texture);
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

/**
 * Loads a generated asset, returning null instead of throwing when it is
 * genuinely absent.
 *
 * There is deliberately no HEAD probe here. A HEAD preflight costs a second
 * request per asset and — worse — many CDNs and object stores answer HEAD with
 * 405, at which point this would silently drop the entire art layer and fall
 * back to the procedural room with nothing in the console. TextureLoader
 * already distinguishes "not found" from "loaded", so a single GET is both
 * cheaper and more honest; the warn below is what makes a miss diagnosable.
 */
export async function tryLoad(url: string, opts?: { repeat?: number }): Promise<Texture | null> {
  try {
    return await loadTexture(url, opts ?? {});
  } catch {
    console.warn(
      `[smkk] generated art "${url}" failed to load; the dojo keeps its procedural fallback for this piece`,
    );
    return null;
  }
}

/** `tryLoad` for the generated set, off the app's configured base URL. */
export function loadGenerated(baseUrl: string, name: string, opts?: { repeat?: number }): Promise<Texture | null> {
  return tryLoad(`${baseUrl}generated/${name}`, opts);
}
