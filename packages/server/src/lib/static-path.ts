import { existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Resolves a request path to a file inside `root`, or null if it escapes
 * (#135).
 *
 * The previous handler did `join(clientDist, c.req.path)` and served whatever
 * came back, with no check that the result stayed under the root. It was not
 * exploitable in production, but only because `@hono/node-server` normalises
 * the URL before the handler sees it — i.e. the safety lived in a dependency,
 * not in this code. A change to that normalisation would have silently turned
 * it into arbitrary file read of the whole container. On Windows dev it *was*
 * reachable, since `path.win32.join` treats a decoded `..\` as traversal.
 *
 * Three checks, in order, because each catches something the others miss:
 *   1. containment of the resolved path — the lexical `..` case
 *   2. existence + is-a-file — directories and missing paths fall through
 *   3. containment of the *real* path — a symlink inside the root that points
 *      outside it passes check 1, since resolve() does not follow links
 *
 * `impl` is injectable so the traversal suite can exercise both posix and
 * win32 semantics regardless of the host OS. Windows-only encodings like
 * `..%5c` are meaningless under posix and vice versa, so testing one flavour
 * proves nothing about the other — and the original bug was Windows-specific.
 */
export interface StaticPathImpl {
  join: (...parts: string[]) => string;
  resolve: (...parts: string[]) => string;
  sep: string;
  /** Defaults to node:fs. Overridden in tests to avoid touching disk. */
  exists?: (p: string) => boolean;
  isFile?: (p: string) => boolean;
  realpath?: (p: string) => string;
}

const nodeImpl: Required<StaticPathImpl> = {
  join: path.join,
  resolve: path.resolve,
  sep: path.sep,
  exists: existsSync,
  isFile: (p) => statSync(p).isFile(),
  realpath: realpathSync,
};

/**
 * @param root  Directory files may be served from.
 * @param requestPath  Decoded request path (Hono has already percent-decoded).
 * @returns Absolute path to a real file under `root`, or null.
 */
export function resolveStaticPath(
  root: string,
  requestPath: string,
  impl: StaticPathImpl = nodeImpl,
): string | null {
  const p = { ...nodeImpl, ...impl } as Required<StaticPathImpl>;

  // A null byte truncates the path in some syscalls; reject outright rather
  // than reasoning about how each layer handles it.
  if (requestPath.includes("\0")) return null;

  const resolvedRoot = p.resolve(root);
  const candidate = p.resolve(p.join(resolvedRoot, requestPath));

  // Must be the root itself or strictly beneath it. The separator matters:
  // without it, "/srv/app-evil" passes a naive startsWith("/srv/app").
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + p.sep)) {
    return null;
  }

  if (!p.exists(candidate) || !p.isFile(candidate)) return null;

  // resolve() is purely lexical, so a symlink under the root pointing outside
  // it survives the check above. Re-check the link target.
  let real: string;
  try {
    real = p.realpath(candidate);
  } catch {
    return null;
  }
  const realRoot = (() => {
    try {
      return p.realpath(resolvedRoot);
    } catch {
      return resolvedRoot;
    }
  })();
  if (real !== realRoot && !real.startsWith(realRoot + p.sep)) return null;

  return candidate;
}
