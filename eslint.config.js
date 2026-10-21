import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "target",
      "src-tauri",
      "src/ipc/bindings",
      "e2e/__screenshots__",
      "test-results",
      "playwright-report",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Only relevant with React Compiler, which Tylia does not use.
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    // Design tokens only: no raw colours in components (docs/DESIGN.md §4.2).
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\b|rgba?[(]/]",
          message: "Use a design token (CSS custom property) instead of a raw colour.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\b|rgba?[(]/]",
          message: "Use a design token (CSS custom property) instead of a raw colour.",
        },
      ],
    },
  },
  {
    files: ["scripts/**", "e2e/**", "*.config.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
