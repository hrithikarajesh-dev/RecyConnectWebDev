const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const app = express();

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "RECYCONNECT")));

// Point calculation based on waste type
const pointsPerKg = {
  "Plastic Bottles": 10,
  "Paper / Cardboard": 10,
  "E-Waste": 20,
  "Metal Cans": 15,
};

// Initialize database tables
async function initializeDatabase() {
  try {
    // Drop old users table if it exists (for schema migration)
    await pool.query(`DROP TABLE IF EXISTS redemptions, waste_submissions, users CASCADE`);

    // Create users table (allow duplicate emails)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        points INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create waste submissions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS waste_submissions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        waste_type VARCHAR(100),
        weight DECIMAL(10, 2),
        address TEXT,
        pickup_date DATE,
        points_earned INT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create redemptions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS redemptions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id),
        reward_type VARCHAR(255),
        points_used INT,
        status VARCHAR(50) DEFAULT 'Completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("Database tables initialized");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

// Initialize on startup
initializeDatabase();

// API Routes

// Get current user from session (simplified - using email as identifier)
// If multiple accounts with same email, returns the most recent one
const getCurrentUser = async (email) => {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
    [email]
  );
  return result.rows[0] || null;
};

// REGISTER USER
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const result = await pool.query(
      "INSERT INTO users (name, email, password, points) VALUES ($1, $2, $3, 0) RETURNING id, name, email, points",
      [name, email, hashedPassword]
    );

    res.json({
      message: "Registration successful",
      user: result.rows[0],
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SUBMIT WASTE
app.post("/submit-waste", async (req, res) => {
  try {
    const { email, wasteType, weight, address, pickupDate } = req.body;

    if (!email || !wasteType || !weight) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await getCurrentUser(email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const pointsPerKgValue = pointsPerKg[wasteType] || 10;
    const pointsEarned = Math.round(weight * pointsPerKgValue);

    // Insert waste submission
    const result = await pool.query(
      "INSERT INTO waste_submissions (user_id, waste_type, weight, address, pickup_date, points_earned, status) VALUES ($1, $2, $3, $4, $5, $6, 'Pending') RETURNING *",
      [user.id, wasteType, weight, address, pickupDate, pointsEarned]
    );

    // Update user points
    await pool.query("UPDATE users SET points = points + $1 WHERE id = $2", [
      pointsEarned,
      user.id,
    ]);

    res.json({
      message: "Waste submitted successfully",
      submission: result.rows[0],
      pointsEarned,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// REDEEM REWARD
app.post("/redeem", async (req, res) => {
  try {
    const { email, rewardType, pointsRequired } = req.body;

    if (!email || !rewardType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const user = await getCurrentUser(email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.points < pointsRequired) {
      return res
        .status(400)
        .json({ error: "Insufficient points for redemption" });
    }

    // Insert redemption
    const result = await pool.query(
      "INSERT INTO redemptions (user_id, reward_type, points_used, status) VALUES ($1, $2, $3, 'Completed') RETURNING *",
      [user.id, rewardType, pointsRequired]
    );

    // Update user points
    await pool.query("UPDATE users SET points = points - $1 WHERE id = $2", [
      pointsRequired,
      user.id,
    ]);

    res.json({
      message: "Reward redeemed successfully",
      redemption: result.rows[0],
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET USER DATA
app.get("/user/:email", async (req, res) => {
  try {
    const user = await getCurrentUser(req.params.email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get recent activity
    const activity = await pool.query(
      `SELECT waste_type, weight, points_earned, status, created_at FROM waste_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [user.id]
    );

    // Get total recycled
    const stats = await pool.query(
      `SELECT 
        SUM(weight) as total_weight,
        SUM(points_earned) as total_points
      FROM waste_submissions WHERE user_id = $1`,
      [user.id]
    );

    res.json({
      user: {
        name: user.name,
        email: user.email,
        points: user.points,
        totalRecycled: stats.rows[0].total_weight || 0,
      },
      activity: activity.rows,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SERVE PAGES
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "RECYCONNECT", "index.html"));
});

app.get("/api/status", (req, res) => {
  res.json({ status: "RecyConnect Backend is running" });
});

// Start server
const PORT = 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:" + PORT);
});
