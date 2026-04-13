require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const History = require("./models/History");
const Suggestion = require("./models/Suggestion");
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

// Get top movers - products with highest stock movement velocity (Optimized with aggregation)
app.get("/history/top-movers", authMiddleware, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Use MongoDB aggregation pipeline for efficiency
    const topMovers = await History.aggregate([
      { $match: { userId: req.user.id } },
      {
        $group: {
          _id: "$name",
          totalMoved: {
            $sum: {
              $abs: {
                $toDouble: {
                  $substr: ["$change", 1, { $strLenCP: "$change" }]
                }
              }
            }
          },
          transactions: { $sum: 1 },
          lastActivity: { $max: "$createdAt" }
        }
      },
      { $sort: { totalMoved: -1 } },
      { $limit: parseInt(limit) }
    ]);

    // Format response to match existing structure
    const formattedMovers = topMovers.map(mover => ({
      name: mover._id,
      totalMoved: Math.round(mover.totalMoved),
      transactions: mover.transactions,
      lastActivity: mover.lastActivity
    }));

    res.json(formattedMovers);
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


