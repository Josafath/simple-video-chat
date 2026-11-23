'use strict';

const input = document.getElementById("input");
const chatForm = document.querySelector('.input-area');
const popup = document.querySelector('.chat-popup');
const chatArea = document.querySelector('.chat-area');
const chatBtn = document.querySelector('.chat-btn');
const endCall = document.getElementById("hangup");
const emojiBtn = document.querySelector('#emoji-btn');
const statusText = document.getElementById('call-status');
const localVideo = document.querySelector('#local-video');
const remoteVideo = document.querySelector('#remote-video');
const socket = io();

// The server writes the room id in the page, so there is no need to parse the URL.
const room = document.body.dataset.roomId;

let localStream;
let pc;
let iceServers;
// Resolves once the STUN/TURN servers are loaded (start() replaces it). Creating a
// peer connection waits for it; joining the room doesn't.
let iceServersReady = Promise.resolve();
// ICE candidates that arrive before the offer/answer can't be added yet.
let pendingCandidates = [];
// True once this page has joined the room, so a reconnection knows to join again.
let inRoom = false;
// The side that was waiting in the room makes the offers, including ICE restarts.
// Only one side offering avoids both peers offering at once.
let isOfferer = false;
// How long a "disconnected" WebRTC connection may try to heal by itself before an ICE restart.
const ICE_RECOVERY_DELAY_MS = 3000;
let recoveryTimer = null;
// True while the server has us in the room on the current socket (false between a
// dropped connection and the server confirming our seat again).
let seated = false;
// Id of the current call. Messages from an older call (a replaced connection) are ignored.
let callId = null;

// * ---------------- Chat ----------------

// The emoji picker comes from a CDN; the chat still works if it fails to load.
if (window.EmojiButton) {
  const picker = new EmojiButton();
  picker.on('emoji', emoji => {
    input.value += emoji;
    input.focus();
  });
  emojiBtn.addEventListener('click', () => {
    picker.togglePicker(emojiBtn);
  });
} else {
  emojiBtn.hidden = true;
}

// The chat panel opens and closes from the Chat button; aria-expanded tells screen
// readers (and the button's style) whether it is open.
function setChatOpen(open) {
  popup.classList.toggle('show', open);
  chatBtn.setAttribute('aria-expanded', String(open));
  if (open) input.focus();
}

chatBtn.addEventListener('click', () => {
  setChatOpen(!popup.classList.contains('show'));
});

// The input is inside a form now, so Enter also sends the message.
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (input.value.trim()) {
    socket.emit('chat message', input.value);
    input.value = '';
  }
});

socket.on('chat message', (msg) => {
  const row = document.createElement('div');
  row.className = msg.from === socket.id ? 'out-msg' : 'income-msg';
  const bubble = document.createElement('p');
  bubble.className = 'msg';
  // textContent never runs HTML. The old code inserted the text as HTML, so
  // a message like <img src=x onerror=...> ran code on the other computer.
  bubble.textContent = msg.text;
  const author = document.createElement('span');
  author.className = 'author';
  author.textContent = msg.user;
  row.append(author, bubble);
  chatArea.append(row);
  chatArea.scrollTop = chatArea.scrollHeight;
  // Open the chat when the other person writes (without moving the focus there).
  popup.classList.add('show');
  chatBtn.setAttribute('aria-expanded', 'true');
});

// * ---------------- Invite link ----------------

// The room is private: the only way in is this link, so make it easy to share.
const inviteInput = document.getElementById('invite-link');
const copyInvite = document.getElementById('copy-invite');
copyInvite.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteInput.value);
    copyInvite.textContent = 'Copied!';
  } catch {
    // No clipboard access (old browser, or not HTTPS): select it so Ctrl+C works.
    inviteInput.select();
    copyInvite.textContent = 'Press Ctrl+C to copy';
  }
  setTimeout(() => { copyInvite.textContent = 'Copy invite link'; }, 2000);
});

// * ---------------- Call status ----------------

function setStatus(text) {
  statusText.textContent = text;
}

// Hang up: tell the other peer, turn off the camera and go back home.
endCall.onclick = (e) => {
  e.preventDefault();
  leaveRoom();
  closePeerConnection();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  window.location.href = '/home';
};

// Leaving on purpose (hang up, closing or reloading the tab) is an immediate "bye".
// Without it the server would hold the seat as if the connection had just dropped.
function leaveRoom() {
  if (!inRoom) return;
  inRoom = false;
  socket.emit('bye');
}
window.addEventListener('pagehide', leaveRoom);

// * ---------------- Signaling ----------------

// Socket.IO reconnects by itself after a dropped connection, but with a new socket
// that isn't in any room. Join again: the server kept our seat for a few seconds.
socket.on('connect', () => {
  if (inRoom) socket.emit('create or join', room);
});

socket.on('disconnect', () => {
  seated = false;
  if (inRoom) setStatus('Connection lost. Reconnecting…');
});

socket.on('created', () => {
  // A fresh room (or our partner left while we were away): start over.
  seated = true;
  closePeerConnection();
  isOfferer = false;
  setStatus('Waiting for your partner to join…');
});

socket.on('joined', () => {
  seated = true;
  closePeerConnection();
  isOfferer = false;
  setStatus('Connecting…');
});

// The other person just joined: this side creates the offer.
socket.on('ready', () => {
  seated = true;
  closePeerConnection();
  isOfferer = true;
  setStatus('Connecting…');
  startCall();
});

// We got our seat back after a dropped connection.
socket.on('rejoined', ({ peerPresent }) => {
  seated = true;
  if (!peerPresent) {
    // Our partner left while we were away.
    closePeerConnection();
    setStatus('Your partner left. Waiting for someone to join…');
    return;
  }
  // The video goes browser to browser, so it often survives a signaling drop.
  if (pc && pc.connectionState === 'connected') setStatus('');
  else recoverConnection();
});

// Our partner's connection to the server dropped. Their seat is held for a few seconds.
socket.on('peer disconnected', () => {
  if (!pc || pc.connectionState !== 'connected') {
    setStatus("Your partner's connection dropped. Waiting for them to come back…");
  }
});

socket.on('peer rejoined', () => {
  if (pc && pc.connectionState === 'connected') setStatus('');
  else recoverConnection();
});

socket.on('full', () => {
  alert('This room already has two people in it.');
  window.location.href = '/home';
});

socket.on('invalid room', () => {
  alert('This room does not exist.');
  window.location.href = '/home';
});

socket.on('bye', () => {
  closePeerConnection();
  // Whoever is left waits; the next person to join triggers "ready" here again.
  isOfferer = false;
  setStatus('Your partner left. Waiting for someone to join…');
});

socket.on('message', async (message) => {
  try {
    // Every message waits here, so they keep their order: the offer creates the
    // connection before the candidates that follow it are handled.
    await iceServersReady;
    if (message.type === 'offer') {
      // An offer for a call we already replaced comes from the partner's old
      // connection (for example an ICE restart sent just before a reconnection).
      if (pc && message.callId !== callId) return;
      if (!pc) createPeerConnection(message.callId);
      const conn = pc;
      await conn.setRemoteDescription({ type: message.type, sdp: message.sdp });
      await addPendingCandidates(conn);
      const answer = await conn.createAnswer();
      if (conn !== pc) return;
      await conn.setLocalDescription(answer);
      if (conn !== pc) return;
      sendDescription(conn.localDescription);
    } else if (message.callId !== callId || !pc) {
      // Answers, candidates and restart requests only make sense for the current call.
      return;
    } else if (message.type === 'answer') {
      const conn = pc;
      await conn.setRemoteDescription({ type: message.type, sdp: message.sdp });
      await addPendingCandidates(conn);
    } else if (message.type === 'candidate') {
      if (pc.remoteDescription) await pc.addIceCandidate(message.candidate);
      else pendingCandidates.push(message.candidate);
    } else if (message.type === 'restart') {
      // The answering side asks the offerer to restart ICE.
      if (isOfferer) await restartIce();
    }
  } catch (err) {
    console.error('Signaling error:', err);
    setStatus('The call could not be connected. Try reloading the page.');
  }
});

// Every signaling message carries the id of the call it belongs to.
function sendMessage(message) {
  socket.emit('message', { ...message, callId });
}

function sendDescription(description) {
  sendMessage({ type: description.type, sdp: description.sdp });
}

function newCallId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
}

// * ---------------- WebRTC ----------------

async function startCall() {
  await iceServersReady;
  // While waiting, the partner may have left (bye) or another call may have started.
  if (!isOfferer || pc) return;
  createPeerConnection(newCallId());
  const conn = pc;
  const offer = await conn.createOffer();
  if (conn !== pc) return; // replaced while waiting
  await conn.setLocalDescription(offer);
  if (conn !== pc) return;
  sendDescription(conn.localDescription);
}

// Each connection only acts while it is the current one: events from a replaced
// (closed) connection must not touch the new call.
function createPeerConnection(id) {
  const conn = new RTCPeerConnection({ iceServers });
  pc = conn;
  callId = id;
  pendingCandidates = [];
  // addTrack/ontrack replace addStream/onaddstream, which browsers removed.
  localStream.getTracks().forEach(track => conn.addTrack(track, localStream));

  conn.onicecandidate = (event) => {
    if (conn === pc && event.candidate) sendMessage({ type: 'candidate', candidate: event.candidate.toJSON() });
  };
  conn.ontrack = (event) => {
    if (conn === pc) remoteVideo.srcObject = event.streams[0];
  };
  conn.onconnectionstatechange = () => {
    if (conn !== pc) return;
    const state = conn.connectionState;
    if (state === 'connected') {
      clearTimeout(recoveryTimer);
      setStatus('');
    } else if (state === 'disconnected') {
      // Often heals by itself (a short network change). If not, restart ICE.
      setStatus('Connection unstable. Reconnecting…');
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(recoverConnection, ICE_RECOVERY_DELAY_MS);
    } else if (state === 'failed') {
      setStatus('Reconnecting the call…');
      recoverConnection();
    }
  };
}

// Brings a broken call back without hanging up: the offerer restarts ICE, which
// finds a new network path (for example after switching from Wi-Fi to mobile data).
// It needs our seat in the room; after a reconnection, "rejoined" runs it again.
async function recoverConnection() {
  clearTimeout(recoveryTimer);
  if (!pc || pc.connectionState === 'connected' || !seated) return;
  try {
    if (isOfferer) await restartIce();
    else sendMessage({ type: 'restart' });
  } catch (err) {
    console.error('Could not restart the connection:', err);
    setStatus('The connection failed. A TURN server may be needed (see README).');
  }
}

async function restartIce() {
  const conn = pc;
  // Wait for any offer/answer in flight to finish first.
  if (!conn || conn.signalingState !== 'stable') return;
  const offer = await conn.createOffer({ iceRestart: true });
  if (conn !== pc) return;
  await conn.setLocalDescription(offer);
  if (conn !== pc) return;
  sendDescription(conn.localDescription);
}

async function addPendingCandidates(conn) {
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of queued) {
    if (conn !== pc) return;
    await conn.addIceCandidate(candidate);
  }
}

function closePeerConnection() {
  clearTimeout(recoveryTimer);
  if (pc) {
    pc.close();
    pc = null;
  }
  callId = null;
  pendingCandidates = [];
  remoteVideo.srcObject = null;
}

// * ---------------- Start ----------------

// Used when the ICE servers can't be fetched: works on most home networks.
const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
// The server already gives Xirsys 2.5 s; this only guards against a server that hangs.
// It's generous because joining the room doesn't wait for it, only starting the call
// does, and giving up means losing TURN (calls from strict networks may then fail).
const ICE_SERVERS_TIMEOUT_MS = 10000;

async function loadIceServers() {
  try {
    const signal = AbortSignal.timeout ? AbortSignal.timeout(ICE_SERVERS_TIMEOUT_MS) : undefined;
    const response = await fetch('/ice-servers', { signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch (err) {
    console.warn('Using public STUN only, the ICE servers could not be loaded:', err.message);
    return FALLBACK_ICE_SERVERS;
  }
}

function cameraErrorMessage(err) {
  switch (err.name) {
    case 'NotAllowedError':
      return 'Camera and microphone access is blocked. Allow it from the icon in the address bar, then reload the page.';
    case 'NotFoundError':
      return 'No camera or microphone was found. Connect one and reload the page.';
    case 'NotReadableError':
      return 'Your camera or microphone is being used by another app. Close it and reload the page.';
    default:
      return 'Could not access the camera or microphone (' + err.name + ').';
  }
}

// Join as soon as the camera is ready. The ICE servers load at the same time and are
// only needed when the call starts (startCall and incoming offers wait for them), which
// is usually much later: the first person is still waiting for a partner. Joining only
// when the camera is ready means the offer always includes our video.
async function start() {
  setStatus('Starting your camera…');
  iceServersReady = loadIceServers().then((servers) => { iceServers = servers; });
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.error(err);
    setStatus(cameraErrorMessage(err));
    return;
  }
  localVideo.srcObject = localStream;
  setStatus('Joining the room…');
  inRoom = true;
  socket.emit('create or join', room);
}

start();
