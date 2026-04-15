const mongoose = require("mongoose");

const dealerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contactPerson: { type: String },
  email: { type: String },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  city: { type: String },
  state: { type: String },
  pincode: { type: String },
  gstNumber: { type: String },
  notes: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: true });

// Index for fast queries
dealerSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model("Dealer", dealerSchema);
