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
  for (const path of ["/home", "/home/join", "/room/AAAAAAAAAAAAAAAAAAAAAA", "/ice-servers"]) {
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

describe("private rooms", () => {
  const Room = () => app.mongoose.model("Rooms");

  it("creates a room with a secret 22-character token and opens it by its invite link", async () => {
    const token = await createRoom(app.baseUrl, cookie, "study-group");
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    const res = await get(`/room/${token}`, cookie);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`data-room-id="${token}"`));
    assert.match(html, new RegExp(`value="${app.baseUrl}/room/${token}"`), "the page shows the full invite link");
  });

  it("gives every room a different token, even with the same name (names are only labels)", async () => {
    const a = await createRoom(app.baseUrl, cookie, "math");
    const b = await createRoom(app.baseUrl, cookie, "math");
    assert.notEqual(a, b);
  });

  it("refuses an empty or too long name, and form arrays", async () => {
    for (const fields of [{ room: "   " }, { room: "x".repeat(51) }, { "room[]": "a" }]) {
      assert.equal((await postForm(app.baseUrl, "/home", fields, cookie)).status, 400, JSON.stringify(fields));
    }
  });

  it("joins with the invite link or just its code", async () => {
    const token = await createRoom(app.baseUrl, cookie, "invite-me");
    for (const invite of [`${app.baseUrl}/room/${token}`, `${app.baseUrl}/room/${token}/`, `https://example.org/room/${token}?x=1`, token, `  ${token}  `]) {
      const res = await postForm(app.baseUrl, "/home/join", { invite }, cookie);
      assert.equal(res.status, 302, invite);
      assert.equal(res.headers.get("location"), `/room/${token}`);
    }
  });

  it("can't be joined by its name any more, or with a made-up link", async () => {
    await createRoom(app.baseUrl, cookie, "secret-plans");
    for (const invite of ["secret-plans", "AAAAAAAAAAAAAAAAAAAAAA", `${app.baseUrl}/room/not-a-token`]) {
      const res = await postForm(app.baseUrl, "/home/join", { invite }, cookie);
      assert.equal(res.status, 404, invite);
      assert.match(await res.text(), /not valid or the room has expired/);
    }
  });

  it("answers 404 for malformed or unknown tokens", async () => {
    for (const path of ["/room/not-a-token", "/room/AAAAAAAAAAAAAAAAAAAAAA"]) {
      const res = await get(path, cookie);
      assert.equal(res.status, 404, path);
      assert.match(await res.text(), /not valid or the room has expired/);
    }
  });

  it("stops working once the room has expired", async () => {
    const token = await createRoom(app.baseUrl, cookie, "old-room");
    await Room().updateOne({ token }, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await get(`/room/${token}`, cookie)).status, 404);
    assert.equal((await postForm(app.baseUrl, "/home/join", { invite: token }, cookie)).status, 404);
  });

  it("pushes the expiry back each time the room is opened", async () => {
    const token = await createRoom(app.baseUrl, cookie, "busy-room");
    const soon = new Date(Date.now() + 60 * 1000);
    await Room().updateOne({ token }, { expiresAt: soon });
    await get(`/room/${token}`, cookie);
    const room = await Room().findOne({ token });
    assert.ok(room.expiresAt - Date.now() > 23 * 60 * 60 * 1000, "about a day from now");
  });

  it("lets MongoDB delete expired rooms (TTL index), with unique tokens and no unique names", async () => {
    const indexes = await Room().collection.indexes();
    const byKey = (key) => indexes.find((i) => Object.keys(i.key).join() === key);
    assert.equal(byKey("expiresAt")?.expireAfterSeconds, 0);
    assert.equal(byKey("token")?.unique, true);
    assert.ok(!byKey("name")?.unique, "room names are not unique any more");
  });

  it("lists the user's own active rooms on the home page, not other people's or expired ones", async () => {
    await createUser("lister", "lister-password");
    const lister = await login(app.baseUrl, { name: "lister", password: "lister-password" });
    const mine = await createRoom(app.baseUrl, lister, "my-visible-room");
    const gone = await createRoom(app.baseUrl, lister, "my-expired-room");
    await Room().updateOne({ token: gone }, { expiresAt: new Date(Date.now() - 1000) });
    await createRoom(app.baseUrl, cookie, "someone-elses-room");
    const html = await (await get("/home", lister)).text();
    assert.match(html, new RegExp(`href="/room/${mine}">my-visible-room<`));
    assert.doesNotMatch(html, /my-expired-room/);
    assert.doesNotMatch(html, /someone-elses-room/);
  });

  it("limits each user to 20 active rooms", async () => {
    await createUser("hoarder", "hoarder-password");
    const hoarder = await login(app.baseUrl, { name: "hoarder", password: "hoarder-password" });
    for (let i = 0; i < 20; i++) await createRoom(app.baseUrl, hoarder, `room-${i}`);
    const res = await postForm(app.baseUrl, "/home", { room: "one-too-many" }, hoarder);
    assert.equal(res.status, 429);
    assert.match(await res.text(), /already have 20 active rooms/);
  });

  it("escapes room names in the page (no HTML injection)", async () => {
    const token = await createRoom(app.baseUrl, cookie, "<img src=x onerror=alert(1)>");
    const html = await (await get(`/room/${token}`, cookie)).text();
    assert.ok(!html.includes("<img src=x"), "raw HTML must not reach the page");
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it("gives logged-in users the ICE servers from the configuration", async () => {
    const res = await get("/ice-servers", cookie);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), []); // ICE_SERVERS=[] in the tests
  });
});

describe("invite links for people who aren't logged in", () => {
  it("sends them to the login page and back to the room afterwards", async () => {
    const token = await createRoom(app.baseUrl, cookie, "come-back-here");
    const visit = await get(`/room/${token}`);
    assert.equal(visit.headers.get("location"), "/login");
    const visitor = sessionCookie(visit); // the session remembers where they were going
    await createUser("guest", "guest-password");
    const res = await postForm(app.baseUrl, "/login", { username: "guest", password: "guest-password" }, visitor);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `/room/${token}`);
  });

  it("brings people who sign up back to the room too", async () => {
    const token = await createRoom(app.baseUrl, cookie, "new-people-welcome");
    const visitor = sessionCookie(await get(`/room/${token}`));
    const res = await postForm(app.baseUrl, "/signup", { username: "newcomer", email: "newcomer@example.test", password: "long-enough-1" }, visitor);
    assert.equal(res.headers.get("location"), `/room/${token}`);
  });

  it("only ever returns to a page of this site", () => {
    const { afterLogin } = require("../controllers/index");
    assert.equal(afterLogin("/room/abc"), "/room/abc");
    for (const unsafe of ["//evil.example/room", "https://evil.example", "javascript:alert(1)", undefined, 42]) {
      assert.equal(afterLogin(unsafe), "/home", String(unsafe));
    }
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
