import { RenderPipeline } from 'three/webgpu';
import { pass, float, uniform, vec3, saturation, hue } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import type { PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';

/**
 * The post chain that turns a correct frame into a photographed one.
 *
 * Ordering matters and is not arbitrary:
 *   bloom  — light gathers in the HDR buffer, before any tone mapping squashes it
 *   grade  — the karate-poster push: warm highlights, cool shadows, saturated
 *   film   — grain last, so it sits on the final image like real emulsion
 *   vignette — corners fall off last of all
 *
 * `outputColorTransform` is left TRUE, which means tone mapping and the sRGB
 * conversion are applied automatically to whatever we return. The whole graph
 * therefore runs in linear space, which is the only place bloom and grading
 * behave correctly. FXAA is deliberately absent: `antialias: true` already
 * gives the scene pass 4x MSAA (PassNode copies `renderer.samples` onto its
 * render target), and FXAA would additionally force this graph into sRGB space
 * where the bloom would be wrong.
 */
export interface PostStack {
  readonly pipeline: RenderPipeline;
  /** Grain amount, driven up briefly on impact so hits feel physical. */
  readonly grain: { value: number };
  /** 0..1 — how hard the impact bloom and grain punch. */
  readonly punch: { value: number };
  render(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface PostOptions {
  readonly bloomStrength?: number;
  readonly grain?: number;
  readonly saturation?: number;
  readonly vignetteIntensity?: number;
}

export function createPostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  opts: PostOptions = {},
): PostStack {
  const bloomStrength = opts.bloomStrength ?? 0.42;
  const grainAmount = opts.grain ?? 0.06;
  const sat = opts.saturation ?? 1.14;
  const vig = opts.vignetteIntensity ?? 0.38;

  const pipeline = new RenderPipeline(renderer);

  const scenePass = pass(scene, camera);
  const scenePassColor = scenePass.getTextureNode('output');

  // Bloom on the lit scene. The threshold sits high on purpose: a white gi
  // under a warm key light is the brightest surface in the room, and at a low
  // threshold the fighter gets a halo instead of the shoji glow and impact
  // flashes. Only genuinely hot pixels — the lit shoji, a landing hit — bleed.
  const bloomPass = bloom(scenePassColor, bloomStrength, 0.8, 0.95);

  // Warm the highlights, cool the shadows. A vec3 multiply is the cheapest
  // credible split-tone there is, and it is what makes the frame read as warm
  // tungsten light rather than as white balance.
  const splitTone = scenePassColor.add(bloomPass).mul(vec3(1.045, 1.0, 0.955));

  const punch = uniform(0);
  const grain = uniform(grainAmount);

  // Impact push: a momentary saturation lift so a landed technique reads as
  // more vivid than the frames around it.
  const graded = saturation(hue(splitTone, float(0).add(punch.mul(-0.012))), float(sat).add(punch.mul(0.16)));

  const grained = film(graded, grain);
  // `vignette` is typed for a vec3 colour, but it only ever reads `.rgb` and
  // returns the same node it was given with a scalar multiply folded into it.
  // Passing the vec4 colour node is what preserves alpha through the chain.
  pipeline.outputNode = vignette(grained as unknown as ReturnType<typeof vec3>, float(vig), float(0.62));

  // Compile once up front so the first fight does not stall on shader build.
  pipeline.needsUpdate = true;

  return {
    pipeline,
    grain,
    punch,
    render(): void {
      pipeline.render();
    },
    resize(width: number, height: number): void {
      scenePass.setSize(width, height);
    },
    dispose(): void {
      pipeline.dispose();
    },
  };
}
