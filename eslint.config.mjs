import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // calculations.ts is the provided spec engine, used as-is (it has two `any` casts).
  { files: ["lib/calculations.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "spec/**", "test-results/**", "playwright-report/**"]),
]);

export default eslintConfig;
