import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Verification output. Holds a throwaway Chrome user-data dir, whose
    // minified internals otherwise dominate the report: 49 errors and 2857
    // warnings from code we neither wrote nor ship.
    ".verify/**",
  ]),
]);

export default eslintConfig;
