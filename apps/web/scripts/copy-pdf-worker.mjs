// Copies the pdf.js worker into /public so the browser can load it without bundler config.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = join(root, "public/pdf.worker.min.mjs");

if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log("pdf.js worker copied to public/");
} else {
  console.warn("pdfjs-dist worker not found; PDF previews will be unavailable.");
}
