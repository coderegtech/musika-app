const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");

// Google refuses sign-in from browsers that identify as embedded apps
// ("This browser or app may not be secure"), so present a plain Chrome UA.
app.userAgentFallback = app.userAgentFallback.replace(
  / (musika-desktop|Electron)\/\S+/g,
  "",
);

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

// Serves the static Expo web export over http://localhost instead of file://,
// since Firebase Auth requires a real origin on its authorized-domain list.
// "localhost" is on that list by default; "127.0.0.1" is not (it fails with
// auth/unauthorized-domain), so the window must load the localhost name.
const ORIGIN = `http://localhost:${PORT}`;
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
  win.loadURL(ORIGIN);
  // Firebase's Google sign-in popup must open in-app so it can post the result
  // back to this window; other external links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const { protocol, hostname } = new URL(url);
    if (
      protocol === "https:" &&
      (hostname.endsWith(".firebaseapp.com") || hostname.endsWith(".web.app"))
    )
      return { action: "allow" };
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
