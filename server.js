const express = require("express");
const axios = require("axios");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const app = express();
const { JSDOM } = require("jsdom");
const port = 3000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

// Middleware
app.use(cors());
app.use(limiter);
app.use(express.static("public"));
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Expose-Headers", "Content-Disposition");
  res.header("Access-Control-Allow-Methods", "GET");
  next();
});

function formatSize(sizeText) {
  if (!sizeText) return "Unknown";
  // If already in KB/MB/GB
  const unitMatch = sizeText.match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (unitMatch) return `${unitMatch[1]} ${unitMatch[2].toUpperCase()}`;
  // If just a number, treat as bytes
  if (/^\d+$/.test(sizeText)) {
    return `${Math.round(Number(sizeText) / 1024)} KB`;
  }
  return "Unknown";
}

// File link extraction
async function extractFileLinks(html, baseUrl) {
  const links = [];
  const dom = new JSDOM(html);
  const anchors = dom.window.document.querySelectorAll("tr td a");

  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (href && !href.includes("?")) {
      try {
        const fileUrl = new URL(href, baseUrl).href;
        if (!fileUrl.startsWith("https://")) continue;

        const fileName = a.textContent.trim();
        let sizeText = a.parentElement.nextElementSibling?.textContent.trim() || "";

        let size = formatSize(sizeText);

        // If size is still unknown, try to fetch HEAD for Content-Length
        if (size === "Unknown") {
          try {
            const headResp = await axios.head(fileUrl, { timeout: 5000 });
            const contentLength = headResp.headers["content-length"];
            if (contentLength) {
              size = `${Math.round(Number(contentLength) / 1024)} KB`;
            }
          } catch (e) {
            // Ignore errors, leave as Unknown
          }
        }

        links.push({
          name: fileName,
          url: fileUrl,
          size: size,
        });
      } catch (e) {
        console.warn("Skipping invalid link:", href);
      }
    }
  }
  return links;
}

// Endpoint to process multiple URLs
app.post("/api/process-url", async (req, res) => {
  try {
    let urls = [];
    if (Array.isArray(req.body.cloudflareUrls)) {
      urls = req.body.cloudflareUrls;
    } else if (typeof req.body.cloudflareUrl === "string") {
      urls = [req.body.cloudflareUrl];
    }
    urls = urls.filter((u) => u && u.includes("trycloudflare.com"));
    if (urls.length === 0) {
      return res.status(400).json({ error: "No valid Cloudflare URLs provided" });
    }
    let allFiles = [];
    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        const files = await extractFileLinks(response.data, url);
        files.forEach((f) => (f.source = url));
        allFiles = allFiles.concat(files);
      } catch (e) {
        // Optionally, collect errors per URL
      }
    }
    res.json({ files: allFiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to download files
app.get("/api/download-file", async (req, res) => {
  try {
    const { fileUrl } = req.query;

    if (!fileUrl) {
      return res.status(400).json({ error: "File URL is required" });
    }

    // Validate the URL is from Cloudflare
    if (!fileUrl.includes("trycloudflare.com")) {
      return res.status(400).json({ error: "Invalid file URL" });
    }

    const response = await axios.get(fileUrl, {
      responseType: "stream",
      timeout: 10000,
    });

    // Set appropriate headers
    const fileName = fileUrl.split("/").pop();
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "application/octet-stream"
    );
    // Forward Content-Length header if present
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    // Pipe the file data to the response
    response.data.pipe(res);
  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).json({
      error: "Failed to download file",
      details: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});