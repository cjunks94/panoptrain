import { defineConfig } from "vitest/config";

/**
 * Coverage thresholds are a ratchet, not the target (#144).
 *
 * The workspace standard is 80%. These are pinned just below the *measured*
 * numbers at the time coverage tooling was first installed, so CI enforces
 * "don't regress" from day one instead of failing on a pre-existing gap.
 * Raise them as coverage improves — that is the point of a ratchet.
 *
 * Measured when set (with `all: true`, i.e. counting untested files):
 *   statements 79.15  branches 72.33  functions 72.44  lines 80.62
 */
export default defineConfig({
  test: {
    // Discover tests in src/ only. `pnpm build` emits compiled copies of the
    // test files into dist/, and vitest's default glob would then run both --
    // the dist copies resolve data paths relative to dist/ and fail. CI hides
    // this because build and test are separate jobs, but it breaks any local
    // `build && test`.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      // Count every source file, not only those a test happens to import.
      // Without this, coverage measures "of the code we test, how much did we
      // cover" — which flatters the number and hides untested modules.
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.ts",
        // Test-only mock server + fixtures; not shipped behaviour.
        "src/test-mocks.ts",
        "src/index-e2e.ts",
        "src/data/**",
      ],
      reporter: ["text-summary", "lcov"],
      thresholds: {
        statements: 78,
        branches: 71,
        functions: 71,
        lines: 79,
      },
    },
  },
});
