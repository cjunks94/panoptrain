import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Flat config, replacing the old `.eslintrc.cjs` (#144).
 *
 * Context: `pnpm lint` had never actually run. ESLint was not installed
 * anywhere — the root package.json had no dependencies at all — and CI's
 * matrix was `[typecheck, test]`, so nothing surfaced it. The rules below are
 * carried over from `.eslintrc.cjs` unchanged so this is a tooling fix, not a
 * silent change of standards.
 *
 * ESLint 9 defaults to flat config; keeping the eslintrc format would have
 * meant pinning ESLint 8 or setting ESLINT_USE_FLAT_CONFIG=false, i.e.
 * adopting a deprecated path on a repo that is otherwise current.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/.playwright-cache/**",
      "packages/server/src/data/**",
      "flake-runs/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // React rules for the client.
  //
  // Only the two classic rules are enabled. eslint-plugin-react-hooks v6's
  // `recommended` preset also turns on the React Compiler rule set
  // (set-state-in-effect, refs-during-render, purity, ...), which reports 19
  // violations across TransitMap/App today. Those are real signals but each
  // needs a genuine refactor with behaviour risk — turning them on here would
  // either block this PR behind that work or force a blanket suppression that
  // hides them permanently.
  //
  // rules-of-hooks is an error (violations are always bugs). exhaustive-deps
  // is a warning: this repo has legitimate, commented deliberate-omission
  // cases, and #134 showed the rule cannot see a dependency that isn't
  // referenced in the effect body anyway.
  //
  // Follow-up issue filed to enable the compiler rules incrementally.
  {
    files: ["packages/client/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Test files: relax the rules that fight test ergonomics. Casting partial
  // fixtures and reaching into internals is normal in tests and enforcing
  // production-strength typing there produces noise, not safety.
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Build/config scripts run in Node and legitimately use its globals.
  {
    files: ["**/*.config.{ts,js}", "packages/server/scripts/**/*.ts", "packages/e2e/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
);
