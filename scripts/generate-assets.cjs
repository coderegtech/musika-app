const sharp = require("sharp");
const fs = require("fs");
fs.mkdirSync("assets", { recursive: true });
const symbol =
  '<path d="M246 665V359q0-55 45-24l221 166 221-166q45-31 45 24v306" fill="none" stroke="COLOR" stroke-width="76" stroke-linecap="round" stroke-linejoin="round"/><path d="M512 475v242m-80-80 80 80 80-80" fill="none" stroke="COLOR" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>';
async function render(name, size, color, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg ? `<rect width="1024" height="1024" rx="230" fill="${bg}"/>` : ""}${symbol.replaceAll("COLOR", color)}</svg>`;
  fs.writeFileSync("assets/" + name + ".svg", svg);
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile("assets/" + name + ".png");
}
(async () => {
  await render("icon", 1024, "#263E32", "#D9F279");
  await render("logo-dark", 1024, "#D9F279", null);
  await render("logo-light", 1024, "#263E32", null);
  await render("adaptive-icon", 1024, "#263E32", null);
  await render("notification", 96, "#ffffff", null);
  await render("splash", 512, "#263E32", null);
  await render("favicon", 64, "#263E32", "#D9F279");
})();
