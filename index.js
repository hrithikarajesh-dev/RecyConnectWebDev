const express = require("express");
const path = require("path");
const app = express();

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "RECYCONNECT")));

// test route
app.get("/api/status", (req, res) => {
  res.send("RecyConnect Backend is running");
});

// REGISTER USER (from register.html)
app.post("/register", (req, res) => {
  console.log("Register Data:", req.body);

  res.json({
    message: "Registration successful (no DB used)",
    data: req.body,
  });
});

// SUBMIT WASTE (from waste-form.html)
app.post("/submit-waste", (req, res) => {
  console.log("Waste Submission:", req.body);

  res.json({
    message: "Waste submitted successfully (no DB used)",
    data: req.body,
  });
});

// Serve index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "RECYCONNECT", "index.html"));
});

// start server
const PORT = 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on http://0.0.0.0:" + PORT);
});
