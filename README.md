# Study Partner — simple video chat

[![CI](https://github.com/Josafath/simple-video-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/Josafath/simple-video-chat/actions/workflows/ci.yml)

<p align="center">
  <img width="460" height="300" src="https://user-images.githubusercontent.com/29525443/130464057-8c7ec676-fae3-4532-b477-2420e25c977d.png">
</p>

A one-to-one video chat for studying with a partner. You sign up, create a room
(or join one by its name), and talk face to face with video, audio and a text
chat. The video goes directly between the two browsers with **WebRTC**. The
server only introduces the two browsers to each other (the *signaling*) with
**Socket.IO**.

| Version | Folder | What it is |
|---|---|---|
| **v1** | [`v1/`](v1) | The original 2021 project, with its bugs and security problems fixed. Same architecture. |

## Features

- Sign up and log in (Passport, passwords hashed with bcrypt, MongoDB).
- Create a room with a unique name, or join an existing one by name.
- Peer-to-peer video and audio with WebRTC (two people per room).
- Text chat inside the room, with emojis.
- STUN/TURN servers from [Xirsys](https://xirsys.com/), with temporary credentials made by the server.

## How it works

```mermaid
sequenceDiagram
    participant A as Browser A (first in the room)
    participant S as Server (Express + Socket.IO)
    participant B as Browser B
    par While the camera starts
        A->>S: GET /ice-servers
        S-->>A: STUN/TURN servers (temporary Xirsys credentials)
    and As soon as the camera is ready
        A->>S: create or join (room id)
        S-->>A: created (waits for a partner)
    end
    B->>S: create or join (room id)
    S-->>B: joined
    S-->>A: ready
    A->>S: offer (SDP)
    S->>B: offer
    B->>S: answer (SDP)
    S->>A: answer
    A-->>B: ICE candidates (both ways, through the server)
    Note over A,B: Video + audio, browser to browser (or through TURN)
```

1. **Login session.** Express keeps the session in a cookie. Socket.IO reuses
   that session, so only logged-in users can connect to the signaling server.
2. **Room.** The browser joins as soon as the camera is on. The STUN/TURN
   servers load at the same time and are only needed when the call starts, so a
   slow Xirsys never delays joining. The server gives Xirsys 2.5 seconds and then
   falls back to plain STUN. The server lets two sockets into a room. The first gets
   `created`, the second gets `joined`, and the first one then gets `ready`.
   A third person gets `full`.
3. **Offer and answer.** The browser that was waiting creates an *offer*. It
   describes its video, audio and codecs. The other browser answers.
4. **ICE.** Each browser finds ways to be reached (local IP, public IP from
   STUN, or a relay address from TURN). They send these *candidates* through
   the server until one pair works.
5. **Hang up.** The browser sends `bye` when you hang up, close or reload the
   tab. The other person stays in the room, and a new partner can join.
6. **Dropped connection.** If the connection to the server drops (Wi-Fi blip,
   phone in the background), the server keeps the seat for 10 seconds and tells
   the partner. Socket.IO reconnects by itself and the browser takes its seat
   back. The video goes browser to browser, so it usually keeps playing; if the
   WebRTC connection broke too, the browser that made the offer restarts ICE to
   find a new network path. Every signaling message carries the id of its call,
   so messages from a replaced connection are ignored. After 10 seconds without
   coming back, the partner gets `bye` and the seat is free again.

### Project structure (v1)

```
v1/
├── bin/www            # Starts the HTTP server after connecting to MongoDB
├── server.js          # Creates the HTTP server with Socket.IO (used by bin/www and the tests)
├── app.js             # Express app: sessions, Passport, routes, errors
├── config.js          # Reads the environment variables (.env)
├── sockets.js         # Socket.IO signaling server (rooms, offer/answer, chat)
├── controllers/       # Logic of every page (signup, rooms, ICE servers...)
├── routes/            # URLs and which ones need a logged-in user
├── models/            # Mongoose models: Users and Rooms
├── views/             # EJS templates
├── public/            # Browser code (javascripts/main.js = WebRTC + chat) and styles
├── test/              # Integration tests: signaling, pages, security, rate limits
└── e2e/               # End-to-end: a real WebRTC call between two Chrome sessions
```

## Tests

```bash
cd v1
npm test           # signaling, pages, sessions, security headers, rate limits
npm run test:e2e   # a real call between two headless Chrome sessions
```

The tests need nothing from your `.env`: they start the app on a free port with a
real MongoDB in memory ([mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server))
and never contact MongoDB Atlas or Xirsys.

- **`npm test`** covers the signaling server (rooms, relaying only inside a room,
  chat limits, hang-up, held seats, rejoining and the grace period), sign-up and
  login rules, sessions stored in MongoDB, rooms, HTML escaping, logout, security
  headers and the brute-force limits.
- **`npm run test:e2e`** opens two browser sessions in the installed Google Chrome
  (set `CHROME_PATH` to use another one) with a synthetic camera and microphone, and
  checks that the call connects with video both ways, that chat messages arrive as
  text, that a dropped signaling connection doesn't end the call, and that hanging
  up tells the partner at once.

The first run downloads the MongoDB binary (about 120 MB on Linux and macOS, 780 MB
on Windows) and keeps it in `~/.cache/mongodb-binaries`. On a slow connection you can
download it yourself from [mongodb.com](https://www.mongodb.com/try/download/community)
and point the tests at its `mongod` with `MONGOMS_SYSTEM_BINARY=/path/to/mongod`.

GitHub Actions runs `npm test` on Node 20, 22 and 24, `npm audit`, and the
end-to-end test on every push to `main` and every pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Installation

### Requirements

- [Node.js](https://nodejs.org/) **20.12 or newer** (it includes npm).
- A MongoDB database. The free tier of [MongoDB Atlas](https://www.mongodb.com/atlas) works, or a local MongoDB server.
- Optional but recommended: a free [Xirsys](https://xirsys.com/) account for TURN.
  Without it, calls between some networks (mobile data, offices) may not connect.

### 1. Get the code and install the dependencies

**Windows (PowerShell)**

```powershell
git clone https://github.com/Josafath/simple-video-chat.git
cd simple-video-chat\v1
npm install
copy .env.example .env
```

**macOS / Linux (Terminal)**

```bash
git clone https://github.com/Josafath/simple-video-chat.git
cd simple-video-chat/v1
npm install
cp .env.example .env
```

### 2. Fill in `v1/.env`

Open `.env` with any editor and set:

| Variable | Required | What to put |
|---|---|---|
| `MONGODB_URI` | yes | Atlas: **Connect → Drivers** and copy the string (add the database name, e.g. `/videochat`). Local: `mongodb://127.0.0.1:27017/videochat` |
| `SESSION_SECRET` | yes | A long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `XIRSYS_IDENT`, `XIRSYS_SECRET`, `XIRSYS_CHANNEL` | no | In Xirsys, create a channel and open **API Info**. The server asks Xirsys for temporary TURN credentials on every call, so the secret never reaches the browser. |
| `ICE_SERVERS` | no | Your own STUN/TURN servers as JSON, used when Xirsys is not set. Default: Google's public STUN. |
| `PORT` | no | Default `3000`. |
| `NODE_ENV` | no | `production` when the app runs behind HTTPS. |

`.env` is in `.gitignore`. Never commit it.

### 3. Run it

```bash
npm start
```

Open http://localhost:3000, sign up, and create a room. To test alone, open a
second browser (or a private window), sign up with another user, and join the
room by its name.

> Browsers only allow the camera on `localhost` or on **HTTPS**. To use it
> from another device, deploy the app with HTTPS (Render, Railway, Fly.io...)
> and set `NODE_ENV=production`.

### Troubleshooting

**`MongoDB Error Connection: querySrv ECONNREFUSED _mongodb._tcp...`**
A `mongodb+srv://` connection string needs a DNS lookup that Node does with its
own resolver. On some Windows networks that resolver can't find the system's DNS
server (Node reports `127.0.0.1`) even though the browser works. Check it with:

```bash
node -e "console.log(require('dns').getServers())"
```

If it prints `[ '127.0.0.1' ]`, use the standard connection string instead,
which doesn't need that lookup: in Atlas, open **Connect → Drivers**, and
copy the string that starts with `mongodb://` and lists three hosts. If Atlas only
shows the `+srv` one, choose an older driver version there. Restarting the
network adapter or changing networks also fixes it.

**The call never connects between two networks (for example mobile data and an
office Wi-Fi).** A TURN server is needed: set the Xirsys variables.

## What v1 fixed

The original code is in the git history (before the `v1/` folder). These are
the problems that v1 fixes:

**Security**

- The MongoDB password and the TURN credentials were written in the code. They now come from environment variables. The old values are still in the git history, so they must be treated as public and replaced.
- The session secret was `"demoapp"`. It now comes from `SESSION_SECRET`. The cookie is now `httpOnly` and `sameSite`, and it is `secure` in production.
- **XSS in the chat.** Messages were inserted as HTML. Now they are inserted as text.
- Any client could crash the server by sending the `ipaddr` event (it used `os` without importing it). The event was removed.
- `app.locals.currentUser` was shared by every request and could show one user's data to another.
- `/home` and `/home/join` didn't need a login, and Socket.IO accepted anyone. Both now require a session.
- A client could send signaling messages to any room. Now the server only relays to the room the socket joined.
- The user object, password hash included, was printed in the logs.
- `ejs` 2.6 had a remote code execution vulnerability. All dependencies were updated, and `npm audit` reports 0 vulnerabilities.

**Bugs**

- The room counter started at 1, so the second person was treated like the first one and the call never started.
- The chat used `io.emit`, so every message went to every room.
- Creating a room never detected duplicate names (a missing `await`). Rooms now have a unique name.
- Sign-up checked duplicates without waiting for the result, and compared the email against the username. It could crash with "headers already sent". Usernames and emails are now unique, and the forms show clear errors.
- Login failures, unknown rooms and taken names failed silently. They now show a message.
- WebRTC used `addStream`/`onaddstream`, which browsers removed. It now uses `addTrack`/`ontrack` and promises. ICE candidates that arrive early are queued.
- The local video wasn't muted, so you heard your own microphone. `trace()` didn't exist, `bye` was sent twice, and hanging up sent you to the login page.
- After a hangup, the person who stayed can receive a new partner in the same room.
- Unused dependencies were removed (`dotenv`, `express-validator`, `cookie-parser`, `debug`, `http-errors`). Node reads `.env` by itself now.

## Security hardening

- **Login brute force:** 10 failed logins per IP every 15 minutes, then the login answers 429 ("Too many failed attempts"). Successful logins don't count. Sign-up is limited to 10 accounts per IP per hour.
- **Security headers** with [helmet](https://helmetjs.github.io/): a Content Security Policy that only allows the app's own files, the emoji picker from jsDelivr, the error page's Giphy embed and the Socket.IO WebSocket; `X-Content-Type-Options`, `Referrer-Policy`, no `X-Powered-By`, and HSTS in production.
- **Subresource Integrity** on the emoji picker: the browser refuses the file if the CDN ever serves a different one.
- **Sessions in MongoDB** (collection `sessions`, via [connect-mongo](https://github.com/jdesboeufs/connect-mongo)), deleted automatically when they expire after 8 hours. A restart or a deploy no longer logs everybody out, so browsers in a call reconnect on their own and start the call again.
- The session stores the user's id and name, so pages and the signaling server no longer query the users collection on every request.
- **Log out is a POST** form, so a link or image on another site can't log users out.

## Known limitations (v1)

- Two people per room. Group calls would need an SFU (a media server) instead of peer-to-peer.
- Held seats and the login/sign-up limits are kept in the server's memory: fine for one server, but several servers would need a shared store (for example Redis) and the Socket.IO Redis adapter.
- After a server restart the call starts again (a short pause in the video), because held seats don't survive the restart.
- No CSRF tokens. The `sameSite=lax` cookie blocks the usual cross-site form posts.

## Technologies

- **WebRTC**: real-time peer-to-peer audio and video.
- **Socket.IO**: signaling and chat between clients.
- **Node.js + Express**: web server, sessions and pages (EJS).
- **Passport + bcrypt**: login.
- **MongoDB + Mongoose**: users and rooms.
- **Xirsys**: STUN/TURN servers.

## Author's note

This was the hardest project I made. I've never felt so much confusion and
frustration from not knowing something, but in the end everything paid off.
If you have ideas to improve it, feel free to open an issue or send me an email. :)
