require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const OpenAI = require("openai");
const app = express();


const connectionString = process.env.DATABASE_URL;


const pool = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(express.static(path.join(__dirname, "RECYCONNECT")));

// Point calculation
const pointsPerKg = {
  "Plastic Bottles": 10,
  "Paper / Cardboard": 10,
  "E-Waste": 20,
  "Metal Cans": 15,
  "Biodegradable Substance": 12,
};

// Initialize database
async function initializeDatabase() {
  try {
    console.log("⏳ Attempting to connect to Neon Database...");
    
    // Create users table 
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

    console.log("✅ SUCCESS: Database Connected and Tables Created!");
  } catch (err) {
    console.error("❌ Database initialization error:", err);
  }
}

initializeDatabase();

// --- API Routes ---

const getCurrentUser = async (email) => {
  const result = await pool.query(
    "SELECT * FROM users WHERE email = $1 ORDER BY created_at DESC LIMIT 1",
    [email]
  );
  return result.rows[0] || null;
};

// REGISTER
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Missing fields" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password, points) VALUES ($1, $2, $3, 0) RETURNING id, name, email, points",
      [name, email, hashedPassword]
    );
    res.json({ message: "Registration successful", user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: "Invalid password" });

    res.json({ message: "Login successful", user: { name: user.name, email: user.email } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// RESET PASSWORD
app.post("/reset-password", async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: "Missing fields" });

    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    const lowerMsg = message ? message.toLowerCase() : "";
    
    let botMessage = "I'm not sure about that, but try asking about 'plastic', 'paper', 'points', or 'rewards'!";

    // Smart Keyword Detection (No API Key needed)
    if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
      botMessage = "Hello! I am RecyBot. Ask me about recycling rates or how to earn points.";
    } 
    else if (lowerMsg.includes("plastic") || lowerMsg.includes("bottle")) {
      botMessage = "Plastic bottles are highly recyclable! You earn 10 Points per kg for clean plastic bottles. Please remove the caps before submitting.";
    }
    else if (lowerMsg.includes("paper") || lowerMsg.includes("cardboard")) {
      botMessage = "Paper and cardboard are great! You earn 10 Points per kg. Make sure they are dry and flattened.";
    }
    else if (lowerMsg.includes("ewaste") || lowerMsg.includes("electronic") || lowerMsg.includes("e-waste")) {
      botMessage = "E-Waste is valuable! You get 20 Points per kg for old electronics. Do not dispose of batteries in regular trash.";
    }
    else if (lowerMsg.includes("metal") || lowerMsg.includes("can")) {
      botMessage = "Metal cans earn 15 Points per kg. Aluminum cans are 100% recyclable!";
    }
    else if (lowerMsg.includes("point") || lowerMsg.includes("score")) {
      botMessage = "You earn points based on weight! Plastic/Paper = 10pts, E-Waste = 20pts. Check your Dashboard to see your balance.";
    }
    else if (lowerMsg.includes("thank")) {
      botMessage = "You're welcome! Keep recycling to save the planet! 🌍";
    }

    // Simulate thinking delay for realism
    setTimeout(() => {
        res.json({ reply: botMessage });
    }, 500);

  } catch (err) {
    res.status(400).json({ error: "Failed to process message" });
  }
});


// SUBMIT WASTE
app.post("/submit-waste", async (req, res) => {
  try {
    const { email, wasteType, weight, address, pickupDate } = req.body;
    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const pointsPerKgValue = pointsPerKg[wasteType] || 10;
    const pointsEarned = Math.round(weight * pointsPerKgValue);

    const result = await pool.query(
      "INSERT INTO waste_submissions (user_id, waste_type, weight, address, pickup_date, points_earned, status) VALUES ($1, $2, $3, $4, $5, $6, 'Pending') RETURNING *",
      [user.id, wasteType, weight, address, pickupDate, pointsEarned]
    );

    await pool.query("UPDATE users SET points = points + $1 WHERE id = $2", [pointsEarned, user.id]);
    res.json({ message: "Waste submitted", submission: result.rows[0], pointsEarned });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// REDEEM
app.post("/redeem", async (req, res) => {
  try {
    const { email, rewardType, pointsRequired } = req.body;
    const user = await getCurrentUser(email);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.points < pointsRequired) return res.status(400).json({ error: "Insufficient points" });

    const result = await pool.query(
      "INSERT INTO redemptions (user_id, reward_type, points_used, status) VALUES ($1, $2, $3, 'Completed') RETURNING *",
      [user.id, rewardType, pointsRequired]
    );

    await pool.query("UPDATE users SET points = points - $1 WHERE id = $2", [pointsRequired, user.id]);
    res.json({ message: "Reward redeemed", redemption: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET USER
app.get("/user/:email", async (req, res) => {
  try {
    const user = await getCurrentUser(req.params.email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const activity = await pool.query(
      `SELECT waste_type, weight, points_earned, status, created_at FROM waste_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [user.id]
    );
    
    const stats = await pool.query(
      `SELECT SUM(weight) as total_weight, SUM(points_earned) as total_points FROM waste_submissions WHERE user_id = $1`,
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "RECYCONNECT", "index.html"));
});

const PORT = 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:" + PORT);
});