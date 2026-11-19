const mongoose = require("mongoose")
const Schema = mongoose.Schema;

// unique creates an index in MongoDB, so two requests at the same time can't
// register the same username or email.
const Users = new Schema({
    name: {type: String, required: true, trim: true, minlength: 1, maxlength: 30, unique: true},
    email: {type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true},
    password: {type: String, required: true},
})

module.exports = mongoose.model("Users", Users)
