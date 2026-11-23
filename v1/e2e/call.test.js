// End-to-end: a real WebRTC call between two browser sessions (separate cookies) in
// headless Chrome, against the real app and an in-memory MongoDB. Camera and microphone
// are synthetic (a canvas and a tone), so no device or external service is needed.
// Uses the Chrome installed on the machine; set CHROME_PATH to use another binary.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { startTestServer, createUser, login, createRoom } = require("../test/helpers");

// Replaces getUserMedia with a moving canvas and an oscillator.
const syntheticMedia = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const g = canvas.getContext("2d");
    let frame = 0;
    setInterval(() => {
      g.fillStyle = `hsl(${(frame++ * 7) % 360} 80% 50%)`;
      g.fillRect(0, 0, 320, 240);
    }, 50);
    const audio = new AudioContext();
    const out = audio.createMediaStreamDestination();
    const tone = audio.createOscillator();
    tone.connect(out);
    tone.start();
    return new MediaStream([...canvas.captureStream(20).getVideoTracks(), ...out.stream.getAudioTracks()]);
  };
};

let app, browser;
let anaCookie, benCookie;

before(async () => {
  app = await startTestServer({ reconnectGraceMs: 3000 });
  anaCookie = await login(app.baseUrl, await createUser("ana"));
  benCookie = await login(app.baseUrl, await createUser("ben"));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  await browser?.close();
  await app?.stop();
});

/** A browser session logged in with `cookie`, with synthetic media and an error log. */
async function openSession(cookie) {
  const context = await browser.newContext();
  const [name, value] = cookie.split("=");
  await context.addCookies([{ name, value, url: app.baseUrl }]);
  await context.addInitScript(syntheticMedia);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (err) => page.errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && page.errors.push(msg.text()));
  page.on("dialog", (dialog) => dialog.accept());
  return page;
}

const callState = (page) =>
  page.evaluate(() => ({
    status: document.getElementById("call-status").textContent,
    pc: typeof pc !== "undefined" && pc ? pc.connectionState : null,
    remoteWidth: document.getElementById("remote-video").videoWidth,
  }));

/** Waits until the call is up on this page: connected, remote video playing, no status message. */
const waitForCall = (page) =>
  page.waitForFunction(
    () => typeof pc !== "undefined" && pc && pc.connectionState === "connected" &&
      document.getElementById("remote-video").videoWidth > 0 &&
      document.getElementById("call-status").textContent === "",
    null,
    { timeout: 20000 },
  );

let roomCount = 0;
async function startCall() {
  const roomId = await createRoom(app.baseUrl, anaCookie, `e2e-room-${++roomCount}`);
  const ana = await openSession(anaCookie);
  const ben = await openSession(benCookie);
  await ana.goto(`${app.baseUrl}/home/room/${roomId}`);
  await ana.waitForFunction(() => /Waiting for your partner/.test(document.getElementById("call-status").textContent));
  await ben.goto(`${app.baseUrl}/home/room/${roomId}`);
  await Promise.all([waitForCall(ana), waitForCall(ben)]);
  return { ana, ben };
}

describe("a call between two people", () => {
  it("connects with video both ways", async () => {
    const { ana, ben } = await startCall();
    assert.ok((await callState(ana)).remoteWidth > 0);
    assert.ok((await callState(ben)).remoteWidth > 0);
    assert.deepEqual([...ana.errors, ...ben.errors], []);
    await ana.context().close();
    await ben.context().close();
  });

  it("delivers chat messages as text, never as HTML", async () => {
    const { ana, ben } = await startCall();
    await ben.click(".chat-btn"); // the chat is a panel that opens from this button
    await ben.fill("#input", "hola <img src=x onerror=alert(1)>");
    await ben.press("#input", "Enter");
    const received = ana.locator(".chat-area .income-msg .msg");
    await received.waitFor();
    assert.equal(await received.textContent(), "hola <img src=x onerror=alert(1)>");
    assert.equal(await ana.locator(".chat-area img").count(), 0);
    await ana.context().close();
    await ben.context().close();
  });

  it("survives a dropped signaling connection without ending the call", async () => {
    const { ana, ben } = await startCall();
    await ana.evaluate(() => { socket.io.engine.close(); }); // Socket.IO reconnects by itself
    await ana.waitForFunction(() => socket.connected && document.getElementById("call-status").textContent === "", null, { timeout: 10000 });
    await waitForCall(ana);
    await waitForCall(ben);
    assert.doesNotMatch((await callState(ben)).status, /left/);
    await ana.context().close();
    await ben.context().close();
  });

  it("tells the partner right away when someone hangs up", async () => {
    const { ana, ben } = await startCall();
    await ben.click("#hangup");
    await ben.waitForURL(`${app.baseUrl}/home`);
    await ana.waitForFunction(() => /Your partner left/.test(document.getElementById("call-status").textContent), null, { timeout: 2000 });
    assert.equal((await callState(ana)).pc, null);
    await ana.context().close();
    await ben.context().close();
  });
});
