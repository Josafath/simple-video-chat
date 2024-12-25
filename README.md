# video-chat

## How this project works ? 

<p align="center">
  <img width="460" height="300" src="https://user-images.githubusercontent.com/29525443/130464057-8c7ec676-fae3-4532-b477-2420e25c977d.png">
</p>
A lightweight, real-time video chat application built using WebRTC and Socket.IO. This project demonstrates the core functionality needed for peer-to-peer video and audio communication, making it a great starting point for more advanced implementations.

### Features
- Peer-to-peer video and audio communication using WebRTC.
- Real-time signaling powered by Socket.IO.
- Clean and minimal user interface for easy interaction.

## Demo
https://heavenly-mangrove-birthday.glitch.me/


## Prerequisites
    - Node.js (version 16 or higher recommended)
    - NPM (comes with Node.js)

## Installation and Setup ⚙️

Follow these steps to get the project running on your local machine:

1. Clone the repository:
```markdown
git clone https://github.com/Josafath/simple-video-chat.git
cd simple-video-chat
```

2. Install dependencies:
```markdown
npm install 
```

3. Start the server:
```markdown
npm start 
```

4. Open your browser and navigate to:
```markdown
http://localhost:3000
```

### Usage
- Open the app in two browser windows (or share the link with another user).
- Allow camera and microphone access when prompted.
- Start the video chat by sharing the generated link or using the same room ID.

### Technologies Used 🛠️
- WebRTC: For real-time peer-to-peer communication.
- Socket.IO: For signaling and message exchange between clients.
- Node.js: Backend server to handle signaling.
- Express: Lightweight web server framework.

### Pd:
This was the hardest project that I made, I've never been in a situation where I could feel many confusion and frustration for not knowing but then everything pays off.
If someone wants to collaborate of you have some thoughts of how I can improve this, send me an email. :)
If you wanna use this projects you will have to have this little things in mind.


## Extra Setup
_In file main.js of the public dir you could see in line 37 the servers line, to use this software you have to follow this steps:_
- Go to https://xirsys.com/
- Sign up/Log in
- Create an app and then you would see in your right side of the browser *Static TURN credentials.*
- Once you click this button you could see and object with the iceServers
- Copy the object and paste in line 37.
- Note: If you have another way to write something that works, send me your code. haha
