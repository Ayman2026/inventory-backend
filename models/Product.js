const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: String,
  quantity: Number,
  price: Number,
  minStock: Number,
  userId: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Product", productSchema);