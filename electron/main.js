const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

const PORT = 17321;
const WEB_ROOT = path.join(__dirname, "web");
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

// Serves the static Expo web export over http(s)-style localhost instead of
// file://, since Google Identity Services requires a real origin to render.
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const requested = path.normalize(
        path.join(WEB_ROOT, decodeURIComponent(req.url.split("?")[0])),
      );
      const filePath = requested.startsWith(WEB_ROOT) ? requested : WEB_ROOT;
      fs.stat(filePath, (err, stat) => {
        const target =
          err || !stat.isFile() ? path.join(WEB_ROOT, "index.html") : filePath;
        fs.readFile(target, (readErr, data) => {
          if (readErr) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, {
            "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
          });
          res.end(data);
        });
      });
    });
    server.listen(PORT, "127.0.0.1", resolve);
  });
}

async function createWindow() {
  await serve();
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    title: "Musika",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
  // Open external links (e.g. an eventual "About" link) in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
