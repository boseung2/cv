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

// 줄바꿈(breaks: true) 옵션 사용
const md = new MarkdownIt({ html: true, linkify: true, breaks: true });

// [수정] 빌드 타겟에 한국어(ko) 추가
const targets = [
  {
    key: "en",
    mdFile: "cv_en.md",
    outSubdir: "", // dist/ 바로 아래
    htmlName: "index.html",
    pdfName: "cv.pdf",
    lang: "en",
    defaultTitle: "CV - Boseung Jung",
  },
  {
    key: "ko",
    mdFile: "cv_ko.md",
    outSubdir: "ko", // dist/ko/ 아래
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

    // Last updated: markdown file mtime
    const mdStat = fs.statSync(mdPath);
    const updatedStr = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(mdStat.mtime);

    let bodyHtml = md.render(content);

    // 파이프 변환 실행
    bodyHtml = transformPipes(bodyHtml);
    bodyHtml = bodyHtml.replace(/<hr\s*\/?>/gi, "");

    // [중요] base 경로 설정 (ko 폴더 내부에서는 상위 폴더의 css를 참조해야 함)
    const base = t.outSubdir ? "../" : "";

    // 템플릿 치환
    const html = tpl
      .replaceAll("{{lang}}", t.lang)
      .replaceAll("{{title}}", title)
      .replaceAll("{{base}}", base)
      .replaceAll("{{root}}", base) // root 경로도 base와 동일하게 처리
      .replaceAll("{{pdfName}}", t.pdfName)
      .replaceAll("{{updated}}", updatedStr)
      .replace("{{content}}", bodyHtml);

    // HTML 저장 경로 설정
    const outSubdirPath = path.join(outDir, t.outSubdir);
    fs.mkdirSync(outSubdirPath, { recursive: true });

    const htmlOutPath = path.join(outSubdirPath, t.htmlName);
    fs.writeFileSync(htmlOutPath, html, "utf-8");
    console.log(`[Built] HTML generated at ${htmlOutPath}`);

    if (makePdf) {
      // [수정] PDF도 HTML과 같은 폴더에 저장 (링크 연결을 위해)
      const pdfPath = path.join(outSubdirPath, t.pdfName);

      await renderPdf(htmlOutPath, pdfPath);
      console.log(`[Built] PDF generated at ${pdfPath}`);
    }
  }

  if (!builtAny) {
    console.error("No markdown files found.");
  }
})();

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

  // 뷰포트 설정
  await page.setViewportSize({ width: 1280, height: 1024 });

  const fileUrl = "file://" + path.resolve(htmlFile);
  await page.goto(fileUrl, { waitUntil: "networkidle" });

  await page.pdf({
    path: pdfFile,
    format: "A4",
    printBackground: true,
    scale: 0.95, // 오른쪽 잘림 방지
    margin: {
      top: "12mm",
      bottom: "12mm",
      left: "15mm",
      right: "15mm",
    },
  });

  await browser.close();
}
