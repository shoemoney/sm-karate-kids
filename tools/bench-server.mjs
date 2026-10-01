/**
 * A preview server that belongs to the harness that needs it.
 *
 * Started by hand in a background subshell, it did not survive between tool
 * calls, and the next run died on ERR_CONNECTION_REFUSED with nothing pointing
 * at the real cause. A benchmark whose subject can vanish between the build and
 * the measurement is measuring something else. So the server is spawned here,
 * awaited until it actually answers, and killed on the way out.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export const DEFAULT_PORT = 4188;

export async function startPreview(gameDir, port = DEFAULT_PORT) {
  const child = spawn(
    'node',
    [resolve(gameDir, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: gameDir, stdio: 'pipe' },
  );
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });

  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`preview server exited early (${child.exitCode}):\n${log}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        return {
          url,
          port,
          async stop() {
            child.kill('SIGTERM');
            await new Promise((resolveExit) => {
              child.once('exit', resolveExit);
              setTimeout(resolveExit, 5_000);
            });
          },
        };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGKILL');
  throw new Error(`preview server never answered on ${url}:\n${log}`);
}