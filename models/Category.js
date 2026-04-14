const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  userId: { type: String, required: true }
}, { timestamps: true });

categorySchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model("Category", categorySchema);
