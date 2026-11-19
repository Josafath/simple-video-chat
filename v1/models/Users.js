const mongoose = require("mongoose")
const Schema = mongoose.Schema;

const Users = new Schema({
    name: {type: String,required: true, trim:true, minlength:1},
    email: {type: String, required: true, trim: true, minlength: 1},
    password: {type: String, required: true, trim: true, minlength: 1},
})

module.exports = mongoose.model("Users", Users)