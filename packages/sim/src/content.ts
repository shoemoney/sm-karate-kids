import { z } from 'zod';

export const HeightBand = z.enum(['low', 'mid', 'high']);
export type HeightBand = z.infer<typeof HeightBand>;

export const Posture = z.enum(['stand', 'crouch', 'air']);
export type Posture = z.infer<typeof Posture>;

export const MoveSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['strike', 'block']),
  height: HeightBand,
  posture: Posture,
  /** Ticks before the strike becomes dangerous. */
  startup: z.number().int().min(1).max(40),
  /** Ticks the strike can connect. */
  active: z.number().int().min(1).max(20),
  /** Ticks of commitment after the active window. */
  recovery: z.number().int().min(1).max(40),
  /** Metres from the fighter's origin to the strike point. */
  reach: z.number().min(0.5).max(3),
  /** Referee value for a clean, uncountered contact. */
  value: z.enum(['half', 'full']),
  /** Metres travelled forward across startup plus active. */
  advance: z.number().min(-1).max(1.5),
});
export type MoveSpec = z.infer<typeof MoveSpec>;

export const FighterSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Gi colour as a hex string; the chest emblem is applied over it. */
  giColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  beltColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  walkSpeed: z.number().min(0.01).max(0.2),
  /** Metres of horizontal slack allowed on a contact test. */
  hitTolerance: z.number().min(0.1).max(1),
});
export type FighterSpec = z.infer<typeof FighterSpec>;

export const ArenaSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  floorColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  backdropColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  /** Half-width of the legal fighting area in metres. */
  bounds: z.number().min(2).max(12),
});
export type ArenaSpec = z.infer<typeof ArenaSpec>;

export const RulesetSpec = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  pointsToWin: z.number().min(1).max(3),
  /** Bout length in simulation ticks. */
  timerTicks: z.number().int().min(60).max(7200),
  /** Ticks the referee holds the call before the next exchange. */
  refereeTicks: z.number().int().min(1).max(600),
  startSeparation: z.number().min(1).max(6),
});
export type RulesetSpec = z.infer<typeof RulesetSpec>;

export const ContentBundle = z.object({
  moves: z.array(MoveSpec).min(1),
  fighters: z.array(FighterSpec).length(2),
  arenas: z.array(ArenaSpec).min(1),
  rulesets: z.array(RulesetSpec).min(1),
});
export type ContentBundle = z.infer<typeof ContentBundle>;

export class ContentError extends Error {}

/** Validates a raw bundle and proves every grammar move id has frame data. */
export function loadContent(raw: unknown, requiredMoveIds: readonly string[]): ContentBundle {
  const parsed = ContentBundle.safeParse(raw);
  if (!parsed.success) {
    throw new ContentError(`content failed schema validation: ${parsed.error.message}`);
  }
  const bundle = parsed.data;

  const seen = new Set<string>();
  for (const move of bundle.moves) {
    if (seen.has(move.id)) throw new ContentError(`duplicate move id: ${move.id}`);
    seen.add(move.id);
  }

  const missing = requiredMoveIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new ContentError(`grammar references moves with no frame data: ${missing.join(', ')}`);
  }

  const orphans = [...seen].filter((id) => !requiredMoveIds.includes(id));
  if (orphans.length > 0) {
    throw new ContentError(`moves unreachable from the grammar: ${orphans.join(', ')}`);
  }

  return bundle;
}

export function indexMoves(bundle: ContentBundle): ReadonlyMap<string, MoveSpec> {
  return new Map(bundle.moves.map((move) => [move.id, move]));
}
