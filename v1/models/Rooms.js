const crypto = require("crypto");
const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// A room lives for this long after it was last opened; then MongoDB deletes it.
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
// Invite tokens: 16 random bytes in base64url, always 22 characters.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

function newToken() {
    return crypto.randomBytes(16).toString("base64url");
}

function newExpiry() {
    return new Date(Date.now() + ROOM_TTL_MS);
}

// Rooms are private: they are opened with a secret invite link (/room/<token>), not
// by name. 128 random bits can't be guessed, unlike a name or a MongoDB ObjectId
// (which is mostly a timestamp and a counter). The name is only a label for people.
const Rooms = new Schema({
    name: {type: String, required: true, trim: true, minlength: 1, maxlength: 50},
    token: {type: String, required: true, unique: true, default: newToken},
    owner: {type: Schema.Types.ObjectId, ref: "Users", required: true, index: true},
    // TTL index: MongoDB deletes the room once this date has passed (checked about
    // every minute, so queries also compare it with the current time).
    expiresAt: {type: Date, required: true, default: newExpiry, expires: 0},
}, {timestamps: true});

Rooms.virtual("url")
    .get(function() {
        return "/room/" + this.token;
    })

/**
 * The room for an invite token, if it exists and hasn't expired. Opening a room
 * pushes its expiry back, so rooms in use don't disappear.
 */
Rooms.statics.openByToken = function(token) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return Promise.resolve(null);
    return this.findOneAndUpdate(
        {token, expiresAt: {$gt: new Date()}},
        {expiresAt: newExpiry()},
        {new: true},
    );
}

/** Whether a token belongs to a room that still exists (no expiry change). */
Rooms.statics.isActive = async function(token) {
    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return false;
    return Boolean(await this.exists({token, expiresAt: {$gt: new Date()}}));
}

module.exports = mongoose.model("Rooms", Rooms)
module.exports.ROOM_TTL_MS = ROOM_TTL_MS;
module.exports.TOKEN_PATTERN = TOKEN_PATTERN;
