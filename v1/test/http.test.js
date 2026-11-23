// Pages and forms (app.js, routes, controllers): sign-up, login, sessions, rooms,
// logout and security headers.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, createUser, postForm, sessionCookie, login, createRoom } = require("./helpers");

let app;
let cookie; // a logged-in user for the pages that need one

before(async () => {
  app = await startTestServer();
  cookie = await login(app.baseUrl, await createUser("owner"));
});
after(() => app.stop());

const get = (path, withCookie) =>
  fetch(app.baseUrl + path, { redirect: "manual", headers: withCookie ? { cookie: withCookie } : {} });

describe("pages that need a login", () => {
  for (const path of ["/home", "/home/join", "/home/room/000000000000000000000000", "/ice-servers"]) {
    it(`${path} sends anonymous visitors to the login page`, async () => {
      const res = await get(path);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/login");
    });
  }

  it("shows the home page to a logged-in user", async () => {
    const res = await get("/home", cookie);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Hi <i>owner<\/i>/);
  });
});

describe("sign-up", () => {
  const signup = (fields) => postForm(app.baseUrl, "/signup", fields);

  it("creates the account, logs the user in and goes home", async () => {
    const res = await signup({ username: "newbie", email: "newbie@example.test", password: "long-enough-1" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/home");
    assert.equal((await get("/home", sessionCookie(res))).status, 200);
  });

  it("rejects invalid input with a clear message", async () => {
    const cases = [
      [{ username: "ab", email: "a@example.test", password: "long-enough-1" }, /3 to 30 letters/],
      [{ username: "has space", email: "a@example.test", password: "long-enough-1" }, /3 to 30 letters/],
      [{ username: "valid_name", email: "not-an-email", password: "long-enough-1" }, /valid email/],
      [{ username: "valid_name", email: "a@example.test", password: "short" }, /between 8 and 72/],
    ];
    for (const [fields, message] of cases) {
      const res = await signup(fields);
      assert.equal(res.status, 400, JSON.stringify(fields));
      assert.match(await res.text(), message);
    }
  });

  it("refuses a taken username or email (emails are case-insensitive)", async () => {
    await createUser("taken");
    for (const fields of [
      { username: "taken", email: "other@example.test", password: "long-enough-1" },
      { username: "someone", email: "TAKEN@example.test", password: "long-enough-1" },
    ]) {
      const res = await signup(fields);
      assert.equal(res.status, 409);
      assert.match(await res.text(), /already registered/);
    }
  });
});

describe("login and sessions", () => {
  it("answers 401 with the same message for a wrong password or an unknown user", async () => {
    await createUser("dana", "dana-password");
    for (const fields of [{ username: "dana", password: "wrong-password" }, { username: "nobody", password: "whatever-1" }]) {
      const res = await postForm(app.baseUrl, "/login", fields);
      assert.equal(res.status, 401);
      assert.match(await res.text(), /Incorrect username or password/);
    }
  });

  it("logs in with the right password", async () => {
    await createUser("eli", "eli-password");
    const res = await postForm(app.baseUrl, "/login", { username: "eli", password: "eli-password" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/home");
  });

  it("stores sessions in MongoDB with the user's id and name, never the password hash", async () => {
    await createUser("fay", "fay-password");
    await login(app.baseUrl, { name: "fay", password: "fay-password" });
    const sessions = await app.mongoose.connection.db.collection("sessions").find({}).toArray();
    const fay = sessions.map((s) => JSON.parse(s.session)).find((s) => s.passport?.user?.name === "fay");
    assert.ok(fay, "the session is in the sessions collection");
    assert.deepEqual(Object.keys(fay.passport.user).sort(), ["id", "name"]);
    assert.doesNotMatch(JSON.stringify(sessions), /\$2[aby]\$/, "no bcrypt hash in any session");
  });

  it("logs out with POST only", async () => {
    await createUser("gus", "gus-password");
    const gus = await login(app.baseUrl, { name: "gus", password: "gus-password" });
    assert.equal((await get("/log-out", gus)).status, 404, "GET must not log out");
    assert.equal((await get("/home", gus)).status, 200);
    const res = await postForm(app.baseUrl, "/log-out", {}, gus);
    assert.equal(res.status, 302);
    assert.equal((await get("/home", gus)).status, 302, "logged out");
  });
});

describe("rooms", () => {
  it("creates a room and opens it", async () => {
    const id = await createRoom(app.baseUrl, cookie, "study-group");
    const res = await get(`/home/room/${id}`, cookie);
    assert.equal(res.status, 200);
    assert.match(await res.text(), new RegExp(`data-room-id="${id}"`));
  });

  it("refuses a taken, empty or too long name, and form arrays", async () => {
    await createRoom(app.baseUrl, cookie, "popular");
    const cases = [[{ room: "popular" }, 409], [{ room: "   " }, 400], [{ room: "x".repeat(51) }, 400], [{ "room[]": "a" }, 400]];
    for (const [fields, status] of cases) {
      assert.equal((await postForm(app.baseUrl, "/home", fields, cookie)).status, status, JSON.stringify(fields));
    }
  });

  it("joins a room by its name, and says so when it doesn't exist", async () => {
    const id = await createRoom(app.baseUrl, cookie, "by-name");
    const found = await postForm(app.baseUrl, "/home/join", { room: "by-name" }, cookie);
    assert.equal(found.status, 302);
    assert.equal(found.headers.get("location"), `/home/room/${id}`);
    const missing = await postForm(app.baseUrl, "/home/join", { room: "no-such-room" }, cookie);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /no room with that name/);
  });

  it("answers 404 for malformed or unknown room ids", async () => {
    assert.equal((await get("/home/room/not-an-id", cookie)).status, 404);
    assert.equal((await get("/home/room/000000000000000000000000", cookie)).status, 404);
  });

  it("escapes room names in the page (no HTML injection)", async () => {
    const id = await createRoom(app.baseUrl, cookie, "<img src=x onerror=alert(1)>");
    const html = await (await get(`/home/room/${id}`, cookie)).text();
    assert.ok(!html.includes("<img src=x"), "raw HTML must not reach the page");
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it("gives logged-in users the ICE servers from the configuration", async () => {
    const res = await get("/ice-servers", cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []); // ICE_SERVERS=[] in the tests
  });
});

describe("security headers", () => {
  it("sends a Content Security Policy and the usual hardening headers", async () => {
    const res = await get("/login");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-powered-by"), null);
    // HSTS only makes sense behind HTTPS, so it is off outside production.
    assert.equal(res.headers.get("strict-transport-security"), null);
  });

  it("serves the session cookie as httpOnly and SameSite=Lax", async () => {
    await createUser("hal", "hal-password");
    const res = await postForm(app.baseUrl, "/login", { username: "hal", password: "hal-password" });
    const header = res.headers.getSetCookie().find((c) => c.startsWith("connect.sid="));
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
  });
});
