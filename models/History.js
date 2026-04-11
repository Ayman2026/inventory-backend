const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  name: String,
  change: String,
  time: String,
  note: String,
  userId: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("History", historySchema);
