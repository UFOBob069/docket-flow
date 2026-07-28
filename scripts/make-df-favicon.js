const sharp = require("sharp");
const fs = require("fs");

function svg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0B1F3A"/>
  <text x="32" y="43" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">
    <tspan fill="#FFFFFF">D</tspan><tspan fill="#D3368A">F</tspan>
  </text>
</svg>`;
}

(async () => {
  const targets = [
    ["src/app/icon.png", 32],
    ["src/app/apple-icon.png", 180],
    ["public/favicon-df.png", 48],
  ];
  for (const [file, size] of targets) {
    const buf = await sharp(Buffer.from(svg(size))).png().toBuffer();
    fs.writeFileSync(file, buf);
    console.log("wrote", file, buf.length);
  }
  fs.writeFileSync("public/favicon-df.svg", svg(64));
  console.log("wrote public/favicon-df.svg");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
