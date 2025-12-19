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

const tpl = fs.readFileSync(path.join(siteDir, "template.html"), "utf-8");
const css = fs.readFileSync(path.join(siteDir, "style.css"), "utf-8");
fs.writeFileSync(path.join(outDir, "style.css"), css, "utf-8");

const md = new MarkdownIt({ html: true, linkify: true, breaks: true });

const targets = [
  {
    key: "en",
    mdFile: "cv_en.md",
    outSubdir: "",
    htmlName: "index.html",
    pdfName: "cv.pdf",
    lang: "en",
    defaultTitle: "CV - Boseung Jung",
  },
  {
    key: "ko",
    mdFile: "cv_ko.md",
    outSubdir: "ko",
    htmlName: "index.html",
    pdfName: "cv_ko.pdf",
    lang: "ko",
    defaultTitle: "이력서 - 정보승",
  },
];

let builtAny = false;

(async () => {
  for (const t of targets) {
    const mdPath = path.join(root, t.mdFile);
    if (!fs.existsSync(mdPath)) {
      console.warn(`[Skip] ${t.mdFile} not found.`);
      continue;
    }
    builtAny = true;

    const mdRaw = fs.readFileSync(mdPath, "utf-8");
    const { data, content } = matter(mdRaw);
    const title = data.title ?? t.defaultTitle;

    const mdStat = fs.statSync(mdPath);
    const updatedStr = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "Asia/Seoul",
    }).format(mdStat.mtime);

    let bodyHtml = md.render(content);
    bodyHtml = transformPipes(bodyHtml);
    bodyHtml = bodyHtml.replace(/<hr\s*\/?>/gi, "");

    // [수정 1] CSS/JS용 base 경로 (CSS는 항상 루트에 있으므로)
    // EN(루트)일 때는 "./", KO(하위)일 때는 "../"
    const base = t.outSubdir ? "../" : "./";

    // [수정 2] 언어 전환 링크를 위한 명확한 상대 경로 계산
    let link_en, link_ko;

    if (t.key === "en") {
      // 현재 위치: dist/index.html
      link_en = "./index.html"; // 영어 (현재 페이지)
      link_ko = "./ko/index.html"; // 한국어 (하위 폴더로)
    } else {
      // 현재 위치: dist/ko/index.html
      link_en = "../index.html"; // 영어 (상위 폴더로)
      link_ko = "./index.html"; // 한국어 (현재 페이지)
    }

    const html = tpl
      .replaceAll("{{lang}}", t.lang)
      .replaceAll("{{title}}", title)
      .replaceAll("{{base}}", base)
      // root 대신 명확한 링크 변수 사용
      .replaceAll("{{link_en}}", link_en)
      .replaceAll("{{link_ko}}", link_ko)
      .replaceAll("{{pdfName}}", t.pdfName)
      .replaceAll("{{updated}}", updatedStr)
      .replace("{{content}}", bodyHtml);

    const outSubdirPath = path.join(outDir, t.outSubdir);
    fs.mkdirSync(outSubdirPath, { recursive: true });
    const htmlOutPath = path.join(outSubdirPath, t.htmlName);

    fs.writeFileSync(htmlOutPath, html, "utf-8");
    console.log(`[Built] HTML generated at ${htmlOutPath}`);

    if (makePdf) {
      const pdfPath = path.join(outSubdirPath, t.pdfName);
      await renderPdf(htmlOutPath, pdfPath);
      console.log(`[Built] PDF generated at ${pdfPath}`);
    }
  }

  if (!builtAny) {
    console.error("No markdown files found.");
  }
})();

// ... transformPipes 및 renderPdf 함수는 그대로 유지 ...
function transformPipes(html) {
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (match, innerContent) => {
    const lines = innerContent.split(/<br\s*\/?>/i);
    const processedLines = lines.map((line) => {
      const trimmed = line.trim();
      const pipeMatch = trimmed.match(/^([\s\S]*?)\s*[|｜│]\s*([\s\S]*?)$/);
      if (pipeMatch) {
        return `<div class="split-row">
                  <span class="left">${pipeMatch[1].trim()}</span>
                  <span class="right">${pipeMatch[2].trim()}</span>
                </div>`;
      } else {
        if (!trimmed) return "";
        return `<div class="plain-row">${trimmed}</div>`;
      }
    });
    return `<div class="entry-group">\n${processedLines.join("\n")}\n</div>`;
  });
}

async function renderPdf(htmlFile, pdfFile) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 1024 });
  const fileUrl = "file://" + path.resolve(htmlFile);
  await page.goto(fileUrl, { waitUntil: "networkidle" });
  await page.pdf({
    path: pdfFile,
    format: "A4",
    printBackground: true,
    scale: 0.95,
    margin: { top: "12mm", bottom: "12mm", left: "15mm", right: "15mm" },
  });
  await browser.close();
}
