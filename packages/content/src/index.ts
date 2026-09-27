import { allMoveIds, loadContent, type ContentBundle } from '@smkk/sim';
import arenas from '../data/arenas.json' with { type: 'json' };
import fighters from '../data/fighters.json' with { type: 'json' };
import moves from '../data/moves.json' with { type: 'json' };
import rulesets from '../data/rulesets.json' with { type: 'json' };

/**
 * The single validated content bundle. Importing this module is the only
 * supported way to get game data, so nothing can smuggle in unvalidated specs.
 */
export const content: ContentBundle = loadContent(
  { moves, fighters, arenas, rulesets },
  allMoveIds(),
);

export const CONTENT_MOVE_COUNT = content.moves.length;
