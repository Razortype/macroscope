import sharp from "sharp";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const sourceSvg = resolve(projectRoot, "src-tauri/icons/macroscope.svg");
const outputDir = resolve(projectRoot, "src-tauri/icons");

mkdirSync(outputDir, { recursive: true });

const svgBuffer = readFileSync(sourceSvg);

const sizes = [
  { name: "32x32.png", size: 32 },
  { name: "128x128.png", size: 128 },
  { name: "128x128@2x.png", size: 256 },
  { name: "icon.png", size: 1024 },
];

for (const { name, size } of sizes) {
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(resolve(outputDir, name));
  console.log(`generated ${name} (${size}×${size})`);
}

console.log("done. now run `cargo tauri icon` to generate .icns and .ico");
