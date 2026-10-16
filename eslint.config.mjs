import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

export default defineConfig([
  globalIgnores([
    ".next/**",
    "out/**",
    "node_modules/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Agent worktrees are checkouts of this repo inside it; each is linted on its own.
    ".claude/worktrees/**",
  ]),
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      // Unexplained `any` and unsafe assertions defeat strict mode. Explain any exception inline.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // The scripts run this code under Node's type stripping, which has no enums and no
    // constructor parameter properties. Keep those out of everything a script can import.
    files: ["src/features/**", "src/lib/**", "scripts/**"],
    rules: {
      "@typescript-eslint/parameter-properties": ["error", { prefer: "class-property" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Enums are not supported by Node's type stripping; use a union of literals.",
        },
      ],
    },
  },
  {
    // The one line writer every logger uses wraps console.
    files: ["src/lib/log-line.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Command-line tools (the seed import) report on the terminal.
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
]);
