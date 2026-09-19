import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import matter from "gray-matter";
// Allow the desktop's bundled renderer without changing project dependencies.
const { chromium } = await import(process.env.CV_PLAYWRIGHT_MODULE || "playwright");

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
    defaultTitle: "CV - Boseung Jung",
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
    // Keep each role heading with its description when printing.
    bodyHtml = bodyHtml.replace(
      /(<p>(?:(?!<\/p>)[\s\S])*<\/p>)\s*(<ul>[\s\S]*?<\/ul>)/g,
      '<div class="cv-entry">$1$2</div>',
    );
    bodyHtml = transformPipes(bodyHtml);
    bodyHtml = bodyHtml.replace(/<hr\s*\/?>/gi, "");
    bodyHtml = wrapSections(bodyHtml, data.print_page_break_before);

    // [수정 1] CSS는 각 출력 폴더에 함께 복사하므로 항상 같은 폴더를 참조
    const base = "./";

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
    fs.writeFileSync(path.join(outSubdirPath, "style.css"), css, "utf-8");
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

function wrapSections(html, printPageBreakBefore) {
  const [intro, ...sections] = html.split(/(?=<h2>)/);
  return intro + sections.map((section) => {
    const heading = section.match(/^<h2>([\s\S]*?)<\/h2>/)?.[1];
    const className = heading === printPageBreakBefore
      ? "cv-section print-break"
      : "cv-section";
    return `<section class="${className}">${section}</section>`;
  }).join("\n");
}

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
  const browser = await chromium.launch({ channel: process.env.CV_CHROME_CHANNEL });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 1024 });
    const fileUrl = "file://" + path.resolve(htmlFile);
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: pdfFile,
      format: "A4",
      printBackground: true,
      tagged: true,
      outline: true,
      scale: 1,
      margin: { top: "14mm", bottom: "17mm", left: "17mm", right: "17mm" },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: '<div style="font-family:Arial,sans-serif;font-size:10px;color:#69727a;width:100%;padding:0 17mm;display:flex;justify-content:space-between;"><span>Boseung Jung | Curriculum Vitae</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
    });
  } finally {
    await browser.close();
  }
}
