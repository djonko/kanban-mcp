// Default Jest config: the UNIT suite. CI-safe — no Planka required.
// Integration tests live in a separate project; see jest.integration.config.js.
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // ESM source imports use a .js specifier ("./version.js") that resolves to
    // the .ts source under ts-jest; strip the extension so resolution works.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],
  setupFiles: ["<rootDir>/.jest/unit.setup.js"],
  collectCoverageFrom: [
    "common/**/*.ts",
    "operations/**/*.ts",
    "tools/**/*.ts",
    "!**/*.d.ts",
  ],
};
