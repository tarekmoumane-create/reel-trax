// Download the on-screen invoice as a PDF — no print dialog.
//
// The sheet is drawn by the browser itself (html-to-image renders the DOM
// through an SVG foreignObject), so the PDF looks exactly like the page. It's
// rendered once, cut into US Letter pages at row and section edges, and every
// link on the sheet stays clickable.
//
// Both libraries are only loaded when someone actually clicks Download.

import type { jsPDF } from "jspdf";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN_TOP = 36; // continuation pages only; page 1 has the sheet's own padding
const MARGIN_BOTTOM = 36;
const PIXEL_RATIO = 2;

interface Block {
  top: number;
  bottom: number;
}

/** Page slices [start, end) in CSS px from the sheet's top, never splitting a row or a keep-together block that fits on a page. */
function paginate(sheet: HTMLElement, usableFirst: number, usableRest: number): Block[] {
  const origin = sheet.getBoundingClientRect().top;
  const total = sheet.scrollHeight;
  const rel = (el: Element): Block => {
    const r = el.getBoundingClientRect();
    return { top: r.top - origin, bottom: r.bottom - origin };
  };

  const rows = [...sheet.querySelectorAll("tr")].map(rel);
  const keep = [...sheet.querySelectorAll(".invoice-avoid-break")].map(rel);
  // Safe places to cut: under any row, or just above / below a keep-together block.
  const cuts = [...new Set([...rows.map((r) => r.bottom), ...keep.flatMap((b) => [b.top, b.bottom]), total])]
    .map((y) => Math.round(y))
    .sort((a, b) => a - b);

  const pages: Block[] = [];
  let start = 0;
  while (start < total - 1) {
    const usable = pages.length === 0 ? usableFirst : usableRest;
    const limit = start + usable;
    if (limit >= total) {
      pages.push({ top: start, bottom: total });
      break;
    }
    const fits = (y: number) =>
      y > start + 1 &&
      y <= limit &&
      // Don't land inside a block that could have gone onto one page whole.
      !keep.some((b) => b.top < y - 1 && y + 1 < b.bottom && b.bottom - b.top <= usableRest);
    const best = [...cuts].reverse().find(fits);
    const end = best ?? limit; // nothing clean fits (e.g. one enormous row): hard cut
    pages.push({ top: start, bottom: end });
    start = end;
  }
  return pages;
}

/** Does a @font-face unicode-range cover any of these code points? Empty range = everything. */
function rangeCovers(range: string, codePoints: Set<number>): boolean {
  if (!range.trim()) return true;
  return range.split(",").some((part) => {
    const m = part.trim().replace(/^U\+/i, "").split("-");
    const lo = parseInt(m[0].replace(/\?/g, "0"), 16);
    const hi = m[1] ? parseInt(m[1], 16) : parseInt(m[0].replace(/\?/g, "F"), 16);
    for (const cp of codePoints) if (cp >= lo && cp <= hi) return true;
    return false;
  });
}

const clean = (family: string) => family.trim().replace(/^["']|["']$/g, "");

/**
 * The @font-face CSS the sheet needs, with font files inlined. The page loads
 * dozens of font files (every weight and alphabet of two families); embedding
 * all of them into the render is what froze the browser. This keeps only the
 * families the sheet uses and only the alphabets its text contains.
 */
async function sheetFontCSS(sheet: HTMLElement): Promise<string> {
  const families = new Set<string>();
  for (const el of [sheet, ...sheet.querySelectorAll("*")]) {
    families.add(clean(getComputedStyle(el).fontFamily.split(",")[0]));
  }
  const codePoints = new Set<number>();
  for (const ch of sheet.innerText) codePoints.add(ch.codePointAt(0)!);

  const blocks: string[] = [];
  for (const sheetList of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheetList.cssRules;
    } catch {
      continue; // cross-origin stylesheet
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      if (!families.has(clean(rule.style.getPropertyValue("font-family")))) continue;
      if (!rangeCovers(rule.style.getPropertyValue("unicode-range"), codePoints)) continue;
      const src = rule.style.getPropertyValue("src");
      const url = src.match(/url\((["']?)([^"')]+)\1\)/)?.[2];
      if (!url) continue; // local() fallbacks
      const abs = new URL(url, sheetList.href ?? location.href).href;
      const buf = await fetch(abs).then((r) => r.arrayBuffer());
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const format = /woff2/.test(abs) ? "woff2" : /woff/.test(abs) ? "woff" : "truetype";
      blocks.push(rule.cssText.replace(src, `url(data:font/${format};base64,${btoa(bin)}) format("${format}")`));
    }
  }
  return blocks.join("\n");
}

// The style properties copied onto each element of the render. html-to-image
// copies every computed property by default (350+ in Chrome), which turns a
// long invoice into a multi-megabyte-per-row SVG and froze the tab for over a
// minute; these are the ones an invoice sheet actually uses (~160ms instead).
const STYLE_PROPS = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "float", "clear", "box-sizing",
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "border-collapse", "border-spacing", "table-layout", "vertical-align", "text-align",
  "color", "background-color", "background-image",
  "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric", "line-height", "letter-spacing",
  "white-space", "word-break", "overflow-wrap", "overflow", "overflow-x", "overflow-y", "text-overflow",
  "text-decoration-line", "text-decoration-color", "text-decoration-style", "text-decoration-thickness", "text-underline-offset",
  "text-transform", "opacity", "visibility",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "justify-content", "align-items", "align-self",
  "row-gap", "column-gap", "grid-template-columns", "grid-template-rows", "grid-column-start", "grid-column-end", "order",
  "transform", "transform-origin", "list-style-type", "content", "-webkit-font-smoothing",
];

// Browsers refuse canvases past ~32,767px on a side or ~268M pixels; stay well under.
const MAX_CANVAS_SIDE = 30000;
const MAX_CANVAS_AREA = 160_000_000;

/** Build the PDF for an invoice sheet without saving it (the download button saves; a preview can show it). */
export async function buildInvoicePdf(sheet: HTMLElement): Promise<jsPDF> {
  const [{ toSvg }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);

  const width = sheet.offsetWidth;
  const total = sheet.scrollHeight;
  const scale = PAGE_W / width; // points per CSS px
  const pages = paginate(sheet, (PAGE_H - MARGIN_BOTTOM) / scale, (PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / scale);

  // Render the whole sheet once, then cut pages out of that image. A very long
  // invoice renders at lower resolution rather than exceeding canvas limits.
  //
  // Only html-to-image's SVG step is used: its toCanvas waits for an animation
  // frame before drawing, and a tab that isn't on screen never gets one, so
  // the export would hang forever in a background tab. Loading and drawing the
  // SVG here has no such wait.
  const svg = await toSvg(sheet, {
    includeStyleProperties: STYLE_PROPS,
    fontEmbedCSS: await sheetFontCSS(sheet),
    width,
    height: total,
    style: { margin: "0", boxShadow: "none" },
  });
  const img = new Image();
  img.src = svg;
  await img.decode();
  const ratio = Math.min(PIXEL_RATIO, MAX_CANVAS_SIDE / total, Math.sqrt(MAX_CANVAS_AREA / (width * total)));
  const full = document.createElement("canvas");
  full.width = Math.round(width * ratio);
  full.height = Math.round(total * ratio);
  const fullCtx = full.getContext("2d")!;
  fullCtx.fillStyle = "#ffffff";
  fullCtx.fillRect(0, 0, full.width, full.height);
  fullCtx.drawImage(img, 0, 0, full.width, full.height);
  const px = full.width / width; // device px per CSS px

  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait", compress: true });
  const slice = document.createElement("canvas");
  const ctx = slice.getContext("2d")!;
  for (let i = 0; i < pages.length; i++) {
    const { top, bottom } = pages[i];
    const height = bottom - top;
    slice.width = full.width;
    slice.height = Math.max(1, Math.round(height * px));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(full, 0, Math.round(top * px), full.width, slice.height, 0, 0, slice.width, slice.height);
    if (i > 0) pdf.addPage("letter", "portrait");
    pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, i === 0 ? 0 : MARGIN_TOP, PAGE_W, height * scale, undefined, "FAST");
    await new Promise((r) => setTimeout(r)); // let the page breathe between pages
  }

  // Clickable links, placed over wherever each one landed.
  const origin = sheet.getBoundingClientRect();
  for (const a of sheet.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    const r = a.getBoundingClientRect();
    const top = r.top - origin.top;
    const page = pages.findIndex((p) => top >= p.top && top < p.bottom);
    if (page < 0) continue;
    pdf.setPage(page + 1);
    const y = (page === 0 ? 0 : MARGIN_TOP) + (top - pages[page].top) * scale;
    pdf.link((r.left - origin.left) * scale, y, r.width * scale, r.height * scale, { url: a.href });
  }

  return pdf;
}

export async function downloadInvoicePdf(sheet: HTMLElement, filename: string): Promise<void> {
  (await buildInvoicePdf(sheet)).save(filename);
}
