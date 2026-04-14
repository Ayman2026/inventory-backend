require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const History = require("./models/History");
const Suggestion = require("./models/Suggestion");
const Category = require("./models/Category");
const Subcategory = require("./models/Subcategory");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const authRoutes = require("./routes/auth");
const authMiddleware = require("./middleware/auth");
const aiSuggestionEngine = require("./utils/aiSuggestions");

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
    const products = await Product.find({ userId: req.user.id })
      .populate("category", "name")
      .populate("subcategory", "name");
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download products as CSV (user's only)
app.get("/products/download", authMiddleware, async (req, res) => {
  try {
    const { category, subcategory } = req.query;
    
    // Build filter
    const filter = { userId: req.user.id };
    if (category) {
      filter.category = category;
    }
    if (subcategory) {
      filter.subcategory = subcategory;
    }

    const products = await Product.find(filter)
      .populate("category", "name")
      .populate("subcategory", "name")
      .sort({ name: 1 });

    const csvHeader = "Name,Quantity,Price,Total Worth,Min Stock,Category,Subcategory,Date Added\n";
    const csvRows = products.map(product => {
      const name = `"${(product.name || '').replace(/"/g, '""')}"`;
      const quantity = product.quantity || 0;
      const price = product.price || 0;
      const totalWorth = quantity * price;
      const minStock = product.minStock || 0;
      const category = `"${((product.category && product.category.name) || '').replace(/"/g, '""')}"`;
      const subcategory = `"${((product.subcategory && product.subcategory.name) || '').replace(/"/g, '""')}"`;
      const date = new Date(product.createdAt).toISOString();
      return `${name},${quantity},${price},${totalWorth},${minStock},${category},${subcategory},${date}`;
    }).join("\n");

    // Calculate grand total
    const grandTotal = products.reduce((sum, p) => sum + ((p.quantity || 0) * (p.price || 0)), 0);
    const totalRow = `\nGRAND TOTAL,,,${grandTotal},,,,`;

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

// Product Received - Add stock
app.post("/products/:id/receive", authMiddleware, async (req, res) => {
  try {
    const { quantity, note } = req.body;
    const product = await Product.findOne({ _id: req.params.id, userId: req.user.id });
    if (!product) return res.status(404).json({ error: "Product not found" });

    product.quantity += Number(quantity);
    await product.save();

    // Add to history
    await History.create({
      name: product.name,
      change: `+${quantity}`,
      time: new Date().toLocaleString(),
      note: note || "Product Received",
      userId: req.user.id
    });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Product Dispatched - Subtract stock
app.post("/products/:id/dispatch", authMiddleware, async (req, res) => {
  try {
    const { quantity, note } = req.body;
    const product = await Product.findOne({ _id: req.params.id, userId: req.user.id });
    if (!product) return res.status(404).json({ error: "Product not found" });

    product.quantity = Math.max(0, product.quantity - Number(quantity));
    await product.save();

    // Add to history
    await History.create({
      name: product.name,
      change: `-${quantity}`,
      time: new Date().toLocaleString(),
      note: note || "Product Dispatched",
      userId: req.user.id
    });

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CATEGORY ROUTES (Protected) ---

// Get all categories
app.get("/categories", authMiddleware, async (req, res) => {
  try {
    const categories = await Category.find({ userId: req.user.id }).sort({ name: 1 });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create category
app.post("/categories", authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    const category = new Category({ name, userId: req.user.id });
    await category.save();
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete category (also deletes associated subcategories)
app.delete("/categories/:id", authMiddleware, async (req, res) => {
  try {
    const category = await Category.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!category) return res.status(404).json({ error: "Category not found" });
    await Subcategory.deleteMany({ categoryId: req.params.id, userId: req.user.id });
    res.json({ message: "Category and its subcategories deleted ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUBCATEGORY ROUTES (Protected) ---

// Get subcategories by category
app.get("/subcategories", authMiddleware, async (req, res) => {
  try {
    const { categoryId } = req.query;
    const filter = { userId: req.user.id };
    if (categoryId) {
      filter.categoryId = categoryId;
    }
    const subcategories = await Subcategory.find(filter).sort({ name: 1 });
    res.json(subcategories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create subcategory
app.post("/subcategories", authMiddleware, async (req, res) => {
  try {
    const { name, categoryId } = req.body;
    const subcategory = new Subcategory({ name, categoryId, userId: req.user.id });
    await subcategory.save();
    res.json(subcategory);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete subcategory
app.delete("/subcategories/:id", authMiddleware, async (req, res) => {
  try {
    const subcategory = await Subcategory.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!subcategory) return res.status(404).json({ error: "Subcategory not found" });
    res.json({ message: "Subcategory deleted ✅" });
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

// Get all history (user's only) with pagination
app.get("/history", authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const total = await History.countDocuments({ userId: req.user.id });
    const entries = await History.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      }
    });
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

// Download history as CSV (user's only) - Streamed for memory efficiency
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

    // Set CSV headers
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=history_export.csv");
    
    // Write CSV header
    const csvHeader = "Product,Change,Time,Note,Date\n";
    res.write(csvHeader);

    // Stream data in chunks for memory efficiency
    const cursor = History.find(filter).sort({ createdAt: -1 }).cursor();
    
    let isFirst = true;
    for await (const entry of cursor) {
      // Type filter (applied after query since it's based on change content)
      if (type && type !== "all") {
        if (type === "add" && !entry.change.startsWith("+")) continue;
        if (type === "subtract" && !entry.change.startsWith("-")) continue;
        if (type === "update" && !entry.change.includes("Updated")) continue;
      }

      const name = `"${(entry.name || '').replace(/"/g, '""')}"`;
      const change = `"${(entry.change || '').replace(/"/g, '""')}"`;
      const time = `"${(entry.time || '').replace(/"/g, '""')}"`;
      const note = `"${(entry.note || '').replace(/"/g, '""')}"`;
      const date = new Date(entry.createdAt).toISOString();
      
      const row = `${name},${change},${time},${note},${date}\n`;
      res.write(row);
    }

    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get top movers - products with highest stock movement velocity (Optimized)
app.get("/history/top-movers", authMiddleware, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Fetch history and process in Node.js (more reliable than complex aggregation)
    const entries = await History.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(1000); // Limit to last 1000 entries for performance

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
      
      // Update last activity if this is more recent
      if (new Date(entry.createdAt) > new Date(movements[name].lastActivity)) {
        movements[name].lastActivity = entry.createdAt;
      }
    });

    // Convert to array, sort by total movement, and limit
    const topMovers = Object.values(movements)
      .sort((a, b) => b.totalMoved - a.totalMoved)
      .slice(0, parseInt(limit));

    res.json(topMovers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AI SUGGESTION ROUTES (Protected) ---

// Get AI-powered business suggestions
app.get("/suggestions", authMiddleware, async (req, res) => {
  try {
    const { type, priority, includeDismissed } = req.query;
    
    // Generate fresh suggestions and save to database
    const suggestions = await aiSuggestionEngine.generateSuggestions(req.user.id);
    
    // Build query
    const query = { userId: req.user.id };
    
    // Only show non-dismissed unless explicitly requested
    if (includeDismissed !== 'true') {
      query.dismissed = false;
    }
    
    // Filter by type if provided
    if (type && type !== 'all') {
      query.type = type;
    }
    
    // Filter by priority if provided
    if (priority && priority !== 'all') {
      query.priority = priority;
    }

    // Fetch from database with filters
    let filteredSuggestions = await Suggestion.find(query)
      .sort({ createdAt: -1 });

    // Custom priority sorting: high -> medium -> low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    filteredSuggestions.sort((a, b) => {
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    });

    res.json(filteredSuggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dismiss a suggestion
app.put("/suggestions/:id/dismiss", authMiddleware, async (req, res) => {
  try {
    const suggestion = await Suggestion.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { dismissed: true },
      { new: true }
    );
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
    res.json({ message: "Suggestion dismissed ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark suggestion as acted upon
app.put("/suggestions/:id/act", authMiddleware, async (req, res) => {
  try {
    const suggestion = await Suggestion.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { actedUpon: true },
      { new: true }
    );
    if (!suggestion) return res.status(404).json({ error: "Suggestion not found" });
    res.json({ message: "Suggestion marked as acted upon ✅" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 5000, () => {
  console.log(`Server started on port ${process.env.PORT || 5000}`);
});


