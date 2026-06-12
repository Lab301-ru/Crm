// Генерация PWA-иконок из public/icons/icon.svg.
// Запуск: node scripts/generate-icons.mjs (PNG коммитятся в репозиторий,
// перегенерация нужна только при смене иконки).
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "public/icons/icon.svg");
const out = (name) => join(root, "public/icons", name);

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "maskable-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

for (const { file, size } of targets) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(out(file));
  console.log(`✓ ${file} (${size}×${size})`);
}
