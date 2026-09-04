// Unit-test environment.
//
// Sets dummy Planka config so modules that read these vars at import time have
// something to read. There is NO connectivity precheck and NO process.exit:
// unit tests stub the global `fetch` and never touch a real server, so they
// must run anywhere (CI included) without Planka.
process.env.PLANKA_BASE_URL = "http://localhost:3333";
process.env.PLANKA_AGENT_EMAIL = "demo@demo.demo";
process.env.PLANKA_AGENT_PASSWORD = "demo";
process.env.PLANKA_ADMIN_EMAIL = "demo@demo.demo";
process.env.PLANKA_ADMIN_USERNAME = "demo";
