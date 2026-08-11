import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveStaticPath, type StaticPathImpl } from "../static-path.js";

/**
 * Path-containment suite for the static file handler (#135).
 *
 * Run against BOTH posix and win32 path semantics regardless of host OS.
 * That is the whole point: the original handler was safe on Linux only
 * because @hono/node-server normalises the URL before the handler runs, while
 * on Windows `path.win32.join` treats a decoded `..\` as traversal and the
 * leak was real. Testing one flavour proves nothing about the other.
 *
 * fs is faked so the suite never touches disk and can model a symlink that
 * escapes the root — the case a purely lexical resolve() cannot catch.
 */

interface FakeFs {
  files: Set<string>;
  dirs?: Set<string>;
  /** path -> real path, for modelling symlinks. */
  links?: Record<string, string>;
}

function makeImpl(flavour: typeof path.posix | typeof path.win32, fs: FakeFs): StaticPathImpl {
  const norm = (p: string) => p;
  return {
    join: flavour.join,
    resolve: flavour.resolve,
    sep: flavour.sep,
    exists: (p) => fs.files.has(norm(p)) || (fs.dirs?.has(norm(p)) ?? false),
    isFile: (p) => fs.files.has(norm(p)),
    realpath: (p) => fs.links?.[norm(p)] ?? p,
  };
}

describe("resolveStaticPath — posix", () => {
  const ROOT = "/srv/app/dist";
  const fs: FakeFs = {
    files: new Set([
      "/srv/app/dist/index.html",
      "/srv/app/dist/assets/main.js",
      "/etc/passwd",
      "/srv/app/secret.env",
    ]),
    dirs: new Set(["/srv/app/dist", "/srv/app/dist/assets"]),
  };
  const impl = makeImpl(path.posix, fs);

  it("serves a real file under the root", () => {
    expect(resolveStaticPath(ROOT, "/index.html", impl)).toBe("/srv/app/dist/index.html");
    expect(resolveStaticPath(ROOT, "/assets/main.js", impl)).toBe("/srv/app/dist/assets/main.js");
  });

  it.each([
    ["/../secret.env"],
    ["/../../etc/passwd"],
    ["/assets/../../secret.env"],
    ["/./../../etc/passwd"],
    ["/....//....//etc/passwd"],
    ["/..//../etc/passwd"],
  ])("rejects traversal %s", (req) => {
    expect(resolveStaticPath(ROOT, req, impl)).toBeNull();
  });

  it("treats a leading-slash request path as relative to the root, not absolute", () => {
    // join(root, "/etc/passwd") is "/srv/app/dist/etc/passwd" — contained, so
    // this is NOT traversal and must not be rejected on containment grounds.
    // It returns null here only because no such file exists. Worth pinning:
    // an earlier version of this test asserted the right outcome for the
    // wrong reason, which would have masked a containment regression.
    expect(resolveStaticPath(ROOT, "/etc/passwd", impl)).toBeNull();

    const served: FakeFs = {
      files: new Set(["/srv/app/dist/etc/passwd"]),
      dirs: new Set(["/srv/app/dist"]),
    };
    expect(resolveStaticPath(ROOT, "/etc/passwd", makeImpl(path.posix, served))).toBe(
      "/srv/app/dist/etc/passwd",
    );
  });

  it("rejects a directory", () => {
    expect(resolveStaticPath(ROOT, "/assets", impl)).toBeNull();
  });

  it("rejects a missing file", () => {
    expect(resolveStaticPath(ROOT, "/nope.js", impl)).toBeNull();
  });

  it("rejects a null byte", () => {
    expect(resolveStaticPath(ROOT, "/index.html\0.png", impl)).toBeNull();
  });

  it("does not treat a sibling directory with the same prefix as inside the root", () => {
    // "/srv/app/dist-evil" must not pass a naive startsWith("/srv/app/dist").
    const sneaky: FakeFs = {
      files: new Set(["/srv/app/dist-evil/pwn.js"]),
      dirs: new Set(["/srv/app/dist"]),
    };
    expect(resolveStaticPath(ROOT, "/../dist-evil/pwn.js", makeImpl(path.posix, sneaky))).toBeNull();
  });

  it("rejects a symlink under the root that points outside it", () => {
    // Lexical resolution alone cannot catch this — resolve() doesn't follow
    // links, so the candidate looks contained until realpath is consulted.
    const linked: FakeFs = {
      files: new Set(["/srv/app/dist/leak.txt"]),
      dirs: new Set(["/srv/app/dist"]),
      links: { "/srv/app/dist/leak.txt": "/etc/passwd", "/srv/app/dist": "/srv/app/dist" },
    };
    expect(resolveStaticPath(ROOT, "/leak.txt", makeImpl(path.posix, linked))).toBeNull();
  });

  it("allows a symlink that stays inside the root", () => {
    const linked: FakeFs = {
      files: new Set(["/srv/app/dist/alias.js"]),
      dirs: new Set(["/srv/app/dist"]),
      links: {
        "/srv/app/dist/alias.js": "/srv/app/dist/assets/main.js",
        "/srv/app/dist": "/srv/app/dist",
      },
    };
    expect(resolveStaticPath(ROOT, "/alias.js", makeImpl(path.posix, linked))).toBe(
      "/srv/app/dist/alias.js",
    );
  });
});

/**
 * The lexical containment and null-byte guards are deliberately redundant
 * with the realpath check for the *reject/allow* outcome — that is
 * defence in depth. Asserting only on the return value therefore cannot tell
 * them apart, and mutation-testing showed removing either still passed.
 *
 * What makes them load-bearing is *when* they run: both reject before any fs
 * call, so an escaping path is never stat'd. That is the property worth
 * pinning — it keeps attacker-controlled strings out of syscalls entirely,
 * and avoids an existence oracle via timing or error behaviour.
 */
describe("resolveStaticPath — rejects before touching the filesystem", () => {
  const ROOT = "/srv/app/dist";

  function spyImpl() {
    const calls: string[] = [];
    const impl: StaticPathImpl = {
      join: path.posix.join,
      resolve: path.posix.resolve,
      sep: path.posix.sep,
      exists: (p) => {
        calls.push(`exists:${p}`);
        return true;
      },
      isFile: (p) => {
        calls.push(`isFile:${p}`);
        return true;
      },
      realpath: (p) => {
        calls.push(`realpath:${p}`);
        return p;
      },
    };
    return { impl, calls };
  }

  it.each([
    ["/../../etc/passwd"],
    ["/../secret.env"],
    ["/assets/../../../etc/shadow"],
  ])("makes no fs call for escaping path %s", (req) => {
    const { impl, calls } = spyImpl();
    expect(resolveStaticPath(ROOT, req, impl)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("makes no fs call for a path containing a null byte", () => {
    const { impl, calls } = spyImpl();
    expect(resolveStaticPath(ROOT, "/index.html\0.png", impl)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("does reach the filesystem for a legitimately contained path", () => {
    // Control: proves the assertions above are about containment, not about
    // the spy never being wired up.
    const { impl, calls } = spyImpl();
    expect(resolveStaticPath(ROOT, "/assets/main.js", impl)).toBe("/srv/app/dist/assets/main.js");
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("resolveStaticPath — win32", () => {
  const ROOT = "C:\\app\\dist";
  const fs: FakeFs = {
    files: new Set([
      "C:\\app\\dist\\index.html",
      "C:\\app\\dist\\assets\\main.js",
      "C:\\app\\SECRET.txt",
    ]),
    dirs: new Set(["C:\\app\\dist", "C:\\app\\dist\\assets"]),
  };
  const impl = makeImpl(path.win32, fs);

  it("serves a real file under the root", () => {
    expect(resolveStaticPath(ROOT, "/index.html", impl)).toBe("C:\\app\\dist\\index.html");
  });

  it.each([
    // These are the decoded forms of the payloads that leaked on Windows dev:
    // /..%5cSECRET.txt and /%2e%2e%5cSECRET.txt
    ["/..\\SECRET.txt"],
    ["\\..\\SECRET.txt"],
    ["/../SECRET.txt"],
    ["/assets\\..\\..\\SECRET.txt"],
  ])("rejects backslash traversal %s", (req) => {
    expect(resolveStaticPath(ROOT, req, impl)).toBeNull();
  });

  it("rejects a drive-absolute path outside the root", () => {
    expect(resolveStaticPath(ROOT, "C:\\app\\SECRET.txt", impl)).toBeNull();
  });

  it("rejects a sibling directory sharing the root's prefix", () => {
    const sneaky: FakeFs = {
      files: new Set(["C:\\app\\dist-evil\\pwn.js"]),
      dirs: new Set(["C:\\app\\dist"]),
    };
    expect(
      resolveStaticPath(ROOT, "/..\\dist-evil\\pwn.js", makeImpl(path.win32, sneaky)),
    ).toBeNull();
  });
});
