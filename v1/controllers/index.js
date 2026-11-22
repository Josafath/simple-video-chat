const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const config = require("../config");
const User = require("../models/Users");
const Room = require("../models/Rooms");

// MongoDB error code for a duplicated value in a unique index.
const DUPLICATE_KEY = 11000;

const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Form fields can be missing or arrive as arrays (?room[]=a), so always work
// with a trimmed string.
function field(value) {
    return typeof value === "string" ? value.trim() : "";
}

exports.index = (req, res, next) => {
    res.render('index', { title: 'SP. Improving your coding skills.' });
}

// * --------------- GET requests ONLY -----------------
exports.login_get = (req, res, next) => {
    const error = req.query.error ? "Incorrect username or password" : null;
    res.render('login', { title: "Login", error })
}

exports.signup_get = (req, res, next) => {
    res.render('signup', { title: "Sign up", error: null, values: {} })
}

exports.log_out_get = (req, res, next) => {
    // Since passport 0.6 logout is asynchronous and needs a callback.
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
}

exports.home_get = (req, res, next) => {
    res.render('home', { title: "Welcome!", error: null })
}

exports.join_get = (req, res, next) => {
    res.render('join', { title: "Join the partner meeting", error: null })
}

exports.room_get = async (req, res, next) => {
    try {
        // A malformed id would make findById throw, so treat it as "not found".
        const room = mongoose.isValidObjectId(req.params.id)
            ? await Room.findById(req.params.id)
            : null;
        if (!room) {
            const err = new Error("Room not found");
            err.status = 404;
            return next(err);
        }
        res.render('app', { title: "Meeting in Progress", room })
    } catch (err) {
        next(err);
    }
}

// Joining a room waits for the ICE servers, so a slow Xirsys must not hold it up for long:
// after this, the call goes ahead with plain STUN (see ice_servers_get).
const XIRSYS_TIMEOUT_MS = 2500;

// Asks the Xirsys API for temporary STUN/TURN servers.
// Docs: https://docs.xirsys.com/?pg=api-turn
async function xirsysIceServers({ url, ident, secret, channel }) {
    const response = await fetch(`${url}/_turn/${encodeURIComponent(channel)}`, {
        method: "PUT",
        headers: {
            "Authorization": "Basic " + Buffer.from(`${ident}:${secret}`).toString("base64"),
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ format: "urls" }),
        signal: AbortSignal.timeout(XIRSYS_TIMEOUT_MS),
    });
    const data = await response.json();
    if (data.s !== "ok") throw new Error("Xirsys error: " + JSON.stringify(data.v));
    // Xirsys returns one object with a list of urls; RTCPeerConnection wants an array.
    const servers = data.v.iceServers;
    return Array.isArray(servers) ? servers : [servers];
}

// The browser asks for the STUN/TURN servers here instead of having the
// credentials written in public/javascripts/main.js.
exports.ice_servers_get = async (req, res, next) => {
    if (config.xirsys) {
        try {
            return res.json(await xirsysIceServers(config.xirsys));
        } catch (err) {
            // If Xirsys is down the call can still work with plain STUN.
            console.error("Could not get ICE servers from Xirsys:", err.message);
        }
    }
    res.json(config.iceServers);
}

// * --------------- POST requests ONLY -----------------

exports.join_post = async (req, res, next) => {
    try {
        const room = await Room.findOne({ name: field(req.body.room) });
        if (!room) {
            return res.status(404).render('join', {
                title: "Join the partner meeting",
                error: "There is no room with that name",
            });
        }
        res.redirect(room.url);
    } catch (err) {
        next(err);
    }
};

exports.home_post = async (req, res, next) => {
    const name = field(req.body.room);
    const renderError = (status, error) =>
        res.status(status).render('home', { title: "Welcome!", error });

    if (name.length < 1 || name.length > 50) {
        return renderError(400, "The room name must have between 1 and 50 characters");
    }
    try {
        // The old code forgot the await, so this check never found anything.
        if (await Room.exists({ name })) {
            return renderError(409, "That room name is already taken");
        }
        const room = await new Room({ name }).save();
        res.redirect(room.url);
    } catch (err) {
        // Two users created the same name at the same moment.
        if (err.code === DUPLICATE_KEY) return renderError(409, "That room name is already taken");
        next(err);
    }
}

exports.signup_post = async (req, res, next) => {
    const username = field(req.body.username);
    const email = field(req.body.email).toLowerCase();
    const password = typeof req.body.password === "string" ? req.body.password : "";
    const renderError = (status, error) =>
        res.status(status).render('signup', { title: "Sign up", error, values: { username, email } });

    if (!USERNAME_PATTERN.test(username)) {
        return renderError(400, "The username must have 3 to 30 letters, numbers, dots, dashes or underscores");
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
        return renderError(400, "Please enter a valid email");
    }
    // bcrypt only uses the first 72 bytes of the password.
    if (password.length < 8 || Buffer.byteLength(password) > 72) {
        return renderError(400, "The password must have between 8 and 72 characters");
    }

    try {
        // The old code ran these checks without waiting for them, so it saved
        // the user anyway (and compared the email against the name field).
        if (await User.exists({ $or: [{ name: username }, { email }] })) {
            return renderError(409, "That username or email is already registered");
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await new User({ name: username, email, password: hashedPassword }).save();
        req.login(user, (err) => {
            if (err) return next(err);
            res.redirect("/home");
        });
    } catch (err) {
        if (err.code === DUPLICATE_KEY) return renderError(409, "That username or email is already registered");
        next(err);
    }
}
