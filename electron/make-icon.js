const fs = require("fs");
const path = require("path");
const pngToIco = require("png-to-ico");

const source = path.join(__dirname, "..", "assets", "icon.png");
fs.copyFileSync(source, path.join(__dirname, "icon.png"));
pngToIco(source).then((buffer) => {
  fs.writeFileSync(path.join(__dirname, "icon.ico"), buffer);
  console.log("Generated electron/icon.ico and electron/icon.png");
});
