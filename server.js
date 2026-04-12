require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const History = require("./models/History");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth");
const authMiddleware = require("./middleware/auth");

const app = express();

// CORS configuration - handles trailing slash variations
const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");
app.use(cors({
  origin: [frontendUrl, frontendUrl + "/"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Auth routes (no auth required)
app.use("/auth", authRoutes);

// MongoDB connect
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected ✅"))
  .catch(err => console.log(err));

// Home route
app.get("/", (req, res) => {
  res.send("Server working");
});

// --- PRODUCT ROUTES (Protected) ---

// Add product
app.post("/products", authMiddleware, async (req, res) => {
  try {
    const product = new Product({ ...req.body, userId: req.user.id });
    await product.save();
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all products (user's only)
app.get("/products", authMiddleware, async (req, res) => {
  try {
    const products = await Product.find({ userId: req.user.id });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update product
app.put("/products/:id", authMiddleware, async (req, res) => {
  try {
    const updated = await Product.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      req.body,
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Product not found" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete product
app.delete("/products/:id", authMiddleware, async (req, res) => {
  try {
    const deleted = await Product.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!deleted) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Product deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- HISTORY ROUTES (Protected) ---

// Add history entry
app.post("/history", authMiddleware, async (req, res) => {
  try {
    const entry = new History({ ...req.body, userId: req.user.id });
    await entry.save();
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all history (user's only)
app.get("/history", authMiddleware, async (req, res) => {
  try {
    const entries = await History.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete history entry
app.delete("/history/:id", authMiddleware, async (req, res) => {
  try {
    const deleted = await History.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!deleted) return res.status(404).json({ error: "Entry not found" });
    res.json({ message: "Entry deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all history (user's only)
app.delete("/history", authMiddleware, async (req, res) => {
  try {
    await History.deleteMany({ userId: req.user.id });
    res.json({ message: "All history cleared ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download history as CSV (user's only)
app.get("/history/download", authMiddleware, async (req, res) => {
  try {
    const entries = await History.find({ userId: req.user.id }).sort({ createdAt: -1 });
    
    const csvHeader = "Product,Change,Time,Note,Date\n";
    const csvRows = entries.map(entry => {
      const name = `"${(entry.name || '').replace(/"/g, '""')}"`;
      const change = `"${(entry.change || '').replace(/"/g, '""')}"`;
      const time = `"${(entry.time || '').replace(/"/g, '""')}"`;
      const note = `"${(entry.note || '').replace(/"/g, '""')}"`;
      const date = new Date(entry.createdAt).toISOString();
      return `${name},${change},${time},${note},${date}`;
    }).join("\n");
    
    const csv = csvHeader + csvRows;
    
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=history_export.csv");
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server started on port ${process.env.PORT || 5000}`);
});


