import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // The CLI argv parsing converts unknown→typed via local `as`; the parsed
      // object shape is verified by tests, not the type system.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // process.exit is the right thing in a CLI entry.
      "no-process-exit": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      // Tests deliberately check loosely-typed parser output via discriminated
      // unions, so a few non-null assertions are fine.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
