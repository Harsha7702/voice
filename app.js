const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const XLSX = require("xlsx");
const multer = require("multer");
const path = require("path");
const Fuse = require("fuse.js");
const fs = require("fs");
const AWS = require("aws-sdk");
require("dotenv").config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Ensure 'uploads' directory exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Persistent storage for script mappings
const scriptFilePath = "script_mappings.json";
let scriptMappings = {};

// Load script mappings from file if it exists
if (fs.existsSync(scriptFilePath)) {
  scriptMappings = JSON.parse(fs.readFileSync(scriptFilePath, "utf-8"));
}

// In-memory storage for uploaded data
const excelData = {};

// Multer File Upload Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, file.originalname), // Keep original filename
});
const upload = multer({ storage });

// Upload and Handle Excel Files
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const fileName = req.file.originalname;
    const clientName = req.body.clientName || "Unknown"; // Default client name if not provided
    const filePath = req.file.path;
    let scriptId, redirectUrl;

    // Reuse scriptId & URL if file already exists
    if (scriptMappings[fileName]) {
      scriptId = scriptMappings[fileName].scriptId;
      redirectUrl = scriptMappings[fileName].redirectUrl;
    } else {
      // Generate new scriptId if file is new
      scriptId = Date.now().toString();
      redirectUrl = `/ask/${scriptId}`;
      scriptMappings[fileName] = { scriptId, redirectUrl };
      fs.writeFileSync(scriptFilePath, JSON.stringify(scriptMappings, null, 2)); // Save persistently
    }

    // Read Excel File
    const workbook = XLSX.readFile(filePath);
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    if (!sheet || sheet.length === 0) {
      return res.status(400).json({ error: "The uploaded file is empty or invalid." });
    }

    // Validate Required Columns
    const requiredColumns = ["Question", "Answer"];
    const sheetKeys = Object.keys(sheet[0]);
    const missingColumns = requiredColumns.filter((col) => !sheetKeys.includes(col));

    if (missingColumns.length > 0) {
      return res.status(400).json({
        error: `Missing columns: ${missingColumns.join(", ")}.`,
      });
    }

    // Store Data in Memory for Search
    excelData[scriptId] = {
      sheet,
      fuse: new Fuse(sheet, { keys: ["Question"], threshold: 0.4 }),
    };

    // Save Script Link with Client Name
    const scriptEntry = `Client: ${clientName}, Script ID: ${scriptId}, File Name: ${fileName}, URL: http://localhost:8080${redirectUrl}\n`;
    fs.appendFile("script_links.txt", scriptEntry, (err) => {
      if (err) console.error("Error saving script link:", err);
    });

    res.json({ clientName, scriptId, fileName, redirectUrl });
  } catch (error) {
    console.error("Error handling file upload:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Delete a File Without Changing the URL
app.delete("/delete/:id", (req, res) => {
  const scriptId = req.params.id;

  // Find file associated with scriptId
  const fileEntry = Object.entries(scriptMappings).find(([_, value]) => value.scriptId === scriptId);
  if (!fileEntry) {
    return res.status(404).json({ error: "File not found." });
  }

  const fileName = fileEntry[0];
  const filePath = path.join(__dirname, "uploads", fileName);

  // Delete the file but preserve the scriptId
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  res.json({ message: "File deleted, scriptId preserved for re-upload.", scriptId });
});

// Process Speech Input
app.post("/process-speech/:id", (req, res) => {
  const scriptId = req.params.id;
  const userQuestion = req.body.question?.toLowerCase() || "";

  if (!excelData[scriptId]) {
    return res.status(404).json({ answer: "No data found for this script." });
  }

  const { sheet, fuse } = excelData[scriptId];
  const result = fuse.search(userQuestion);

  if (result.length > 0) {
    res.json({ answer: result[0].item.Answer });
  } else {
    res.json({ answer: "Sorry, I don't understand that question." });
  }
});

// AWS Translate Setup (Use environment variables for security)
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,        // Use environment variables
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // Use environment variables
  region: "us-east-1",
});

const translate = new AWS.Translate();

// Serve the Ask Page
app.get("/ask/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ask.html"));
});

// Catch-All Route for index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
