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

// Download products as CSV (user's only)
app.get("/products/download", authMiddleware, async (req, res) => {
  try {
    const products = await Product.find({ userId: req.user.id }).sort({ name: 1 });

    const csvHeader = "Name,Quantity,Price,Total Worth,Min Stock,Category,Date Added\n";
    const csvRows = products.map(product => {
      const name = `"${(product.name || '').replace(/"/g, '""')}"`;
      const quantity = product.quantity || 0;
      const price = product.price || 0;
      const totalWorth = quantity * price;
      const minStock = product.minStock || 0;
      const category = `"${(product.category || '').replace(/"/g, '""')}"`;
      const date = new Date(product.createdAt).toISOString();
      return `${name},${quantity},${price},${totalWorth},${minStock},${category},${date}`;
    }).join("\n");

    // Calculate grand total
    const grandTotal = products.reduce((sum, p) => sum + ((p.quantity || 0) * (p.price || 0)), 0);
    const totalRow = `\nGRAND TOTAL,,,,${grandTotal},,`;

    const csv = csvHeader + csvRows + totalRow;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products_export.csv");
    res.send(csv);
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
    const { name, dateFrom, dateTo, type } = req.query;
    
    const filter = { userId: req.user.id };
    
    // Name filter
    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }
    
    // Date filter
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        filter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }
    
    const entries = await History.find(filter).sort({ createdAt: -1 });
    
    // Type filter (applied after query since it's based on change content)
    let filtered = entries;
    if (type && type !== "all") {
      filtered = entries.filter(entry => {
        if (type === "add") return entry.change.startsWith("+");
        if (type === "subtract") return entry.change.startsWith("-");
        if (type === "update") return entry.change.includes("Updated");
        return true;
      });
    }

    const csvHeader = "Product,Change,Time,Note,Date\n";
    const csvRows = filtered.map(entry => {
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

// Get top movers - products with highest stock movement velocity
app.get("/history/top-movers", authMiddleware, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const entries = await History.find({ userId: req.user.id }).sort({ createdAt: -1 });

    // Aggregate movements per product
    const movements = {};
    entries.forEach(entry => {
      const name = entry.name;
      if (!movements[name]) {
        movements[name] = { name, totalMoved: 0, transactions: 0, lastActivity: entry.createdAt };
      }
      movements[name].transactions += 1;

      // Parse the change value (e.g., "+50" -> 50, "-20" -> 20, "Updated Product" -> 0)
      let moved = 0;
      if (entry.change.startsWith("+")) {
        moved = parseInt(entry.change.replace("+", "")) || 0;
      } else if (entry.change.startsWith("-")) {
        moved = Math.abs(parseInt(entry.change.replace("-", "")) || 0);
      }
      movements[name].totalMoved += moved;
      movements[name].lastActivity = new Date(entry.createdAt) > new Date(movements[name].lastActivity) 
        ? entry.createdAt 
        : movements[name].lastActivity;
    });

    // Convert to array and sort by total movement
    const topMovers = Object.values(movements)
      .sort((a, b) => b.totalMoved - a.totalMoved)
      .slice(0, parseInt(limit));

    res.json(topMovers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server started on port ${process.env.PORT || 5000}`);
});


