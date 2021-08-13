'use strict';

const input = document.getElementById("input");
const sendButton = document.getElementById("sendButton");
var messages = document.getElementById("messages");
var socket = io.connect();
const endCall = document.getElementById("hangup");


sendButton.onclick = (e) => {
    e.preventDefault();
    if(input.value) {
        socket.emit('chat message', input.value);
        input.value = '';
    }
};


let isChannelReady = false;
let isInitiator = false;
let isStarted = false;
let localStream, remoteStream;
let pc;

// * Event when the user finish the call
endCall.onclick = (e) => {
  e.preventDefault();
  if(isInitiator)  {
    hangup();
  }
  window.location.href= "/login";
}


//Servers using xirsys.com
// * If you wanna create your own servers please follow the steps in the README.md file
const pc_config = {'iceServers': [{urls: [ "stun:ws-turn2.xirsys.com" ]}, {username: "A_14mbgEi-X6BDJp5SpZjoyI-EEATonG7DkRbmF2IrFbmTF4rCM_NMjbyD2V8zNSAAAAAGEUAsJqb3NzYQ==",credential: "fa67976c-fac5-11eb-a426-0242ac140004",urls: ["turn:ws-turn2.xirsys.com:80?transport=udp","turn:ws-turn2.xirsys.com:3478?transport=udp","turn:ws-turn2.xirsys.com:80?transport=tcp","turn:ws-turn2.xirsys.com:3478?transport=tcp","turns:ws-turn2.xirsys.com:443?transport=tcp","turns:ws-turn2.xirsys.com:5349?transport=tcp"]}]};

// * Extracting the id of the room from the URL and insert send to the socket
const url_string = (window.location.href).toLowerCase();
const url = new URL(url_string);
let pathname = url["pathname"].split('/');
var room = pathname.slice(-1).pop()
var sdpConstraints = {};    
socket.emit('create or join', room);

var constraints = {video: true, audio: false};

socket.on('created', function (room){
    console.log('Created room ' + room);
    isInitiator = true;
    console.log('Getting user media with constraints', constraints);
})

socket.on('chat message', function(msg) {
    let item = document.createElement('li');
    item.innerHTML = msg;
    messages.appendChild(item);
});

socket.on('full', function (room){
    console.log('Room ' + room + ' is full');
});

socket.on('join', function (room){
    console.log('Another peer made a request to join room ' + room);
    console.log('This peer is the initiator of room ' + room + '!');
    isChannelReady = true;
});

socket.on('joined', function (room){
    console.log('This peer has joined room ' + room);
    isChannelReady = true;
    // Call getUserMedia()
    
});
socket.on('log', function (array){
    console.log.apply(console, array);
});

socket.on('message', function(message, room) {
    console.log('Client received message:', message,  room);
    if (message === 'got user media') {
      checkAndStart();
    } else if (message.type === 'offer') {
      if (!isInitiator && !isStarted) {
        checkAndStart();
      }
      pc.setRemoteDescription(new RTCSessionDescription(message));
      doAnswer();
    } else if (message.type === 'answer' && isStarted) {
      pc.setRemoteDescription(new RTCSessionDescription(message));
    } else if (message.type === 'candidate' && isStarted) {
      var candidate = new RTCIceCandidate({
        sdpMLineIndex: message.label,
        candidate: message.candidate
      });
      pc.addIceCandidate(candidate);
    } else if (message === 'bye' && isStarted) {
      handleRemoteHangup();
    }
});

function sendMessage(message, room) {
    console.log('Client sending message: ', message, room);
    socket.emit('message', message, room);

}
  

var localVideo = document.querySelector('#local-video');
var remoteVideo = document.querySelector('#remote-video');
console.log("Going to find Local media");
navigator.mediaDevices.getUserMedia(constraints)
.then(gotStream)
.catch(function(e) {
  alert('getUserMedia() error: ' + e.name);
});

//If found local stream
function gotStream(stream) {
  console.log('Adding local stream.');
  localStream = stream;
  localVideo.srcObject = stream;
  sendMessage('got user media', room);
  if (isInitiator) {
    checkAndStart();
  }
}

function checkAndStart() {
    console.log('>>>>>>> maybeStart() ', isStarted, localStream, isChannelReady);
    if (!isStarted && typeof localStream != 'undefined' && isChannelReady) {
        console.log('>>>>>> creating peer connection');
        createPeerConnection();
        pc.addStream(localStream);
        isStarted = true;
        console.log('isInitiator', isInitiator);
        if (isInitiator) {
            doCall();
        }
    }
}

function createPeerConnection() {
    try {
        pc = new RTCPeerConnection(pc_config);
        pc.onicecandidate = handleIceCandidate;
        pc.onaddstream = handleRemoteStreamAdded;
        pc.onremovestream = handleRemoteStreamRemoved;
        console.log('Created RTCPeerConnnection with:\n' +
        ' config: \'' + JSON.stringify(pc_config) + '\'');
    } catch (e) {
        console.log('Failed to create PeerConnection, exception: ' + e.message);
        alert('Cannot create RTCPeerConnection object.');
        return;
    }
}
// Data channel management
// Handlers...


function handleIceCandidate(event) {
    console.log('icecandidate event: ', event);
    if (event.candidate) {
      sendMessage({
        type: 'candidate',
        label: event.candidate.sdpMLineIndex,
        id: event.candidate.sdpMid,
        candidate: event.candidate.candidate
      }, room);
    } else {
      console.log('End of candidates.');
    }
}

function handleCreateOfferError(event) {
    console.log('createOffer() error: ', event);
  }
  
function doCall() {
    console.log('Sending offer to peer');
    pc.createOffer(setLocalAndSendMessage, handleCreateOfferError);
  }
  
function doAnswer() {
    console.log('Sending answer to peer.');
    pc.createAnswer().then(
      setLocalAndSendMessage,
      onCreateSessionDescriptionError
    );
  }
  
function setLocalAndSendMessage(sessionDescription) {
    pc.setLocalDescription(sessionDescription);
    console.log('setLocalAndSendMessage sending message', sessionDescription);
    sendMessage(sessionDescription, room);
  }
  
function onCreateSessionDescriptionError(error) {
    trace('Failed to create session description: ' + error.toString());
  }
  
  
function handleRemoteStreamAdded(event) {
    console.log('Remote stream added.');
    remoteStream = event.stream;
    remoteVideo.srcObject = remoteStream;
  }
  
function handleRemoteStreamRemoved(event) {
    console.log('Remote stream removed. Event: ', event);
  }
  
function hangup() {
    console.log('Hanging up.');
    stop();
    sendMessage('bye',room);
  }
  
function handleRemoteHangup() {
    console.log('Session terminated.');
    stop();
    isInitiator = false;
}
  
function stop() {
    isStarted = false;
    if(typeof pc.close() === null){
      window.location.href("/home");
    }
    pc.close();
    pc = null;
  }