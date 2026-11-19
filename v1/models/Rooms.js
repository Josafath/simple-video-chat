const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Rooms are joined by name, so the name has to be unique.
const Rooms = new Schema({
    name: {type: String, required: true, trim: true, minlength: 1, maxlength: 50, unique: true},
});

Rooms.virtual("url")
    .get(function() {
        return ("/home/room/" + this._id);
    })

module.exports = mongoose.model("Rooms", Rooms)
