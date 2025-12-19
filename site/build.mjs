import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import matter from "gray-matter";
import { chromium } from "playwright";

const root = process.cwd();
const outDir = path.join(root, "dist");
const siteDir = path.join(root, "site");

const args = new Set(process.argv.slice(2));
const makePdf = args.has("--pdf");

fs.mkdirSync(outDir, { recursive: true });

// Shared inputs
const tpl = fs.readFileSync(path.join(siteDir, "template.html"), "utf-8");
const css = fs.readFileSync(path.join(siteDir, "style.css"), "utf-8");
fs.writeFileSync(path.join(outDir, "style.css"), css, "utf-8");

// Markdown renderer
const md = new MarkdownIt({ html: true, linkify: true });

// Build targets
const targets = [
  {
    key: "en",
    mdFile: "cv_en.md",
    outSubdir: "", // dist/
    htmlName: "index.html",
    pdfName: "cv.pdf",
    lang: "en",
    defaultTitle: "CV - Boseung Jung",
  },
  {
    key: "ko",
    mdFile: "cv_ko.md",
    outSubdir: "ko", // dist/ko/
    htmlName: "index.html",
    pdfName: "cv_ko.pdf",
    lang: "ko",
    defaultTitle: "CV - Boseung Jung",
  },
];

let builtAny = false;

for (const t of targets) {
  const mdPath = path.join(root, t.mdFile);
  if (!fs.existsSync(mdPath)) {
    console.warn(`[skip] ${t.mdFile} not found`);
    continue;
  }
  builtAny = true;

  const mdRaw = fs.readFileSync(mdPath, "utf-8");
  const { data, content } = matter(mdRaw);

  const title = data.title ?? t.defaultTitle;
  const updated = new Date().toISOString().slice(0, 10);
  const bodyHtml = md.render(content);

  const outSubdir = path.join(outDir, t.outSubdir);
  fs.mkdirSync(outSubdir, { recursive: true });

  // dist/index.html -> base=""
  // dist/ko/index.html -> base="../"
  const base = t.outSubdir ? "../" : "";
  const rootHref = t.outSubdir ? "../" : "./";

  const html = tpl
    .replaceAll("{{lang}}", escapeHtml(t.lang))
    .replaceAll("{{title}}", escapeHtml(title))
    .replaceAll("{{updated}}", escapeHtml(updated))
    .replaceAll("{{base}}", base)
    .replaceAll("{{root}}", rootHref)
    .replaceAll("{{pdfName}}", escapeHtml(t.pdfName))
    .replace("{{content}}", bodyHtml);

  fs.writeFileSync(path.join(outSubdir, t.htmlName), html, "utf-8");

  // Copy markdown next to the page (optional)
  fs.writeFileSync(path.join(outSubdir, t.mdFile), mdRaw, "utf-8");

  console.log(`Built ${path.join("dist", t.outSubdir, t.htmlName)}`);

  if (makePdf) {
    // Keep PDFs at dist root so URLs are stable:
    // /cv.pdf and /cv_ko.pdf
    const htmlFile = path.join(outSubdir, t.htmlName);
    const pdfFile = path.join(outDir, t.pdfName);
    await renderPdf(htmlFile, pdfFile);
    console.log(`Built dist/${t.pdfName}`);
  }
}

if (!builtAny) {
  console.error("No CV markdown files found to build.");
  process.exitCode = 1;
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

  await page.pdf({
    path: pdfFile,
    format: "A4",
    printBackground: true,
    margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
  });

  await browser.close();
}
