import { defineConfig } from 'vite';

// The arcade serves /api from the same origin. Locally, point it at an arcade
// API on its usual port so the leaderboard can be exercised end to end.
const arcadeApi = { '/api': 'http://127.0.0.1:3784' };

export default defineConfig({
  base: './',
  // sourcemap is OFF, and that is a decision about where the convention is
  // enforced. It was `true` from the start of the project. `sourcemap: false`
  // emits two things: a 6.28MB .js.map, and a `//# sourceMappingURL=` pointer
  // at the end of the bundle that names it.
  //
  // The arcade's release path (SMA-arcade ops/build-release.py copy_static)
  // copies every file in dist and filters only symlinks, .sqlite and .db — it
  // has never filtered .map. So the no-sourcemaps convention was being held by
  // a person deleting the file after a deploy, not by any script: the r162
  // release shipped one, r163 deleted it by hand, and nothing in the next
  // release would have stopped it coming straight back.
  //
  // Worse, deleting the file leaves the pointer. Measured off the wire at r164,
  // the served bundle ended in `//# sourceMappingURL=index-CEpXIazX.js.map`
  // while that URL answered 404 — a shipped artifact referencing a file the
  // same artifact does not ship. Nothing was obviously broken and nothing said
  // so, because "does the served bytes match the built bytes" cannot see a
  // reference that resolves to nothing.
  //
  // Turning it off at the build means there is no map for a release to forget
  // to delete and no pointer for it to leave dangling. The cost is a minified
  // stack trace from `vite preview`; debugging here goes through Playwright
  // against real source, so nothing in the loop reads those maps.
  build: { target: 'es2022', sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, proxy: arcadeApi },
  preview: { proxy: arcadeApi },
});
