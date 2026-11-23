// Brute-force limits (routes/index.js). In a file of its own: the limits are kept per
// server process, and every test file runs in a separate process.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, createUser, postForm } = require("./helpers");

let app;
before(async () => { app = await startTestServer(); });
after(() => app.stop());

describe("rate limits", () => {
  it("blocks logins after 10 failures from the same address, even with the right password", async () => {
    await createUser("target", "the-right-password");
    for (let i = 0; i < 10; i++) {
      const res = await postForm(app.baseUrl, "/login", { username: "target", password: `guess-${i}` });
      assert.equal(res.status, 401, `attempt ${i + 1}`);
    }
    const blocked = await postForm(app.baseUrl, "/login", { username: "target", password: "the-right-password" });
    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /Too many failed attempts\. Try again in 15 minutes/);
  });

  it("allows 10 sign-ups per address per hour", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await postForm(app.baseUrl, "/signup", { username: `bulk${i}`, email: `bulk${i}@example.test`, password: "long-enough-1" });
      assert.equal(res.status, 302, `sign-up ${i + 1}`);
    }
    const blocked = await postForm(app.baseUrl, "/signup", { username: "bulk10", email: "bulk10@example.test", password: "long-enough-1" });
    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /Too many accounts/);
  });
});
