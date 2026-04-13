const mongoose = require("mongoose");

const suggestionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { 
    type: String, 
    enum: ['reorder', 'dead_stock', 'fast_mover', 'pricing', 'seasonal', 'bundle', 'clearance', 'trend'],
    required: true 
  },
  priority: { 
    type: String, 
    enum: ['high', 'medium', 'low'],
    required: true 
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  action: { type: String },
  impact: { type: String },
  productName: { type: String },
  data: { type: Object },
  dismissed: { type: Boolean, default: false },
  actedUpon: { type: Boolean, default: false }
}, { timestamps: true });

suggestionSchema.index({ userId: 1, createdAt: -1 });
suggestionSchema.index({ userId: 1, dismissed: 1 });

module.exports = mongoose.model("Suggestion", suggestionSchema);
