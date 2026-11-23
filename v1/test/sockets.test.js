// Signaling server (sockets.js): rooms, relaying, chat, hang-up and reconnection.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startTestServer, createUser, login, createRoom, nextEvent, recordEvents, wait } = require("./helpers");

const GRACE_MS = 300;
let app;
let ana, ben, cai; // cookies of three logged-in users

before(async () => {
  app = await startTestServer({ reconnectGraceMs: GRACE_MS });
  ana = await login(app.baseUrl, await createUser("ana"));
  ben = await login(app.baseUrl, await createUser("ben"));
  cai = await login(app.baseUrl, await createUser("cai"));
});
after(() => app.stop());

let roomCount = 0;
const newRoom = () => createRoom(app.baseUrl, ana, `room-${++roomCount}`);

/** Puts two users in a new room: the first gets "created", the second "joined". */
async function pairInRoom() {
  const roomId = await newRoom();
  const first = app.socket(ana);
  first.emit("create or join", roomId);
  await nextEvent(first, "created");
  const second = app.socket(ben);
  const ready = nextEvent(first, "ready");
  second.emit("create or join", roomId);
  await nextEvent(second, "joined");
  await ready;
  return { roomId, first, second };
}

describe("access", () => {
  it("rejects connections without a login session", async () => {
    const socket = app.socket(null);
    const err = await nextEvent(socket, "connect_error");
    assert.ok(err);
  });

  it("only lets people join rooms that exist", async () => {
    const socket = app.socket(ana);
    socket.emit("create or join", "000000000000000000000000");
    await nextEvent(socket, "invalid room");
    socket.emit("create or join", "not-an-id");
    await nextEvent(socket, "invalid room");
  });
});

describe("rooms", () => {
  it("pairs two people: the first waits, the second joins, the first makes the offer", async () => {
    await pairInRoom(); // asserts created / joined / ready
  });

  it("refuses a third person", async () => {
    const { roomId } = await pairInRoom();
    const third = app.socket(cai);
    third.emit("create or join", roomId);
    assert.equal(await nextEvent(third, "full"), roomId);
  });
});

describe("relaying", () => {
  it("passes signaling messages to the other person only", async () => {
    const { first, second } = await pairInRoom();
    const firstEvents = recordEvents(first);
    const secondEvents = recordEvents(second);
    second.emit("message", { type: "answer", sdp: "x", callId: "c1" });
    assert.deepEqual(await nextEvent(first, "message"), { type: "answer", sdp: "x", callId: "c1" });
    await wait(100);
    assert.deepEqual(secondEvents, [], "the sender must not get its own message");
    assert.deepEqual(firstEvents, ["message"]);
  });

  it("never relays messages from a socket that isn't in a room", async () => {
    const { first } = await pairInRoom();
    const outsider = app.socket(cai);
    const firstEvents = recordEvents(first);
    await nextEvent(outsider, "connect");
    outsider.emit("message", { type: "offer", sdp: "evil" });
    outsider.emit("chat message", "hi");
    await wait(200);
    assert.deepEqual(firstEvents, []);
  });

  it("keeps the chat inside the room, trims it and caps its length", async () => {
    const one = await pairInRoom();
    const other = await pairInRoom();
    const otherEvents = recordEvents(other.first);
    one.second.emit("chat message", `  ${"a".repeat(600)}  `);
    const msg = await nextEvent(one.first, "chat message");
    assert.equal(msg.user, "ben");
    assert.equal(msg.text, "a".repeat(500));
    one.second.emit("chat message", { not: "a string" });
    one.second.emit("chat message", "   ");
    await wait(200);
    assert.deepEqual(otherEvents, [], "another room must not receive the message");
  });
});

describe("hanging up", () => {
  it("tells the partner right away when someone hangs up", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.emit("bye");
    await nextEvent(first, "bye", 150); // well before the grace period ends
    // The seat is free again: someone else can join and the waiting person makes the offer.
    const third = app.socket(cai);
    const ready = nextEvent(first, "ready");
    third.emit("create or join", roomId);
    await nextEvent(third, "joined");
    await ready;
  });
});

describe("dropped connections", () => {
  it("holds the seat: the partner hears about the drop but not a hang-up", async () => {
    const { first, second } = await pairInRoom();
    const firstEvents = recordEvents(first);
    second.disconnect();
    await nextEvent(first, "peer disconnected");
    await wait(GRACE_MS / 2);
    assert.ok(!firstEvents.includes("bye"));
  });

  it("gives the seat back when the same user returns in time, and the call carries on", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.disconnect();
    await nextEvent(first, "peer disconnected");
    const back = app.socket(ben);
    const peerRejoined = nextEvent(first, "peer rejoined");
    back.emit("create or join", roomId);
    assert.deepEqual(await nextEvent(back, "rejoined"), { peerPresent: true });
    await peerRejoined;
    // Signaling works again for the returning socket.
    back.emit("message", { type: "candidate", callId: "c1" });
    assert.equal((await nextEvent(first, "message")).type, "candidate");
  });

  it("doesn't let a third person take a held seat", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.disconnect();
    await nextEvent(first, "peer disconnected");
    const third = app.socket(cai);
    third.emit("create or join", roomId);
    assert.equal(await nextEvent(third, "full"), roomId);
  });

  it("tells the partner they left once the grace period is over, and frees the seat", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.disconnect();
    await nextEvent(first, "bye", GRACE_MS + 500);
    const third = app.socket(cai);
    third.emit("create or join", roomId);
    await nextEvent(third, "joined");
  });

  it("returning late starts a fresh call instead of rejoining", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.disconnect();
    await nextEvent(first, "bye", GRACE_MS + 500);
    const late = app.socket(ben);
    const ready = nextEvent(first, "ready");
    late.emit("create or join", roomId);
    await nextEvent(late, "joined");
    await ready;
  });

  it("reports an empty room to someone who returns after their partner left", async () => {
    const { roomId, first, second } = await pairInRoom();
    second.disconnect();
    await nextEvent(first, "peer disconnected");
    first.emit("bye"); // the partner leaves while the seat is held
    const back = app.socket(ben);
    back.emit("create or join", roomId);
    assert.deepEqual(await nextEvent(back, "rejoined"), { peerPresent: false });
  });
});
