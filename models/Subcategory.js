const mongoose = require("mongoose");

const subcategorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  userId: { type: String, required: true }
}, { timestamps: true });

subcategorySchema.index({ userId: 1, categoryId: 1 });
subcategorySchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model("Subcategory", subcategorySchema);
