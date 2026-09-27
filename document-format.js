"use strict";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw Error("Unsupported XML");
  return new (require("@xmldom/xmldom").DOMParser)().parseFromString(
    text,
    "application/xml",
  );
}
const nodes = (n, tag) => Array.from(n.getElementsByTagNameNS(W, tag));
const val = (node, tag, attr = "val") =>
  nodes(node, tag)[0]?.getAttributeNS(W, attr) || "";
function visibleColor(value) {
  return (
    !!value && !["auto", "000000", "FFFFFF", "ffffff", "none"].includes(value)
  );
}
function formattingFlags(text, characters) {
  // Ignore an unstyled A) prefix: even a one-digit answer can be bold.
  const prefix =
    text.replace(/\s/g, "").match(/^(?:[A-Fa-f][.)]|\([A-Fa-f]\))/)?.[0]
      .length || 0;
  const answer = characters.slice(prefix);
  return ["bold", "color", "highlight"].filter(
    (kind) =>
      answer.length &&
      answer.filter((format) => format[kind]).length / answer.length > 0.6,
  );
}
async function docxText(buffer) {
  const zip = await require("jszip").loadAsync(buffer);
  const document = xml(await zip.file("word/document.xml").async("string"));
  const numbering = zip.file("word/numbering.xml")
    ? xml(await zip.file("word/numbering.xml").async("string"))
    : null;
  const definitions = {},
    ids = {},
    counts = {};
  if (numbering) {
    for (const n of nodes(numbering, "abstractNum")) {
      const id = n.getAttributeNS(W, "abstractNumId");
      definitions[id] = {};
      for (const level of nodes(n, "lvl"))
        definitions[id][level.getAttributeNS(W, "ilvl")] = {
          format: val(level, "numFmt"),
          start: Number(val(level, "start") || 1),
        };
    }
    for (const n of nodes(numbering, "num"))
      ids[n.getAttributeNS(W, "numId")] = val(n, "abstractNumId");
  }
  const styles = {};
  if (zip.file("word/styles.xml")) {
    const doc = xml(await zip.file("word/styles.xml").async("string"));
    for (const style of nodes(doc, "style"))
      styles[style.getAttributeNS(W, "styleId")] = style;
  }
  const props = (node) => {
    if (!node) return {};
    const result = {};
    const b = nodes(node, "b")[0];
    if (b)
      result.bold = !["0", "false", "off"].includes(b.getAttributeNS(W, "val"));
    if (nodes(node, "color").length)
      result.color = visibleColor(val(node, "color"));
    if (nodes(node, "highlight").length || nodes(node, "shd").length)
      result.highlight =
        visibleColor(val(node, "highlight")) ||
        visibleColor(val(node, "shd", "fill"));
    return result;
  };
  const styleProps = (id, depth = 0) =>
    !styles[id] || depth > 10
      ? {}
      : {
          ...styleProps(val(styles[id], "basedOn"), depth + 1),
          ...props(styles[id]),
        };
  const paragraphs = [];
  for (const paragraph of nodes(document, "p")) {
    let text = "";
    const characters = [];
    for (const run of nodes(paragraph, "r")) {
      let part = nodes(run, "t")
        .map((t) => t.textContent)
        .join("");
      for (const sym of nodes(run, "sym"))
        if (["F0FC", "F0FE"].includes(sym.getAttributeNS(W, "char")))
          part += " ✓";
      if (nodes(run, "br").length) part += "\n";
      if (nodes(run, "tab").length) part += " ";
      text += part;
      const format = {
        ...styleProps(val(paragraph, "pStyle")),
        ...styleProps(val(run, "rStyle")),
        ...props(run),
      };
      for (const character of part.replace(/\s/g, "")) characters.push(format);
    }
    const flags = formattingFlags(text, characters);
    const numPr = nodes(paragraph, "numPr")[0];
    if (numPr) {
      const id = val(numPr, "numId"),
        level = val(numPr, "ilvl") || "0",
        spec = definitions[ids[id]]?.[level];
      if (spec) {
        const key = id + ":" + level;
        counts[key] = (counts[key] ?? spec.start - 1) + 1;
        const n = counts[key];
        if (spec.format === "decimal") text = n + ". " + text;
        else if (/Letter/.test(spec.format))
          text = String.fromCharCode(65 + ((n - 1) % 26)) + ") " + text;
      }
    }
    paragraphs.push(
      (flags.length ? "[[fmt:" + flags.join(",") + "]] " : "") + text,
    );
  }
  return paragraphs.join("\n");
}
async function pdfPageText(page, pdfjs) {
  const content = await page.getTextContent();
  const ops = await page.getOperatorList();
  const annotations = await page.getAnnotations();
  let current = { bold: false, color: false },
    stack = [],
    stream = "",
    styles = [];
  const colored = (args) => {
    if (typeof args?.[0] === "string")
      return !["#000000", "#ffffff"].includes(args[0].toLowerCase());
    const a = Array.from(args?.[0]?.length ? args[0] : args || []);
    return a.length >= 3 && Math.max(...a) - Math.min(...a) > 0.05;
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const op = ops.fnArray[i],
      args = ops.argsArray[i];
    if (op === pdfjs.OPS.save) stack.push({ ...current });
    if (op === pdfjs.OPS.restore)
      current = stack.pop() || { bold: false, color: false };
    if (op === pdfjs.OPS.setFont) {
      try {
        const f = page.commonObjs.get(args[0]);
        current.bold = !!f.bold || /bold|black|semibold/i.test(f.name || "");
      } catch {
        current.bold = false;
      }
    }
    if (op === pdfjs.OPS.setFillRGBColor || op === pdfjs.OPS.setFillColor)
      current.color = colored(args);
    if (op === pdfjs.OPS.setFillGray) current.color = false;
    if (op === pdfjs.OPS.showText || op === pdfjs.OPS.showSpacedText) {
      for (const glyph of args[0] || []) {
        if (!glyph?.unicode) continue;
        for (const c of glyph.unicode.replace(/\s/g, "")) {
          stream += c;
          styles.push({ ...current });
        }
      }
    }
  }
  let cursor = 0,
    lines = [],
    line = { text: "", formats: [] },
    y = null;
  const flush = () => {
    if (line.text.trim()) {
      const flags = formattingFlags(line.text, line.formats);
      lines.push(
        (flags.length ? "[[fmt:" + flags.join(",") + "]] " : "") +
          line.text.trim(),
      );
    }
    line = { text: "", formats: [] };
  };
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    const nextY = item.transform?.[5];
    if (y !== null && Math.abs(nextY - y) > 3) flush();
    const stripped = item.str.replace(/\s/g, ""),
      pos = stream.indexOf(stripped, cursor);
    line.text += item.str + " ";
    const itemStyles =
      stripped && pos >= 0 && pos - cursor < 50
        ? styles.slice(pos, pos + stripped.length)
        : Array.from(stripped, () => ({}));
    if (stripped && pos >= 0 && pos - cursor < 50)
      cursor = pos + stripped.length;
    const x = item.transform[4],
      height = Math.abs(item.height || item.transform[3]);
    const highlighted = annotations.some(
      (a) =>
        a.subtype === "Highlight" &&
        a.rect &&
        x + item.width > a.rect[0] &&
        x < a.rect[2] &&
        nextY + height > a.rect[1] &&
        nextY < a.rect[3],
    );
    line.formats.push(
      ...itemStyles.map((style) => ({ ...style, highlight: highlighted })),
    );
    y = nextY;
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join("\n");
}
module.exports = { docxText, pdfPageText };
