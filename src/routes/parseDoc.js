import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { saveImageBuffer } from "../lib/uploads.js";
import { requireAdminAuth } from "../lib/adminAuth.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ─── helpers ────────────────────────────────────────────────────────────────

function normalizeTitle(title) {
  if (!title) return title;
  const letters = title.replace(/[^a-zA-Z]/g, "");
  if (!letters) return title;
  const upperRatio = title.replace(/[^A-Z]/g, "").length / letters.length;
  if (upperRatio > 0.5 || /^[a-z]/.test(title))
    return title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return title;
}

// bullet character paragraphs → <li> lists
function fixManualBullets(html) {
  let result = html.replace(
    /<p>[\s\t]*[•‣◦⁃∙•·❖]\t?\s*([\s\S]*?)<\/p>/g,
    "<li>$1</li>"
  );
  result = result.replace(
    /(<li>[\s\S]*?<\/li>[\s\n]*)+/g,
    (match) => `<ul>${match}</ul>`
  );
  return result;
}

// <p><strong>short text</strong></p> → <h2>
function convertBoldHeadings(html) {
  return html.replace(
    /<p>\s*<strong>([\s\S]{3,120}?)<\/strong>\s*<\/p>/g,
    "<h2>$1</h2>"
  );
}

// ALL-CAPS short paragraphs → <h2>
function convertAllCapsParas(html) {
  return html.replace(
    /<p>([A-Z][A-Z\s\(\)\-\/:&,\.]{8,100})<\/p>/g,
    (_, text) => {
      const titleCased = text.replace(
        /\b\w+/g,
        (w) => w.charAt(0) + w.slice(1).toLowerCase()
      );
      return `<h2>${titleCased}</h2>`;
    }
  );
}

// numbered bold headings: <p><strong>1. Title</strong></p> → <h3>
function convertNumberedHeadings(html) {
  return html.replace(
    /<p>\s*<strong>(\d+\.\s+[\s\S]{3,100}?)<\/strong>\s*<\/p>/g,
    "<h3>$1</h3>"
  );
}

// Add inline styles to <table>/<th>/<td> so they render correctly regardless
// of which CSS framework (or version) the frontend uses.
function styleTablesInline(html) {
  html = html.replace(/<table(\b[^>]*)>/g, (_, attrs) =>
    `<table${attrs} style="width:100%;border-collapse:collapse;font-size:15px;margin:20px 0;overflow:hidden;border-radius:8px">`
  );
  html = html.replace(/<th(\b[^>]*)>/g, (_, attrs) =>
    `<th${attrs} style="border:1px solid #e5e7eb;background:#f3f4f6;padding:10px 14px;font-weight:600;text-align:left;color:#111827;font-size:13px">`
  );
  html = html.replace(/<td(\b[^>]*)>/g, (_, attrs) =>
    `<td${attrs} style="border:1px solid #e5e7eb;padding:10px 14px;vertical-align:top;color:#374151;font-size:14px">`
  );
  return html;
}

// ─── table-aware split ───────────────────────────────────────────────────────
function splitAtHeadings(html) {
  const tables = {};
  let idx = 0;

  let safe = html.replace(/<table[\s\S]*?<\/table>/g, (match) => {
    const key = `\x00TABLE${idx++}\x00`;
    tables[key] = match;
    return key;
  });

  const chunks = safe
    .split(/(?=<h[12][^>]*>)/)   // split only at h1/h2; h3 stays inside its parent section
    .map((s) => s.trim())
    .filter((s) => {
      if (/\x00TABLE\d+\x00/.test(s)) return true;
      return s.replace(/<[^>]+>/g, "").trim().length > 5;
    });

  return chunks.map((chunk) =>
    chunk.replace(/\x00TABLE(\d+)\x00/g, (_, n) => tables[`\x00TABLE${n}\x00`] || "")
  );
}

function extractSectionImage(html) {
  const imgMatch = html.match(/<img[^>]+src="((?:data:|https?:\/\/|\/uploads\/)[^"]+)"[^>]*>/);
  const image = imgMatch ? imgMatch[1] : null;
  const text = html.replace(/<img[^>]+>/g, "").trim();
  return { text, image };
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

const xmlParser = new DOMParser();

function parseXml(str) {
  return xmlParser.parseFromString(str, "text/xml");
}

// ─── SmartArt extraction from DOCX ──────────────────────────────────────────

// Read word/diagrams/layout{n}.xml to classify the SmartArt type
async function detectSmartArtLayout(zip, idx) {
  const candidates = [
    `word/diagrams/layout${idx}.xml`,
    // fallback: pick any layout file in the zip
    ...Object.keys(zip.files).filter(
      (f) => f.startsWith("word/diagrams/layout") && f.endsWith(".xml")
    ),
  ];

  for (const path of candidates) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    const doc = parseXml(xml);
    const all = doc.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName === "title") {
        const val = (el.getAttribute("val") || "").toLowerCase();
        if (!val) continue;
        if (/cycle|circular|wheel|radial|converging|diverging/.test(val)) return "cycle";
        if (/hierarch|org\s*chart|tree|subordinate|table\s*list/.test(val)) return "hierarchy";
        if (/vertical.*process|vertical.*box|stacked|accordion|alternating|continuous\s*block/.test(val)) return "list";
        if (/matrix|grid|quad/.test(val)) return "matrix";
        if (/pyramid|funnel/.test(val)) return "pyramid";
        if (/venn|overlapping|equation|relationship/.test(val)) return "relationship";
        return "process";
      }
    }
  }
  return "process";
}

// Extract parent-child relationships from cxnLst (used for hierarchy layouts)
function extractHierarchyLinks(doc, nodeIds) {
  const children = {}; // parentId → [childId]
  const all = doc.getElementsByTagName("*");
  const idSet = new Set(nodeIds);

  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.localName === "cxn" && el.getAttribute("type") === "parOf") {
      const src = el.getAttribute("srcId");
      const dest = el.getAttribute("destId");
      if (src && dest && idSet.has(src) && idSet.has(dest)) {
        if (!children[src]) children[src] = [];
        children[src].push(dest);
      }
    }
  }
  return children;
}

// Map a SmartArt loTypeId URL to our layout category string
function layoutFromLoTypeId(loTypeId) {
  const lo = loTypeId.toLowerCase();
  if (/cycle|circular|wheel|radial|converging|diverging/.test(lo)) return "cycle";
  if (/hierarch/.test(lo)) return "hierarchy";
  if (/list/.test(lo)) return "list";
  if (/matrix|grid|quad/.test(lo)) return "matrix";
  if (/pyramid|funnel/.test(lo)) return "pyramid";
  if (/venn|relationship|equation/.test(lo)) return "relationship";
  return "process";
}

async function extractSmartArtFromDocx(zip) {
  const results = {}; // idx → { nodes, layoutType, idOrder, childMap }

  const dataFiles = Object.keys(zip.files).filter(
    (f) => f.startsWith("word/diagrams/data") && f.endsWith(".xml")
  );

  for (const filePath of dataFiles) {
    const idx = filePath.match(/data(\d+)\.xml/)?.[1] ?? "0";
    const xml = await zip.file(filePath).async("string");
    const doc = parseXml(xml);
    const all = doc.getElementsByTagName("*");

    // Read loTypeId from the doc root <dgm:pt type="doc"> prSet attribute.
    // This is the most reliable source of the SmartArt layout type —
    // the layout*.xml title element is often empty.
    let loTypeId = "";
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName === "pt" && el.getAttribute("type") === "doc") {
        const inner = el.getElementsByTagName("*");
        for (let j = 0; j < inner.length; j++) {
          if (inner[j].localName === "prSet") {
            loTypeId = inner[j].getAttribute("loTypeId") || "";
            break;
          }
        }
        break;
      }
    }

    const nodeMap = {};   // modelId → text
    const idOrder = [];   // insertion order of ids

    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.localName !== "pt") continue;

      // Per the SmartArt spec, missing type defaults to "node".
      // Explicitly skip doc, parTrans, sibTrans, and pres nodes.
      const ptType = el.getAttribute("type") || "node";
      if (ptType !== "node" && ptType !== "asst") continue;

      const modelId = el.getAttribute("modelId") || String(i);
      const tEls = el.getElementsByTagName("*");
      let text = "";
      for (let j = 0; j < tEls.length; j++) {
        const te = tEls[j];
        // match only <a:t> runs, not <dgm:t> containers (both share localName "t")
        if (te.localName === "t" && (te.nodeName === "a:t" || te.prefix === "a")) {
          text += te.textContent || "";
        }
      }
      text = text.trim();
      if (text) {
        nodeMap[modelId] = text;
        idOrder.push(modelId);
      }
    }

    if (idOrder.length === 0) continue;

    // Prefer loTypeId from the data file; fall back to layout*.xml scanning
    const layoutType = loTypeId
      ? layoutFromLoTypeId(loTypeId)
      : await detectSmartArtLayout(zip, idx);

    const childMap =
      layoutType === "hierarchy"
        ? extractHierarchyLinks(doc, idOrder)
        : null;

    results[idx] = {
      nodes: idOrder.map((id) => nodeMap[id]),
      nodeMap,
      idOrder,
      layoutType,
      childMap,
    };
  }

  return results;
}

// ─── SmartArt renderers (all inline styles — works inside dangerouslySetInnerHTML) ─

const SA_COLORS = ["#0d9488","#0891b2","#2563eb","#7c3aed","#db2777","#059669"];

function saCard(text, i, extra = "") {
  const bg = SA_COLORS[i % SA_COLORS.length];
  return `<div style="background:${bg};color:#fff;border-radius:10px;padding:16px 14px;text-align:center;font-weight:700;font-size:14px;line-height:1.45;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.11);${extra}">${text}</div>`;
}

function saArrow(ch = "&#8594;") {
  return `<div style="display:flex;align-items:center;color:#9ca3af;font-size:18px;flex-shrink:0;align-self:center">${ch}</div>`;
}

// Process / default — horizontal boxes with → arrows
function renderProcess(nodes) {
  const items = nodes.map((t, i) =>
    saCard(t, i, "flex:1 1 120px;min-width:110px;max-width:200px") +
    (i < nodes.length - 1 ? saArrow() : "")
  );
  return `<div data-smartart="process" style="display:flex;flex-wrap:wrap;gap:10px;margin:28px 0;align-items:center">${items.join("")}</div>`;
}

// Cycle — numbered badges with loop-back ↺ at end
function renderCycle(nodes) {
  const items = nodes.map((t, i) => {
    const badge = `<div style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.3);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;margin-bottom:5px">${i + 1}</div>`;
    const inner = `<div style="display:flex;flex-direction:column;align-items:center">${badge}<span>${t}</span></div>`;
    return (
      saCard(inner, i, "flex:1 1 110px;min-width:100px;max-width:175px;padding:12px 10px") +
      (i < nodes.length - 1 ? saArrow() : saArrow("&#8635;"))
    );
  });
  return `<div data-smartart="cycle" style="display:flex;flex-wrap:wrap;gap:10px;margin:28px 0;align-items:center">${items.join("")}</div>`;
}

// Hierarchy — root card on top, children row below linked by a vertical line
function renderHierarchy(nodes, nodeMap, idOrder, childMap) {
  // Determine root(s): nodes with no parent
  const hasParent = new Set(Object.values(childMap || {}).flat());
  const roots = idOrder.filter((id) => !hasParent.has(id));
  const childIds = roots.length > 0
    ? (childMap?.[roots[0]] || [])
    : [];
  const rootText = nodeMap ? (nodeMap[roots[0]] || nodes[0]) : nodes[0];
  const childTexts = childIds.length > 0
    ? childIds.map((id) => nodeMap[id]).filter(Boolean)
    : nodes.slice(1);

  const rootCard = saCard(rootText, 0, "min-width:180px;max-width:300px;margin:0 auto");
  const childCards = childTexts.map((t, i) =>
    saCard(t, i + 1, "flex:1 1 120px;min-width:100px;max-width:180px")
  ).join("");

  const sub = childTexts.length
    ? `<div style="width:2px;height:22px;background:#d1d5db;margin:0 auto"></div>
       <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">${childCards}</div>`
    : "";

  return `<div data-smartart="hierarchy" style="display:flex;flex-direction:column;align-items:center;gap:0;margin:28px 0">
    <div style="display:flex;justify-content:center">${rootCard}</div>${sub}
  </div>`;
}

// List — vertical full-width bars with a colored left accent
function renderList(nodes) {
  const items = nodes.map((t, i) => {
    const bg = SA_COLORS[i % SA_COLORS.length];
    return `<div style="display:flex;align-items:center;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08)">
      <div style="width:6px;background:${bg};align-self:stretch;flex-shrink:0"></div>
      <div style="flex:1;padding:12px 16px;background:#f9fafb;font-weight:600;font-size:14px;color:#1f2937">${t}</div>
    </div>`;
  });
  return `<div data-smartart="list" style="display:flex;flex-direction:column;gap:8px;margin:28px 0">${items.join("")}</div>`;
}

// Matrix — CSS grid, 2 cols for ≤4 nodes, 3 cols otherwise
function renderMatrix(nodes) {
  const cols = nodes.length <= 4 ? 2 : 3;
  const items = nodes.map((t, i) => saCard(t, i, "padding:20px 12px")).join("");
  return `<div data-smartart="matrix" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;margin:28px 0">${items}</div>`;
}

// Pyramid — stacked centered divs, narrowest at top → widest at bottom
function renderPyramid(nodes) {
  const total = nodes.length;
  const items = nodes.map((t, i) => {
    const pct = total <= 1 ? 80 : Math.round(35 + (i / (total - 1)) * 60);
    const bg = SA_COLORS[i % SA_COLORS.length];
    return `<div style="width:${pct}%;background:${bg};color:#fff;border-radius:6px;padding:11px 10px;text-align:center;font-weight:700;font-size:13px;line-height:1.4;margin:0 auto;box-shadow:0 2px 6px rgba(0,0,0,0.10)">${t}</div>`;
  });
  return `<div data-smartart="pyramid" style="display:flex;flex-direction:column;align-items:center;gap:4px;margin:28px 0">${items.join("")}</div>`;
}

// Relationship / Venn — colored ovals, no arrows (nodes overlap conceptually)
function renderRelationship(nodes) {
  const items = nodes.map((t, i) => {
    const bg = SA_COLORS[i % SA_COLORS.length];
    return `<div style="background:${bg};color:#fff;border-radius:50px;padding:14px 22px;font-weight:700;font-size:13px;text-align:center;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,0.12);flex:1 1 140px;min-width:120px;max-width:200px">${t}</div>`;
  });
  return `<div data-smartart="relationship" style="display:flex;flex-wrap:wrap;gap:8px;margin:28px 0;justify-content:center;align-items:center">${items.join("")}</div>`;
}

// ─── Paired layout (title box + description box per item) ────────────────────
// Detects Word diagrams where each item is a short heading paired with a longer
// description — e.g. "Connect Systems" / "Essential infrastructure for..." pairs.

const TITLE_WORD_LIMIT = 6; // words; texts at or below this are treated as titles

function splitPairs(nodes) {
  const titles = [];
  const descs  = [];
  nodes.forEach((n) => {
    if (n.split(/\s+/).length <= TITLE_WORD_LIMIT) titles.push(n);
    else descs.push(n);
  });
  const count = Math.min(titles.length, descs.length);
  return { pairs: Array.from({ length: count }, (_, i) => ({ title: titles[i], desc: descs[i] })), titles, descs };
}

function isPairedLayout(nodes) {
  if (nodes.length < 4) return false;
  const { titles, descs } = splitPairs(nodes);
  // Need at least 2 of each and counts must be equal (one title per description)
  return titles.length >= 2 && descs.length >= 2 && titles.length === descs.length;
}

// Horizontal paired: colored header box on top, bordered description panel below.
// Used when there are 3+ pairs (like the 4-column Integration diagram).
function renderPairedHorizontal(pairs) {
  const cards = pairs.map((p, i) => {
    const bg = SA_COLORS[i % SA_COLORS.length];
    return (
      `<div style="display:flex;flex-direction:column;flex:1 1 160px;min-width:140px">` +
        `<div style="background:${bg};color:#fff;border-radius:10px 10px 0 0;padding:16px 12px;` +
               `text-align:center;font-weight:700;font-size:14px;line-height:1.45;min-height:68px;` +
               `display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.10)">` +
          p.title +
        `</div>` +
        `<div style="border:2px solid ${bg};border-top:none;border-radius:0 0 10px 10px;padding:12px 14px;` +
               `font-size:13px;color:#374151;line-height:1.6;flex:1;background:#fff">` +
          p.desc +
        `</div>` +
      `</div>`
    );
  }).join("");
  return `<div data-smartart="paired" style="display:flex;flex-wrap:wrap;gap:12px;margin:28px 0;align-items:stretch">${cards}</div>`;
}

// Vertical paired: colored header bar spanning full width, description below.
// Used when there are 1-2 pairs or the diagram stacks vertically (like Cost/Risk).
function renderPairedVertical(pairs) {
  const items = pairs.map((p, i) => {
    const bg = SA_COLORS[i % SA_COLORS.length];
    return (
      `<div style="border:2px solid ${bg};border-radius:10px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,0.08)">` +
        `<div style="background:${bg};color:#fff;padding:10px 18px;font-weight:700;font-size:14px;line-height:1.45">` +
          p.title +
        `</div>` +
        `<div style="padding:14px 18px;font-size:14px;color:#374151;line-height:1.6;background:#fff">` +
          p.desc +
        `</div>` +
      `</div>`
    );
  }).join("");
  return `<div data-smartart="paired-list" style="display:flex;flex-direction:column;gap:10px;margin:28px 0">${items}</div>`;
}

function renderPairedCards(nodes, layoutType) {
  const { pairs } = splitPairs(nodes);
  // "hierarchy" SmartArt = side-by-side columns (title above description).
  // "list" or anything else = vertical stacked rows.
  return layoutType === "hierarchy"
    ? renderPairedHorizontal(pairs)
    : renderPairedVertical(pairs);
}

function smartArtToHtml({ nodes, nodeMap, idOrder, layoutType, childMap }) {
  if (!nodes || nodes.length === 0) return "";

  // Content-based detection takes priority: if the text boxes form title+description
  // pairs (colored header + white description panel), render as paired cards.
  if (isPairedLayout(nodes)) return renderPairedCards(nodes, layoutType);

  switch (layoutType) {
    case "cycle":        return renderCycle(nodes);
    case "hierarchy":    return renderHierarchy(nodes, nodeMap, idOrder, childMap);
    case "list":         return renderList(nodes);
    case "matrix":       return renderMatrix(nodes);
    case "pyramid":      return renderPyramid(nodes);
    case "relationship": return renderRelationship(nodes);
    default:             return renderProcess(nodes);
  }
}

// ─── SmartArt position detection ─────────────────────────────────────────────
// Reads word/document.xml to find which section heading immediately precedes
// each SmartArt drawing. Returns { dataIdx → headingText }.
async function findSmartArtPositions(zip) {
  // Map rId → diagram data file index via word/_rels/document.xml.rels
  const relFile = zip.file("word/_rels/document.xml.rels");
  if (!relFile) return {};
  const relXml = await relFile.async("string");
  const relDoc = parseXml(relXml);
  const allRels = relDoc.getElementsByTagName("*");
  const rIdToIdx = {};
  for (let i = 0; i < allRels.length; i++) {
    const el = allRels[i];
    if (el.localName !== "Relationship") continue;
    const target = el.getAttribute("Target") || "";
    const id = el.getAttribute("Id") || "";
    const m = target.match(/diagrams\/data(\d+)\.xml/i);
    if (m && id) rIdToIdx[id] = m[1];
  }
  if (Object.keys(rIdToIdx).length === 0) return {};

  // Walk document.xml tracking last-seen heading text before each SmartArt
  const docFile = zip.file("word/document.xml");
  if (!docFile) return {};
  const docXml = await docFile.async("string");
  const doc = parseXml(docXml);
  const all = doc.getElementsByTagName("*");

  const positions = {}; // dataIdx → headingText
  let lastHeading = "";

  for (let i = 0; i < all.length; i++) {
    const el = all[i];

    // Detect heading-styled paragraph via <w:pStyle w:val="Heading1|Heading2...">
    if (el.localName === "pStyle") {
      const styleVal = el.getAttribute("w:val") || "";
      if (/^[Hh]eading\d/.test(styleVal)) {
        // Walk up to the parent <w:p> and collect all text runs
        let p = el.parentNode;
        while (p && p.localName !== "p") p = p.parentNode;
        if (p) {
          const inner = p.getElementsByTagName("*");
          let text = "";
          for (let j = 0; j < inner.length; j++) {
            if (inner[j].localName === "t") text += inner[j].textContent || "";
          }
          lastHeading = text.trim();
        }
      }
    }

    // Detect SmartArt reference: <dgm:relIds r:dm="rId14" .../>
    if (el.localName === "relIds") {
      // r:dm holds the relationship ID for the data file; try both prefixed and plain forms
      let dm = el.getAttribute("r:dm") || el.getAttribute("dm") || "";
      if (!dm) {
        // Iterate raw attributes as fallback
        const attrs = el.attributes;
        for (let j = 0; j < attrs.length; j++) {
          if (attrs[j].localName === "dm") { dm = attrs[j].value; break; }
        }
      }
      if (dm && rIdToIdx[dm]) {
        positions[rIdToIdx[dm]] = lastHeading;
      }
    }
  }

  return positions; // e.g. { "1": "Integration and Interoperability", "2": "Cost, Compliance, and Risk Management" }
}

// ─── Word shape text extraction (fallback when no SmartArt XML exists) ───────
// Handles grouped text boxes (wpg:wgp with wps:wsp children) and consecutive
// anchored/inline shapes — the typical output when users draw colored boxes
// manually in Word instead of using Insert → SmartArt.

function getTextBoxTexts(drawingEl) {
  const texts = [];
  const all = drawingEl.getElementsByTagName("*");
  for (let j = 0; j < all.length; j++) {
    if (all[j].localName === "txbxContent") {
      const contentAll = all[j].getElementsByTagName("*");
      let text = "";
      for (let k = 0; k < contentAll.length; k++) {
        if (contentAll[k].localName === "t") {
          text += contentAll[k].textContent || "";
        }
      }
      text = text.trim();
      if (text) texts.push(text);
    }
  }
  return texts;
}

async function extractShapeTextFromDocx(zip) {
  const docFile = zip.file("word/document.xml");
  if (!docFile) return [];

  const xml = await docFile.async("string");
  const doc = parseXml(xml);
  const all = doc.getElementsByTagName("*");

  const results = [];
  let consecutiveSingles = [];

  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.localName !== "drawing") continue;

    const texts = getTextBoxTexts(el);

    if (texts.length >= 2) {
      // Grouped drawing with multiple text boxes — treat as one diagram
      if (consecutiveSingles.length >= 2) {
        results.push({ nodes: consecutiveSingles, nodeMap: null, idOrder: null, layoutType: "process", childMap: null });
      }
      consecutiveSingles = [];
      results.push({ nodes: texts, nodeMap: null, idOrder: null, layoutType: "process", childMap: null });
    } else if (texts.length === 1) {
      consecutiveSingles.push(texts[0]);
    } else {
      // Drawing with no text — flush any accumulated singles
      if (consecutiveSingles.length >= 2) {
        results.push({ nodes: consecutiveSingles, nodeMap: null, idOrder: null, layoutType: "process", childMap: null });
      }
      consecutiveSingles = [];
    }
  }

  if (consecutiveSingles.length >= 2) {
    results.push({ nodes: consecutiveSingles, nodeMap: null, idOrder: null, layoutType: "process", childMap: null });
  }

  return results;
}

// ─── PPTX parsing ────────────────────────────────────────────────────────────

// Get slide file paths in presentation order from ppt/presentation.xml
async function getSlideOrder(zip) {
  const presXml = await zip.file("ppt/presentation.xml").async("string");
  const doc = parseXml(presXml);
  const sldIdLst = doc.getElementsByTagName("*");
  const rIds = [];
  for (let i = 0; i < sldIdLst.length; i++) {
    const el = sldIdLst[i];
    if (el.localName === "sldId") {
      const rId = el.getAttribute("r:id") || el.getAttribute("id");
      if (rId && rId.startsWith("rId")) rIds.push(rId);
    }
  }

  // Read relationships to map rId → slide file
  const relXml = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
  const relDoc = parseXml(relXml);
  const rels = relDoc.getElementsByTagName("*");
  const map = {};
  for (let i = 0; i < rels.length; i++) {
    const el = rels[i];
    if (el.localName === "Relationship") {
      const id = el.getAttribute("Id");
      const target = el.getAttribute("Target");
      if (id && target && target.includes("slide") && !target.includes("slideLayout") && !target.includes("slideMaster")) {
        map[id] = target.startsWith("ppt/") ? target : `ppt/${target}`;
      }
    }
  }

  const ordered = rIds.map((r) => map[r]).filter(Boolean);
  // Fallback: if ordering failed just sort by name
  if (ordered.length === 0) {
    return Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0]);
        const nb = parseInt(b.match(/\d+/)[0]);
        return na - nb;
      });
  }
  return ordered;
}

// Parse all text shapes from a slide, each with its y-position and max font size.
// Returns shapes sorted top-to-bottom so content flows in visual reading order.
function parseSlideShapes(doc) {
  const shapes = [];
  const all = doc.getElementsByTagName("*");

  for (let i = 0; i < all.length; i++) {
    const sp = all[i];
    if (sp.localName !== "sp") continue;

    const inner = sp.getElementsByTagName("*");

    // y-position from spPr > xfrm > off/@y
    let yPos = 999999;
    for (let j = 0; j < inner.length; j++) {
      const c = inner[j];
      if (
        c.localName === "off" &&
        c.parentNode?.localName === "xfrm" &&
        c.parentNode?.parentNode?.localName === "spPr"
      ) {
        const y = parseInt(c.getAttribute("y") || "NaN");
        if (!isNaN(y)) { yPos = y; break; }
      }
    }

    // max font size from any <a:rPr sz="...">
    let maxSz = 0;
    for (let j = 0; j < inner.length; j++) {
      if (inner[j].localName === "rPr") {
        const sz = parseInt(inner[j].getAttribute("sz") || "0");
        if (sz > maxSz) maxSz = sz;
      }
    }

    // text by paragraph from txBody
    const paragraphs = [];
    for (let j = 0; j < inner.length; j++) {
      const p = inner[j];
      if (p.localName !== "p" || p.parentNode?.localName !== "txBody") continue;
      const runs = p.getElementsByTagName("*");
      let text = "";
      for (let k = 0; k < runs.length; k++) {
        if (runs[k].localName === "t") text += runs[k].textContent || "";
      }
      text = text.trim();
      if (text) paragraphs.push(text);
    }

    if (paragraphs.length > 0) shapes.push({ paragraphs, maxSz, yPos });
  }

  return shapes.sort((a, b) => a.yPos - b.yPos);
}

// Build structured {title, html} from a slide.
//   • Tries <p:ph type="title|ctrTitle"> first (standard PowerPoint slides).
//   • Falls back to the largest-font shape (designer PPTXs — Canva, Adobe, etc.
//     produce slides with no placeholder elements at all).
//   • Body shapes with font size ≥ 60% of the title font render as <h3>;
//     everything else becomes <p>.
//   • Shapes are ordered by vertical position so text flows top-to-bottom.
function buildSlideContent(doc) {
  // 1. Try standard placeholder title
  let titleText = null;
  const all = doc.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.localName === "ph") {
      const type = el.getAttribute("type") || "";
      if (type === "title" || type === "ctrTitle") {
        let sp = el.parentNode;
        while (sp && sp.localName !== "sp") sp = sp.parentNode;
        if (sp) {
          const inner = sp.getElementsByTagName("*");
          let text = "";
          for (let j = 0; j < inner.length; j++) {
            if (inner[j].localName === "t") text += inner[j].textContent || "";
          }
          titleText = text.trim() || null;
        }
        break;
      }
    }
  }

  // 2. Shape-based parsing (sorted by y-position)
  const shapes = parseSlideShapes(doc);
  if (shapes.length === 0) return { title: titleText, html: titleText ? `<h2>${titleText}</h2>` : "" };

  // 3. If no placeholder title, identify title as the shape with the largest font
  let titleIdx = -1;
  if (!titleText) {
    let maxFound = 0;
    for (let i = 0; i < shapes.length; i++) {
      if (shapes[i].maxSz > maxFound) { maxFound = shapes[i].maxSz; titleIdx = i; }
    }
    if (maxFound >= 2800) { // ≥28 pt is title-sized
      titleText = shapes[titleIdx].paragraphs.join(" ");
    } else {
      titleIdx = -1;
    }
  }

  // 4. Compute body size (smallest non-title font size) and derive subhead threshold
  const titleSz = titleIdx !== -1 ? shapes[titleIdx].maxSz : 0;
  const bodySizes = shapes
    .filter((_, i) => i !== titleIdx && shapes[i !== undefined ? i : 0].maxSz > 0)
    .map((s) => s.maxSz)
    .filter((sz) => sz > 0);
  const minBodySz = bodySizes.length > 0 ? Math.min(...bodySizes) : 0;
  // A shape is a subheading if its font is ≥ 15% larger than the smallest body font
  // (catches "Training Delivery" / "Recruitment & Planning" style section headers)
  const subheadThreshold = minBodySz > 0 ? minBodySz * 1.15 : titleSz * 0.5;

  // 5. Build HTML from body shapes
  let html = titleText ? `<h2>${titleText}</h2>` : "";
  shapes.forEach((shape, idx) => {
    if (idx === titleIdx) return; // already used as title
    if (titleText && shape.paragraphs.join(" ") === titleText) return; // skip exact duplicate
    const tag = shape.maxSz >= subheadThreshold ? "h3" : "p";
    for (const para of shape.paragraphs) {
      html += `<${tag}>${para}</${tag}>`;
    }
  });

  return { title: titleText, html };
}

// Extract first significant image from a slide, saved to local disk.
async function extractSlideImage(zip, slidePath) {
  const relPath = slidePath.replace("ppt/slides/slide", "ppt/slides/_rels/slide").replace(".xml", ".xml.rels");
  const relFile = zip.file(relPath);
  if (!relFile) return null;

  const relXml = await relFile.async("string");
  const relDoc = parseXml(relXml);
  const rels = relDoc.getElementsByTagName("*");

  for (let i = 0; i < rels.length; i++) {
    const el = rels[i];
    if (el.localName === "Relationship") {
      const type = el.getAttribute("Type") || "";
      const target = el.getAttribute("Target") || "";
      if (type.includes("image") && target) {
        const mediaPath = target.startsWith("../")
          ? `ppt/${target.slice(3)}`
          : `ppt/slides/${target}`;

        const mediaFile = zip.file(mediaPath);
        if (!mediaFile) continue; // media was stripped — no fallback

        const ext = mediaPath.split(".").pop().toLowerCase();
        if (["emf", "wmf"].includes(ext)) continue;

        const buf = await mediaFile.async("nodebuffer");
        if (buf.length < 6000) continue;

        return await saveImageBuffer(buf, ext);
      }
    }
  }
  return null;
}

async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const slidePaths = await getSlideOrder(zip);
  if (slidePaths.length === 0) throw new Error("No slides found in PPTX");

  const slides = [];
  for (const slidePath of slidePaths) {
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;

    const slideXml = await slideFile.async("string");
    const doc = parseXml(slideXml);

    const { title: slideTitle, html } = buildSlideContent(doc);
    const image = await extractSlideImage(zip, slidePath);

    slides.push({ title: slideTitle, html, image });
  }

  return slides;
}

// ─── route ──────────────────────────────────────────────────────────────────

router.post("/", requireAdminAuth, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ msg: "No file provided" });

    const isDocx =
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.originalname?.toLowerCase().endsWith(".docx");

    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname?.toLowerCase().endsWith(".pdf");

    const isPptx =
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
      file.originalname?.toLowerCase().endsWith(".pptx");

    if (!isDocx && !isPdf && !isPptx)
      return res.status(400).json({ msg: "Only DOCX, PDF, and PPTX files are supported" });

    let title = "Untitled";
    let heroImage = null;
    let sections = [];

    // ── DOCX ────────────────────────────────────────────────────────────────
    if (isDocx) {
      const zip = await JSZip.loadAsync(file.buffer);
      const smartArtMap = await extractSmartArtFromDocx(zip);
      const shapeBlocks = await extractShapeTextFromDocx(zip);

      const result = await mammoth.convertToHtml(
        { buffer: file.buffer },
        {
          convertImage: mammoth.images.inline(async (image) => {
            if (["image/x-emf", "image/x-wmf"].includes(image.contentType))
              return { src: "data:skip" };

            const buf = await image.read();
            if (buf.length < 6000) return { src: "data:skip" };

            try {
              const url = await saveImageBuffer(buf, image.contentType || "image/png");
              return { src: url };
            } catch {
              return { src: "data:skip" };
            }
          }),
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Heading 1'] => h2:fresh",
            "p[style-name='Heading 2'] => h3:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Subtitle'] => p:fresh",
          ],
        }
      );

      let html = result.value;

      // 1. Remove mammoth-skipped images
      html = html.replace(/<img[^>]+src="data:skip"[^>]*>/g, "");

      // 2. Remove known logo/watermark images by alt-text keyword
      html = html.replace(
        /<img\b[^>]*\balt="[^"]*(?:logo|watermark|brand)[^"]*"[^>]*>/gi,
        ""
      );

      // 3. Remove empty heading/paragraph and list shells left after image removal
      html = html.replace(/<(h[123]|p)>(\s|&nbsp;)*<\/\1>/g, "");
      html = html.replace(/<li>(\s|&nbsp;)*<\/li>/g, "");
      html = html.replace(/<(ul|ol)>(\s)*<\/(ul|ol)>/g, "");

      // 4. Post-process headings, bullets, and table inline styles
      html = convertBoldHeadings(html);
      html = convertNumberedHeadings(html);
      html = convertAllCapsParas(html);
      html = fixManualBullets(html);
      html = styleTablesInline(html);

      // 5. Pre-render SmartArt HTML per data-file index; also get positions in doc
      //    Shape blocks have no position info and will go at the end.
      const smartArtPositions = await findSmartArtPositions(zip); // { idx → headingText }
      // headingText (lowercase, trimmed) → rendered HTML
      const headingToSmartArt = {};
      for (const [idx, headingText] of Object.entries(smartArtPositions)) {
        if (smartArtMap[idx]) {
          const html2 = smartArtToHtml(smartArtMap[idx]);
          if (html2) headingToSmartArt[headingText.toLowerCase().trim()] = html2;
        }
      }
      // Unpositioned: SmartArt blocks with no match + all shape blocks
      const positionedIdxs = new Set(Object.keys(smartArtPositions));
      const unpositioned = [
        ...Object.entries(smartArtMap)
          .filter(([idx]) => !positionedIdxs.has(idx))
          .map(([, block]) => smartArtToHtml(block)),
        ...shapeBlocks.map(smartArtToHtml),
      ].filter(Boolean);

      // 6. Remove any new empty shells (headings/paragraphs + empty list items)
      html = html.replace(/<(h[123]|p)>(\s|&nbsp;)*<\/\1>/g, "");
      html = html.replace(/<li>(\s|&nbsp;)*<\/li>/g, "");
      html = html.replace(/<(ul|ol)>(\s)*<\/(ul|ol)>/g, "");

      // 7. Hero image
      //    Primary: first <img> that appears before the first heading → remove from body.
      //    Fallback: first <img> anywhere → use as hero but leave it in its section too.
      const firstHeadingPos = html.search(/<h[123]/);
      const firstImgPos = html.search(/<img[^>]+src="(?:data:|https?:\/\/|\/uploads\/)/);
      if (firstImgPos !== -1) {
        const m = html.match(/<img[^>]+src="((?:data:|https?:\/\/|\/uploads\/)[^"]+)"[^>]*>/);
        if (m) {
          heroImage = m[1];
          // Only remove from body if it was before the first heading
          if (firstHeadingPos === -1 || firstImgPos < firstHeadingPos) {
            html = html.replace(m[0], "");
          }
          // Otherwise keep it in place — it will also appear in its section
        }
      }

      // 8. Split into sections at heading boundaries (table-aware)
      const chunks = splitAtHeadings(html);

      if (chunks.length === 0)
        return res.status(400).json({ msg: "No readable content found in document" });

      // 9. First chunk → document title
      const firstChunkText = chunks[0].replace(/<img[^>]+>/g, "").trim();
      const headingMatch = firstChunkText.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/);
      if (headingMatch) {
        title = normalizeTitle(headingMatch[1].replace(/<[^>]+>/g, "").trim());
      } else {
        const plain = firstChunkText.replace(/<[^>]+>/g, "").trim();
        title = normalizeTitle(plain.slice(0, 120));
      }

      // 10. Build sections: merge SmartArt HTML into the matching heading section
      sections = [];
      for (const chunk of chunks.slice(1)) {
        const sec = extractSectionImage(chunk);
        sections.push(sec);

        // If this chunk's heading has a matching SmartArt, append it to the same section
        const hMatch = chunk.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/);
        if (hMatch) {
          const key = hMatch[1].replace(/<[^>]+>/g, "").trim().toLowerCase();
          if (headingToSmartArt[key]) {
            sec.text = (sec.text || "") + headingToSmartArt[key];
            delete headingToSmartArt[key];
          }
        }
      }
      // Anything not matched by heading + unpositioned blocks go at the end
      for (const html2 of Object.values(headingToSmartArt)) sections.push({ text: html2, image: null });
      for (const html2 of unpositioned) sections.push({ text: html2, image: null });

    // ── PPTX ────────────────────────────────────────────────────────────────
    } else if (isPptx) {
      const slides = await parsePptx(file.buffer);

      if (slides.length === 0)
        return res.status(400).json({ msg: "No slides found in presentation" });

      // First slide → document title + hero image
      const firstSlide = slides[0];
      title = normalizeTitle(firstSlide.title || firstSlide.html.replace(/<[^>]+>/g, "").trim().slice(0, 120) || "Untitled");
      heroImage = firstSlide.image;

      // Remaining slides → sections
      sections = slides.slice(1).map((slide) => ({
        text: slide.html,
        image: slide.image,
      }));

    // ── PDF ─────────────────────────────────────────────────────────────────
    } else if (isPdf) {
      const data = await pdfParse(file.buffer);
      const rawText = data.text;

      if (!rawText?.trim())
        return res.status(400).json({ msg: "No readable text found in PDF" });

      const parts = rawText
        .split(/\n{2,}/)
        .map((p) => p.replace(/\n+/g, " ").trim())
        .filter((p) => p.length > 10);

      title = normalizeTitle(parts[0]?.slice(0, 120) || "Untitled");
      sections = parts.slice(1).map((p) => ({ text: `<p>${p}</p>`, image: null }));
    }

    if (sections.length === 0)
      return res.status(400).json({ msg: "Document appears to be empty or unreadable" });

    res.json({ title, heroImage, sections });
  } catch (err) {
    console.error("Parse Error:", err);
    res.status(500).json({ msg: "Parsing failed", error: err.toString() });
  }
});

export default router;
