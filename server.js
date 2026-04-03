const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { handleChatRequest, loadDotEnv } = require("./lib/chat");

loadDotEnv(__dirname);

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": contentType
  });
  res.end(body);
}

async function serveStaticFile(reqPath, res) {
  const requestedPath = reqPath === "/" ? "/index.html" : reqPath;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    sendText(res, 200, file, MIME_TYPES[ext] || "application/octet-stream");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendText(res, 404, "Not found");
      return;
    }

    sendText(res, 500, "Failed to load file");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "POST" && url.pathname === "/api/chat") {
    await handleChatRequest(req, res);
    return;
  }

  if (req.method === "GET") {
    await serveStaticFile(url.pathname, res);
    return;
  }

  sendText(res, 405, "Method not allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Chat app running on http://localhost:${PORT}`);
});
