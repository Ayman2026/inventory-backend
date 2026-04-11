const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("Missing Google OAuth credentials in environment variables");
  process.exit(1);
}

const router = express.Router();

// Construct Redirect URI safely
// Priority: Render Auto URL -> Manual Env Var -> Localhost
const backendUrl = (process.env.RENDER_EXTERNAL_URL || process.env.BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');
const REDIRECT_URI = `${backendUrl}/auth/google/callback`;

const client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

// DEMO LOGIN (Temporary - for testing without Google)
router.post("/demo", async (req, res) => {
  try {
    let user = await User.findOne({ email: "demo@fourstar.com" });
    if (!user) {
      user = await User.create({
        googleId: "demo-google-id",
        name: "Demo User",
        email: "demo@fourstar.com",
        picture: null
      });
    }

    const token = jwt.sign(
      { id: user._id, googleId: user.googleId, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate Google Auth URL
router.get("/google", (req, res) => {
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: ["profile", "email"],
    redirect_uri: REDIRECT_URI
  });
  console.log("Google OAuth Redirect URI:", REDIRECT_URI);

  res.json({ url: authUrl });
});

// Handle Google Callback
router.get("/google/callback", async (req, res) => {
  const { code } = req.query;
console.log("Google OAuth Redirect URI:", REDIRECT_URI);

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { sub: googleId, name, email, picture } = payload;

    // Find or create user
    let user = await User.findOne({ googleId });
    if (!user) {
      user = await User.create({ googleId, name, email, picture });
    } else {
      // Update info in case it changed
      user.name = name;
      user.picture = picture;
      await user.save();
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user._id, googleId: user.googleId, email: user.email, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/callback?token=${token}`);
  } catch (err) {
    console.error("Google auth error:", err);
    res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/login?error=auth_failed`);
  }
});

// Get Current User
router.get("/me", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json(decoded);
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;
