const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const Rooms = new Schema({
    name: {type: String, required: true, trim: true, minlength: 1},
});

Rooms.virtual("url")
    .get(function() {
        return ("/home/room/" + this._id);
    })

module.exports = mongoose.model("Rooms", Rooms)