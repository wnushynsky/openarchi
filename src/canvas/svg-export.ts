/**
 * SVG export for ArchiMate views.
 * Generates a self-contained SVG document from visible elements and relationships.
 */
import type { ModelElement, ModelRelationship } from '../types';
import { ELEMENT_TYPES, LAYERS, RELATIONSHIP_TYPES, ICON_MAP, ICON_PATHS } from '../core';
import { getRelPoints } from '../core/geometry';

const FONT = "'IBM Plex Sans', system-ui, -apple-system, sans-serif";
const NOTE_FILL = '#EDEDF0';
const NOTE_STROKE = '#A8A8B0';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wrap text into lines that fit within maxWidth (approximate, 6px per char at 10px font). */
function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charW = fontSize * 0.6;
  const maxChars = Math.max(4, Math.floor(maxWidth / charW));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (test.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function rrectPath(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r},${y}`
    + `L${x + w - r},${y}Q${x + w},${y},${x + w},${y + r}`
    + `L${x + w},${y + h - r}Q${x + w},${y + h},${x + w - r},${y + h}`
    + `L${x + r},${y + h}Q${x},${y + h},${x},${y + h - r}`
    + `L${x},${y + r}Q${x},${y},${x + r},${y}Z`;
}

function renderElementSvg(el: ModelElement, _elements: ModelElement[]): string {
  const typeDef = ELEMENT_TYPES[el.type];
  if (!typeDef) return '';
  const { x, y, w, h } = el;
  const isNote = typeDef.isNote;
  const isJunction = el.type === 'andJunction' || el.type === 'orJunction';
  const isComposite = el.type === 'grouping' || el.type === 'location';
  const isViewRef = el.type === 'viewReference';
  const L = LAYERS[typeDef.layer] || LAYERS.composite;

  const fill = el.style?.fillColor || (isNote ? NOTE_FILL : isComposite ? 'rgba(255,255,255,0.02)' : isViewRef ? 'rgba(240,244,255,0.92)' : L.fill);
  const stroke = el.style?.lineColor || (isNote ? NOTE_STROKE : isComposite ? '#b0b0b8' : isViewRef ? '#93a3c0' : L.stroke);
  const textColor = el.style?.fontColor || (isNote ? '#333' : isComposite ? '#3a3a42' : isViewRef ? '#2a3a58' : L.text);

  const parts: string[] = [];

  // Junction — circle
  if (isJunction) {
    const cx = x + w / 2, cy = y + h / 2;
    const r = Math.min(w, h) / 2.5;
    const jFill = el.type === 'andJunction' ? '#444' : '#fff';
    const jStroke = el.type === 'andJunction' ? 'none' : '#444';
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${jFill}" stroke="${jStroke}" stroke-width="2"/>`);
    return parts.join('\n');
  }

  // Shape
  const r = typeDef.shape === 'round' ? 10 : 3;
  const dashAttr = isComposite ? ' stroke-dasharray="5,4"' : isViewRef ? ' stroke-dasharray="4,3"' : '';
  const lw = isViewRef ? 1.4 : 1.2;

  // Shadow filter reference
  const filterId = `shadow-${el.id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  parts.push(`<defs><filter id="${filterId}" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.10"/></filter></defs>`);
  parts.push(`<path d="${rrectPath(x, y, w, h, r)}" fill="${fill}" stroke="${stroke}" stroke-width="${lw}"${dashAttr} filter="url(#${filterId})"/>`);

  // Note folded corner
  if (isNote) {
    const fold = 12;
    parts.push(`<path d="M${x + w - fold},${y}L${x + w - fold},${y + fold}L${x + w},${y + fold}" fill="#D8D8DC" stroke="${stroke}" stroke-width="0.6"/>`);
  }

  // Icon (top-right)
  const iconKey = ICON_MAP[el.type];
  if (iconKey && !isNote && !isJunction) {
    const iconPaths = ICON_PATHS[iconKey];
    if (iconPaths?.length) {
      const ix = x + w - 14, iy = y + 5;
      const iconColor = isComposite ? '#606068' : isViewRef ? '#7088a8' : L.stroke;
      parts.push(`<g transform="translate(${ix},${iy}) scale(${16 / 24})">`);
      for (const d of iconPaths) {
        parts.push(`<path d="${d}" fill="none" stroke="${iconColor}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      parts.push(`</g>`);
    }
  }

  // Text label
  const name = el.name || '';
  if (name) {
    const fontSize = 10;
    const lineHeight = 13;
    const maxW = isNote ? w - 16 : w - (iconKey ? 24 : 8);

    if (isComposite) {
      // Top-left aligned
      const lines = wrapText(name, maxW, fontSize);
      for (let i = 0; i < lines.length && i < 3; i++) {
        parts.push(`<text x="${x + 12}" y="${y + 14 + i * lineHeight}" font-family="${esc(FONT)}" font-size="${fontSize}" fill="${textColor}">${esc(lines[i])}</text>`);
      }
    } else if (isNote) {
      // Note: top-left, wrapping, 10px font
      const lines = wrapText(name, w - 16, fontSize);
      const noteLineH = 14;
      for (let i = 0; i < lines.length && (8 + i * noteLineH) < h - 4; i++) {
        parts.push(`<text x="${x + 8}" y="${y + 18 + i * noteLineH}" font-family="${esc(FONT)}" font-size="${fontSize}" fill="${textColor}">${esc(lines[i])}</text>`);
      }
    } else {
      // Centered
      const lines = wrapText(name, maxW, fontSize);
      const totalH = lines.length * lineHeight;
      const textTop = y + (h - totalH) / 2 + lineHeight * 0.75;
      for (let i = 0; i < lines.length; i++) {
        parts.push(`<text x="${x + w / 2}" y="${textTop + i * lineHeight}" text-anchor="middle" font-family="${esc(FONT)}" font-size="${fontSize}" fill="${textColor}">${esc(lines[i])}</text>`);
      }
    }
  }

  return parts.join('\n');
}

function renderRelationshipSvg(rel: ModelRelationship, elements: ModelElement[], elementMap?: Map<string, ModelElement>): string {
  const typeDef = RELATIONSHIP_TYPES[rel.type];
  if (!typeDef) return '';

  const pts = getRelPoints(rel, elements, elementMap);
  if (!pts || pts.waypoints.length < 2) return '';

  const allPts = [pts.start, ...pts.waypoints.slice(1, -1), pts.end];
  if (allPts.length < 2) return '';

  const parts: string[] = [];
  const color = '#555';
  const lw = 1.2;
  const dash = typeDef.dash ? `stroke-dasharray="${(typeDef.dashPattern || [6, 3]).join(',')}"` : '';

  // Polyline
  const pathD = allPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linejoin="round" stroke-linecap="round" ${dash}/>`);

  // Arrowhead at target
  const last = allPts[allPts.length - 1];
  const prev = allPts[allPts.length - 2];
  const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
  const aL = 9, aW = 9;
  const head = typeDef.head;

  if (head === 'filled_arrow') {
    const lx = last.x - aL * Math.cos(angle) + aW / 2 * Math.sin(angle);
    const ly = last.y - aL * Math.sin(angle) - aW / 2 * Math.cos(angle);
    const rx = last.x - aL * Math.cos(angle) - aW / 2 * Math.sin(angle);
    const ry = last.y - aL * Math.sin(angle) + aW / 2 * Math.cos(angle);
    parts.push(`<polygon points="${last.x},${last.y} ${lx},${ly} ${rx},${ry}" fill="${color}" stroke="none"/>`);
  } else if (head === 'hollow_arrow') {
    const lx = last.x - aL * Math.cos(angle) + aW / 2 * Math.sin(angle);
    const ly = last.y - aL * Math.sin(angle) - aW / 2 * Math.cos(angle);
    const rx = last.x - aL * Math.cos(angle) - aW / 2 * Math.sin(angle);
    const ry = last.y - aL * Math.sin(angle) + aW / 2 * Math.cos(angle);
    parts.push(`<polygon points="${last.x},${last.y} ${lx},${ly} ${rx},${ry}" fill="#fff" stroke="${color}" stroke-width="1"/>`);
  } else if (head === 'open_arrow') {
    const lx = last.x - aL * Math.cos(angle) + aW / 2 * Math.sin(angle);
    const ly = last.y - aL * Math.sin(angle) - aW / 2 * Math.cos(angle);
    const rx = last.x - aL * Math.cos(angle) - aW / 2 * Math.sin(angle);
    const ry = last.y - aL * Math.sin(angle) + aW / 2 * Math.cos(angle);
    parts.push(`<polyline points="${lx},${ly} ${last.x},${last.y} ${rx},${ry}" fill="none" stroke="${color}" stroke-width="${lw}" stroke-linejoin="round"/>`);
  }

  // Source decorations (diamonds, dots)
  if (head === 'diamond_filled' || head === 'diamond') {
    const first = allPts[0];
    const second = allPts[1];
    const sAngle = Math.atan2(second.y - first.y, second.x - first.x);
    const dLen = 10, dW = 3;
    const tip = first;
    const mid = { x: tip.x + dLen / 2 * Math.cos(sAngle), y: tip.y + dLen / 2 * Math.sin(sAngle) };
    const back = { x: tip.x + dLen * Math.cos(sAngle), y: tip.y + dLen * Math.sin(sAngle) };
    const left = { x: mid.x + dW * Math.sin(sAngle), y: mid.y - dW * Math.cos(sAngle) };
    const right = { x: mid.x - dW * Math.sin(sAngle), y: mid.y + dW * Math.cos(sAngle) };
    const dFill = head === 'diamond_filled' ? color : '#fff';
    parts.push(`<polygon points="${tip.x},${tip.y} ${left.x},${left.y} ${back.x},${back.y} ${right.x},${right.y}" fill="${dFill}" stroke="${color}" stroke-width="1"/>`);
  } else if (head === 'filled_dot') {
    const first = allPts[0];
    parts.push(`<circle cx="${first.x}" cy="${first.y}" r="3" fill="${color}" stroke="none"/>`);
  }

  // Label
  if (rel.name) {
    const labelPos = rel.labelPos ?? 0.5;
    const totalLen = allPts.reduce((sum, p, i) => i === 0 ? 0 : sum + Math.hypot(p.x - allPts[i - 1].x, p.y - allPts[i - 1].y), 0);
    const targetLen = totalLen * labelPos;
    let accum = 0;
    let lx = allPts[0].x, ly = allPts[0].y;
    for (let i = 1; i < allPts.length; i++) {
      const segLen = Math.hypot(allPts[i].x - allPts[i - 1].x, allPts[i].y - allPts[i - 1].y);
      if (accum + segLen >= targetLen && segLen > 0) {
        const t = (targetLen - accum) / segLen;
        lx = allPts[i - 1].x + t * (allPts[i].x - allPts[i - 1].x);
        ly = allPts[i - 1].y + t * (allPts[i].y - allPts[i - 1].y);
        // Offset perpendicular
        const dx = allPts[i].x - allPts[i - 1].x;
        const dy = allPts[i].y - allPts[i - 1].y;
        const len = Math.hypot(dx, dy) || 1;
        lx += (-dy / len) * 10;
        ly += (dx / len) * 10;
        break;
      }
      accum += segLen;
    }
    parts.push(`<rect x="${lx - 20}" y="${ly - 7}" width="40" height="14" rx="2" fill="rgba(255,255,255,0.88)" stroke="none"/>`);
    parts.push(`<text x="${lx}" y="${ly + 3}" text-anchor="middle" font-family="${esc(FONT)}" font-size="8" fill="#4a5060">${esc(rel.name)}</text>`);
  }

  return parts.join('\n');
}

export interface SvgExportOptions {
  padding?: number;
}

export function exportViewToSvg(
  elements: ModelElement[],
  relationships: ModelRelationship[],
  options?: SvgExportOptions,
): string {
  const padding = options?.padding ?? 40;

  if (elements.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="100" y="50" text-anchor="middle" font-size="14" fill="#999">Empty view</text></svg>';
  }

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  const vw = maxX - minX + padding * 2;
  const vh = maxY - minY + padding * 2;
  const ox = -minX + padding;
  const oy = -minY + padding;

  const elementMap = new Map(elements.map(e => [e.id, e]));

  const elSvg = elements
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(el => renderElementSvg(el, elements))
    .join('\n');

  const relSvg = relationships
    .map(rel => renderRelationshipSvg(rel, elements, elementMap))
    .join('\n');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(vw)}" height="${Math.ceil(vh)}" viewBox="0 0 ${Math.ceil(vw)} ${Math.ceil(vh)}">`,
    `<style>text { font-family: ${FONT}; }</style>`,
    `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})">`,
    relSvg,
    elSvg,
    `</g>`,
    `</svg>`,
  ].join('\n');
}
