// Integration-test environment.
//
// Provides real Planka credentials (env-overridable so the run can target
// whatever host/port the container exposes) and a connectivity precheck.
//
// Unlike the original setup, a failed check THROWS rather than calling
// process.exit(1): a thrown error in a setup file fails the Jest run with a
// readable message instead of killing the process from under the reporter.
process.env.PLANKA_BASE_URL = process.env.PLANKA_BASE_URL || "http://localhost:3333";
process.env.PLANKA_AGENT_EMAIL = process.env.PLANKA_AGENT_EMAIL || "demo@demo.demo";
process.env.PLANKA_AGENT_PASSWORD = process.env.PLANKA_AGENT_PASSWORD || "demo";
process.env.PLANKA_ADMIN_EMAIL = process.env.PLANKA_ADMIN_EMAIL || "demo@demo.demo";
process.env.PLANKA_ADMIN_USERNAME = process.env.PLANKA_ADMIN_USERNAME || "demo";

const baseUrl = process.env.PLANKA_BASE_URL;

let response;
try {
  // Node 18+ ships a global fetch, so no node-fetch dependency is needed here.
  response = await fetch(`${baseUrl}/api/users`);
} catch (error) {
  const cause = error instanceof Error ? error.message : String(error);
  throw new Error(
    `Cannot reach Planka at ${baseUrl}. Start it with 'npm run up' before running integration tests. Cause: ${cause}`,
  );
}

// 401 is the expected response for an unauthenticated /api/users — it proves a
// Planka API is answering on this URL.
if (response.status !== 401) {
  throw new Error(
    `Planka at ${baseUrl} returned ${response.status} for unauthenticated /api/users (expected 401). Is a Planka instance actually running there?`,
  );
}
