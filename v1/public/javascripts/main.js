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
// ICE candidates that arrive before the offer/answer can't be added yet.
let pendingCandidates = [];

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

//   chat button toggler
chatBtn.addEventListener('click', () => {
  popup.classList.toggle('show');
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
  // Open the chat when the other person writes.
  popup.classList.add('show');
});

// * ---------------- Call status ----------------

function setStatus(text) {
  statusText.textContent = text;
}

// Hang up: tell the other peer, turn off the camera and go back home.
endCall.onclick = (e) => {
  e.preventDefault();
  socket.emit('bye');
  closePeerConnection();
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  window.location.href = '/home';
};

// * ---------------- Signaling ----------------

socket.on('created', () => {
  setStatus('Waiting for your partner to join…');
});

socket.on('joined', () => {
  setStatus('Connecting…');
});

// The other person just joined: this side creates the offer.
socket.on('ready', () => {
  setStatus('Connecting…');
  startCall();
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
  setStatus('Your partner left. Waiting for someone to join…');
});

socket.on('message', async (message) => {
  try {
    if (message.type === 'offer') {
      if (!pc) createPeerConnection();
      await pc.setRemoteDescription(message);
      await addPendingCandidates();
      await pc.setLocalDescription(await pc.createAnswer());
      sendMessage(pc.localDescription);
    } else if (message.type === 'answer' && pc) {
      await pc.setRemoteDescription(message);
      await addPendingCandidates();
    } else if (message.type === 'candidate') {
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(message.candidate);
      } else {
        pendingCandidates.push(message.candidate);
      }
    }
  } catch (err) {
    console.error('Signaling error:', err);
    setStatus('The call could not be connected. Try reloading the page.');
  }
});

function sendMessage(message) {
  socket.emit('message', message);
}

// * ---------------- WebRTC ----------------

async function startCall() {
  createPeerConnection();
  await pc.setLocalDescription(await pc.createOffer());
  sendMessage(pc.localDescription);
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers });
  pendingCandidates = [];
  // addTrack/ontrack replace addStream/onaddstream, which browsers removed.
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) sendMessage({ type: 'candidate', candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') setStatus('');
    if (pc.connectionState === 'failed') {
      setStatus('The connection failed. A TURN server may be needed (see README).');
    }
  };
}

async function addPendingCandidates() {
  for (const candidate of pendingCandidates) {
    await pc.addIceCandidate(candidate);
  }
  pendingCandidates = [];
}

function closePeerConnection() {
  if (pc) {
    pc.close();
    pc = null;
  }
  pendingCandidates = [];
  remoteVideo.srcObject = null;
}

// * ---------------- Start ----------------

// Get the camera and the ICE servers first, then join the room. Joining only
// when the camera is ready means the offer always includes our video.
async function start() {
  try {
    const response = await fetch('/ice-servers');
    iceServers = response.ok ? await response.json() : [];
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    socket.emit('create or join', room);
  } catch (err) {
    console.error(err);
    setStatus('Could not access the camera or microphone (' + err.name + ').');
  }
}

start();
