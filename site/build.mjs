import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import matter from "gray-matter";
import { chromium } from "playwright";

const root = process.cwd();
const mdPath = path.join(root, "cv_en.md");
const outDir = path.join(root, "dist");
const siteDir = path.join(root, "site");

const args = new Set(process.argv.slice(2));
const makePdf = args.has("--pdf");

fs.mkdirSync(outDir, { recursive: true });

// 1) Read inputs
const mdRaw = fs.readFileSync(mdPath, "utf-8");
const tpl = fs.readFileSync(path.join(siteDir, "template.html"), "utf-8");
const css = fs.readFileSync(path.join(siteDir, "style.css"), "utf-8");

// 2) Markdown -> HTML
const { data, content } = matter(mdRaw);
const md = new MarkdownIt({ html: true, linkify: true });

const title = data.title ?? "BoSeung Jung — CV";
const updated = new Date().toISOString().slice(0, 10);
const bodyHtml = md.render(content);

// 3) Fill template
const html = tpl
  .replaceAll("{{title}}", escapeHtml(title))
  .replaceAll("{{updated}}", escapeHtml(updated))
  .replace("{{content}}", bodyHtml);

// 4) Write outputs
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");
fs.writeFileSync(path.join(outDir, "style.css"), css, "utf-8");

// (optional) also copy original md for download/reference
fs.writeFileSync(path.join(outDir, "cv_en.md"), mdRaw, "utf-8");

console.log("Built dist/index.html");

if (makePdf) {
  await renderPdf(path.join(outDir, "index.html"), path.join(outDir, "cv.pdf"));
  console.log("Built dist/cv.pdf");
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function renderPdf(htmlFile, pdfFile) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + htmlFile, { waitUntil: "networkidle" });

  // A4 기준, 여백 적당히
  await page.pdf({
    path: pdfFile,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
  });

  await browser.close();
}
