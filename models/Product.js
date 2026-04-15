const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: String,
  quantity: Number,
  price: Number,
  minStock: Number,
  damagedQuantity: { type: Number, default: 0 },
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
  subcategory: { type: mongoose.Schema.Types.ObjectId, ref: "Subcategory" },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
  dealer: { type: mongoose.Schema.Types.ObjectId, ref: "Dealer" },
  userId: { type: String, required: true }
}, { timestamps: true });

// Indexes for fast queries
productSchema.index({ userId: 1 });
productSchema.index({ name: 1 });

module.exports = mongoose.model("Product", productSchema);