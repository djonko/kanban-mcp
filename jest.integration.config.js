// Integration Jest config: exercises the operations against a LIVE Planka.
// Requires `npm run up` (or a reachable PLANKA_BASE_URL). Kept off the default
// `npm test` / CI path so unit runs stay deterministic.
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
  setupFiles: ["<rootDir>/.jest/integration.setup.js"],
};
