import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Flexible defaults — avoid noisy rules
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "interface",
          format: ["PascalCase"],
          prefix: ["I"],
        },
      ],
      "no-console": "off",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "prefer-const": "warn",
      "preserve-caught-error": "off",
      "sort-imports": ["error", { ignoreDeclarationSort: true }],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "scripts/", "templates/", "**/*.test.ts", "**/__tests__/"],
  }
);
