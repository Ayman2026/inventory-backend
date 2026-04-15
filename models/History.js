const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  name: String,
  change: String,
  time: String,
  note: String,
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
  dealer: { type: mongoose.Schema.Types.ObjectId, ref: "Dealer" },
  userId: { type: String, required: true }
}, { timestamps: true });

// Indexes for fast queries
historySchema.index({ userId: 1 });
historySchema.index({ userId: 1, createdAt: -1 });
historySchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model("History", historySchema);
