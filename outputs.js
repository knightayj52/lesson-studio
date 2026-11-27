"use strict";
const scripts = new Map();
function library(path) {
  if (!scripts.has(path))
    scripts.set(
      path,
      new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = path;
        el.onload = resolve;
        el.onerror = () => {
          scripts.delete(path);
          reject(Error("파일 모듈을 불러오지 못했습니다. 다시 시도하세요."));
        };
        document.head.append(el);
      }),
    );
  return scripts.get(path);
}
async function readDesignFile(file) {
  let text = "";
  if (/\.pdf$/i.test(file.name)) {
    const pdf = await import("./vendor/pdf.min.mjs");
    pdf.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
    const doc = await pdf.getDocument({
      data: await file.arrayBuffer(),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    try {
      if (doc.numPages > 160) throw Error("160쪽 이하의 설계서를 선택하세요.");
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const data = await page.getTextContent();
        text +=
          data.items
            .map((x) => (x.str || "") + (x.hasEOL ? "\n" : " "))
            .join("") + "\n";
        page.cleanup();
      }
    } finally {
      await doc.destroy();
    }
  } else if (/\.docx$/i.test(file.name)) {
    await library("vendor/jszip.min.js");
    const zip = await JSZip.loadAsync(file),
      part = zip.file("word/document.xml");
    if (!part || part._data.uncompressedSize > 15000000)
      throw Error("문서 크기 또는 DOCX 형식을 확인하세요.");
    const xml = new DOMParser().parseFromString(
      await part.async("string"),
      "application/xml",
    );
    if (xml.querySelector("parsererror"))
      throw Error("DOCX 본문을 읽을 수 없습니다.");
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    text = Array.from(xml.getElementsByTagNameNS(ns, "p"), (p) =>
      Array.from(p.getElementsByTagNameNS(ns, "t"), (t) => t.textContent).join(
        "",
      ),
    ).join("\n");
  } else if (/\.(txt|md|json)$/i.test(file.name)) text = await file.text();
  else throw Error("지원하는 파일 형식을 선택하세요.");
  if (!text.trim())
    throw Error("추출할 텍스트가 없습니다. 스캔 PDF는 OCR 후 가져오세요.");
  return text.trim();
}
async function powerpoint(cards, title) {
  await library("vendor/jszip.min.js");
  await library("vendor/pptxgen.min.js");
  const ppt = new PptxGenJS();
  ppt.layout = "LAYOUT_WIDE";
  ppt.author = "영쌤클래스";
  ppt.title = title;
  const fontFace = "맑은 고딕";
  for (const [i, c] of cards.entries()) {
    const slide = ppt.addSlide();
    slide.background = { color: "F5F4EC" };
    const add = (txt, y, h, size, color, bold = false) =>
      slide.addText(txt, {
        x: 0.8,
        y,
        w: 11.7,
        h,
        fontSize: size,
        fontFace,
        color,
        bold,
        margin: 0,
        fit: "shrink",
        valign: "mid",
        breakLine: false,
      });
    add("LESSON STUDIO   /   " + title, 0.4, 0.45, 16, "38675A");
    add(c.title, 1.05, 1.2, 34, "183F36", true);
    add(c.body.join("\n\n"), 2.55, 3.9, 25, "263B36");
    add(String(i + 1).padStart(2, "0"), 6.9, 0.3, 12, "38675A");
    slide.addNotes(c.notes);
  }
  return ppt.write({ outputType: "blob" });
}
const xmlEscape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
async function wordFile(cards, title) {
  await library("vendor/jszip.min.js");
  const zip = new JSZip();
  const rel = "http://schemas.openxmlformats.org/package/2006/relationships",
    office =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="' +
      rel +
      '"><Relationship Id="rId1" Type="' +
      office +
      '/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const para = (s, size, bold) =>
    '<w:p><w:pPr><w:spacing w:after="140"/></w:pPr><w:r><w:rPr><w:rFonts w:eastAsia="맑은 고딕"/>' +
    (bold ? "<w:b/>" : "") +
    '<w:sz w:val="' +
    size +
    '"/></w:rPr><w:t xml:space="preserve">' +
    xmlEscape(s) +
    "</w:t></w:r></w:p>";
  const body = [
    para(title, 38, true),
    ...cards.flatMap((c) => [
      para(c.title, 28, true),
      ...c.body.flatMap((s) =>
        s.split("\n").map((line) => para(line, 23, false)),
      ),
    ]),
  ];
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:bottom="1080" w:left="1080" w:right="1080"/></w:sectPr></w:body></w:document>',
  );
  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
function raster(cards, title, kind) {
  const c = document.createElement("canvas");
  c.width = 1200;
  let ctx = c.getContext("2d"),
    y = 55;
  const lines = [];
  function write(s, size, bold = false) {
    const font = (bold ? "bold " : "") + size + "px sans-serif";
    ctx.font = font;
    let line = "";
    for (const ch of String(s)) {
      if (ch === "\n" || (line && ctx.measureText(line + ch).width > 1080)) {
        lines.push({ line, font, y });
        y += size * 1.55;
        line = "";
      }
      if (ch !== "\n") line += ch;
    }
    lines.push({ line, font, y });
    y += size * 1.55;
  }
  write("영쌤클래스   /   LESSON STUDIO", 22, true);
  write(title, 36, true);
  for (const card of cards) {
    y += 25;
    write(card.title, 30, true);
    for (const s of card.body) write(s, 24);
  }
  if (y > 16000) throw Error("긴 자료는 DOCX 또는 PDF로 출력하세요.");
  c.height = Math.ceil(y + 50);
  ctx = c.getContext("2d");
  ctx.fillStyle = kind === 3 ? "#23463b" : "#fffdf6";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = kind === 3 ? "#fffade" : "#1c4136";
  for (const l of lines) {
    ctx.font = l.font;
    ctx.fillText(l.line, 60, l.y);
  }
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(Error("PNG 생성 실패")))),
  );
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = node("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function driveArtifact(blob, name) {
  const metadata = {
    name,
    parents: [root],
    appProperties: { lessonStudioMaterial: "1", project: fileId },
    mimeType: blob.type,
  };
  const boundary = "lessonstudio" + crypto.randomUUID();
  const mime = name.endsWith(".pptx")
    ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    : blob.type || "application/octet-stream";
  metadata.mimeType = mime;
  const body = new Blob([
    "--" +
      boundary +
      "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    "\r\n--" + boundary + "\r\nContent-Type: " + mime + "\r\n\r\n",
    blob,
    "\r\n--" + boundary + "--",
  ]);
  return api("/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "multipart/related; boundary=" + boundary },
    body,
  });
}
async function pdfFile(cards, title, kind) {
  await Promise.all([
    library("vendor/pdf-lib.min.js"),
    library("vendor/fontkit.min.js"),
    library("vendor/jszip.min.js"),
  ]);
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  const response = await fetch("vendor/lesson-sans.zip");
  if (!response.ok) throw Error("PDF 한글 글꼴을 불러올 수 없습니다.");
  const fonts = await JSZip.loadAsync(await response.arrayBuffer());
  const font = await doc.embedFont(
    await fonts.file("lesson-sans.ttf").async("uint8array"),
    {
      subset: false,
    },
  );
  doc.setTitle(title);
  doc.setAuthor("영쌤클래스");
  const slide = kind === 0,
    board = kind === 3;
  const [w, h] = slide || board ? [864, 486] : [595.28, 841.89];
  const { rgb } = PDFLib,
    ink = board ? rgb(0.98, 0.98, 0.91) : rgb(0.09, 0.18, 0.15),
    accent = board ? rgb(1, 0.84, 0.58) : rgb(0.14, 0.36, 0.28);
  const paper = board ? rgb(0.13, 0.26, 0.21) : rgb(0.995, 0.993, 0.97);
  const supported = new Set(font.getCharacterSet());
  const printable = (s) =>
    [...s].every((c) => c === "\n" || supported.has(c.codePointAt(0)));
  if (
    ![title, ...cards.flatMap((c) => [c.title, ...c.body])].every(printable)
  ) {
    for (const c of cards) {
      const page = doc.addPage([w, h]),
        img = await doc.embedPng(
          await (await raster([c], title, kind)).arrayBuffer(),
        ),
        scale = Math.min((w - 68) / img.width, (h - 72) / img.height);
      page.drawImage(img, {
        x: 34,
        y: h - 36 - img.height * scale,
        width: img.width * scale,
        height: img.height * scale,
      });
    }
    return new Blob([await doc.save()], { type: "application/pdf" });
  }
  let page, y;
  function wrap(text, maxWidth, size) {
    const lines = [];
    let line = "";
    for (const ch of text) {
      if (
        ch === "\n" ||
        (line && font.widthOfTextAtSize(line + ch, size) > maxWidth)
      ) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (ch !== "\n") line += ch;
    }
    lines.push(line.trimEnd());
    return lines;
  }
  function nextPage() {
    page = doc.addPage([w, h]);
    page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: paper });
    page.drawText("영쌤클래스   /   LESSON STUDIO", {
      x: 36,
      y: h - 35,
      font,
      size: 10,
      color: accent,
    });
    page.drawText(String(doc.getPageCount()), {
      x: w - 45,
      y: 24,
      font,
      size: 10,
      color: accent,
    });
    y = h - 69;
    for (const line of wrap(title, w - 72, 17)) {
      page.drawText(line, { x: 36, y, font, size: 17, color: ink });
      y -= 24;
    }
    y -= 10;
  }
  function paragraph(text, size, color = ink) {
    for (const line of wrap(text, w - 80, size)) {
      if (y < size * 1.7 + 34) nextPage();
      page.drawText(line, { x: 38, y, font, size, color });
      y -= size * 1.65;
    }
    y -= 4;
  }
  for (const c of cards) {
    if (!page || slide || board || y < 140) nextPage();
    page.drawLine({
      start: { x: 36, y },
      end: { x: w - 36, y },
      color: accent,
      thickness: 0.6,
    });
    y -= 27;
    paragraph(c.title, slide ? 22 : 15, accent);
    for (const s of c.body) paragraph(s, slide ? 19 : 12);
    if (kind === 2) {
      for (let i = 0; i < 2; i++) {
        if (y < 60) nextPage();
        page.drawLine({
          start: { x: 40, y },
          end: { x: w - 40, y },
          color: rgb(0.76, 0.81, 0.77),
          thickness: 0.5,
        });
        y -= 23;
      }
    }
    y -= 15;
  }
  return new Blob([await doc.save()], { type: "application/pdf" });
}

async function lessonPackage(wholeUnit = false) {
  const project = structuredClone(snapshot());
  const indices = wholeUnit
    ? project.lessons.map((_, i) => i)
    : [selectedLesson];
  if (!indices.length) throw Error("차시를 먼저 추가하세요.");
  const overview = indices.map((index) => {
    try {
      const { d, duration, p } = context(5, index, project);
      return {
        title:
          index + 1 + "차시 · " + (project.lessons[index].title || "제목 없음"),
        body: [
          duration + "분 · " + d.goal,
          "탐구 질문　" + d.question,
          "성공기준　" + d.success,
          ...p.sources
            .filter((s) => s.kind === "전체")
            .map(
              (s) =>
                s.record["성취기준 코드"] +
                " · " +
                (evidenceStages(project.lessons[index], s)
                  .map((i) => activityLabel(index, i))
                  .join(", ") || "활동 증거 미지정"),
            ),
        ],
      };
    } catch (error) {
      throw Error(index + 1 + "차시 · " + error.message);
    }
  });
  await library("vendor/jszip.min.js");
  const files = new JSZip();
  const formats = ["pptx", "docx", "pdf", "png", "png", "docx"];
  if (wholeUnit) {
    const guide = await wordFile(
      overview,
      (project.title || "단원") + " · 차시별 수업 및 평가 안내",
    );
    files.file("단원 안내.docx", await guide.arrayBuffer());
  }
  for (const index of indices) {
    const folder = wholeUnit
      ? files.folder(String(index + 1).padStart(3, "0") + "차시")
      : files;
    for (const [kind, extension] of formats.entries()) {
      const { title, cards } = context(kind, index, project);
      outStatus(
        index + 1 + "차시 · " + kinds[kind] + " 제작 중 · " + (kind + 1) + "/6",
      );
      let blob;
      switch (extension) {
        case "pptx":
          blob = await powerpoint(cards, title);
          break;
        case "pdf":
          blob = await pdfFile(cards, title, kind);
          break;
        case "png":
          blob = await raster(cards, title, kind);
          break;
        default:
          blob = await wordFile(cards, title);
      }
      const group = [0, 2, 4].includes(kind) ? "교실용" : "교사용";
      folder.file(
        group + "/" + kinds[kind] + "." + extension,
        await blob.arrayBuffer(),
      );
    }
  }
  return files.generateAsync({ type: "blob", mimeType: "application/zip" });
}
