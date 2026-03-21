import type { ModelElement, ModelRelationship, LayerDef } from '../types';
import { LAYERS, NOTE_STYLE, ELEMENT_TYPES, RELATIONSHIP_TYPES, ICONS, ICON_MAP } from '../core/metamodel';
import { GRID, FONT, getAnchors, getRelPoints, pointOnPath, getResizeHandles, type SnapGuide } from '../core/geometry';

const VIEW_REFERENCE_STYLE: LayerDef = {
  label: 'View',
  fill: '#ECEDEF',
  stroke: '#A8ACB2',
  accent: '#7E848D',
  text: '#4C525B',
};

// ============================================================
// Primitives
// ============================================================

export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ============================================================
// Grid
// ============================================================

export function drawDotGrid(ctx: CanvasRenderingContext2D, w: number, h: number, ox: number, oy: number, sc: number) {
  // Adaptive gap: when zoomed out enough that dots become dense, skip dots
  let gap = GRID;
  const screenGap = gap * sc;
  if (screenGap < 6) gap *= Math.ceil(6 / screenGap);  // keep dots at least 6 screen-px apart

  const sx = Math.floor(-ox / sc / gap) * gap;
  const sy = Math.floor(-oy / sc / gap) * gap;
  const ex = sx + w / sc + gap * 2;
  const ey = sy + h / sc + gap * 2;

  // Batch all dots into a single path for one fill() call
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  for (let x = sx; x < ex; x += gap) {
    for (let y = sy; y < ey; y += gap) {
      ctx.moveTo(x + 0.8, y);
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

export function drawLineGrid(ctx: CanvasRenderingContext2D, w: number, h: number, ox: number, oy: number, sc: number) {
  let gap = GRID;
  const screenGap = gap * sc;
  if (screenGap < 6) gap *= Math.ceil(6 / screenGap);

  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 0.5;
  const sx = Math.floor(-ox / sc / gap) * gap;
  const sy = Math.floor(-oy / sc / gap) * gap;
  const ex = sx + w / sc + gap * 2;
  const ey = sy + h / sc + gap * 2;
  ctx.beginPath();
  for (let x = sx; x < ex; x += gap) { ctx.moveTo(x, sy); ctx.lineTo(x, ey); }
  for (let y = sy; y < ey; y += gap) { ctx.moveTo(sx, y); ctx.lineTo(ex, y); }
  ctx.stroke();
}

// ============================================================
// Element rendering
// ============================================================

const JUNCTION_STYLE: LayerDef = {
  label: 'Junction',
  fill: '#444',
  stroke: '#222',
  accent: '#666',
  text: '#fff',
};

function getLayerStyle(type: string): LayerDef {
  if (ELEMENT_TYPES[type]?.isNote) return NOTE_STYLE;
  if (type === 'viewReference') return VIEW_REFERENCE_STYLE;
  if (type === 'andJunction' || type === 'orJunction') return JUNCTION_STYLE;
  return LAYERS[ELEMENT_TYPES[type]?.layer] || LAYERS.composite;
}

export function drawElement(ctx: CanvasRenderingContext2D, el: ModelElement, isSel: boolean, isHov: boolean, showAnch: boolean, hasChildren: boolean = false) {
  const isNote = ELEMENT_TYPES[el.type]?.isNote;
  const isViewReference = el.type === 'viewReference';
  const isJunction = el.type === 'andJunction' || el.type === 'orJunction';
  const isComposite = ELEMENT_TYPES[el.type]?.layer === 'composite' && !isNote && !isJunction;
  const L = getLayerStyle(el.type);
  const { x, y, w, h } = el;
  const r = isNote ? 3 : (ELEMENT_TYPES[el.type]?.shape === 'round' ? 10 : 3);

  ctx.save();

  // Shadow
  if (!isComposite) {
    ctx.shadowColor = isSel ? 'rgba(37,99,235,0.14)' : 'rgba(0,0,0,0.05)';
    ctx.shadowBlur = isSel ? 12 : 4;
    ctx.shadowOffsetY = isSel ? 1 : 1;
  }

  rrect(ctx, x, y, w, h, r);

  if (isNote) {
    ctx.fillStyle = L.fill; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#2563eb' : L.stroke;
    ctx.stroke();

    // Folded corner icon (top-right)
    const fold = 12;
    ctx.beginPath();
    ctx.moveTo(x + w - fold, y);
    ctx.lineTo(x + w - fold, y + fold);
    ctx.lineTo(x + w, y + fold);
    ctx.closePath();
    ctx.fillStyle = '#D8D8DC'; ctx.fill();
    ctx.strokeStyle = L.stroke; ctx.lineWidth = 0.6; ctx.stroke();

    ctx.fillStyle = L.text;
    ctx.font = `400 14px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const pad = 12, mw = w - pad * 2;
    const words = (el.name || 'Note').split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const t = cur ? cur + ' ' + word : word;
      if (ctx.measureText(t).width > mw && cur) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.forEach((ln, i) => ctx.fillText(ln, x + pad, y + pad + i * 19));
  } else if (isJunction) {
    // Junction: small filled circle (AND=black, OR=white with border)
    ctx.shadowColor = 'transparent';
    const cx = x + w / 2, cy = y + h / 2;
    const radius = Math.min(w, h) / 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    if (el.type === 'orJunction') {
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 2;
      ctx.strokeStyle = isSel ? '#2563eb' : '#444';
      ctx.stroke();
    } else {
      ctx.fillStyle = isSel ? '#2563eb' : '#444';
      ctx.fill();
    }
  } else if (isComposite) {
    ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    ctx.strokeStyle = isSel ? '#2563eb' : '#b0b0b8';
    ctx.stroke(); ctx.setLineDash([]);

    ctx.font = `400 14px ${FONT}`;
    ctx.fillStyle = '#606060'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(el.name || 'Group', x + 12, y + 10);

    // Icon (top-right corner)
    const cIconKey = ICON_MAP[el.type];
    if (cIconKey) {
      const cDrawFn = ICONS[cIconKey];
      if (cDrawFn) {
        ctx.save();
        ctx.beginPath();
        cDrawFn(ctx, x + w - 15, y + 14, 9);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.setLineDash([]); ctx.stroke();
        ctx.restore();
      }
    }
  } else {
    ctx.fillStyle = L.fill; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#2563eb' : L.stroke;
    ctx.stroke();

    if (isViewReference) {
      // View reference: draw a small "navigate" arrow icon (top-right)
      ctx.save();
      const ix = x + w - 15, iy = y + 14, s = 7;
      ctx.beginPath();
      // Folder tab shape
      ctx.moveTo(ix - s, iy - s * 0.5);
      ctx.lineTo(ix - s, iy - s);
      ctx.lineTo(ix - s * 0.2, iy - s);
      ctx.lineTo(ix + s * 0.1, iy - s * 0.5);
      ctx.lineTo(ix + s, iy - s * 0.5);
      ctx.lineTo(ix + s, iy + s);
      ctx.lineTo(ix - s, iy + s);
      ctx.closePath();
      ctx.strokeStyle = L.accent; ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    } else {
      const iconKey = ICON_MAP[el.type] || 'generic';
      const drawFn = ICONS[iconKey] || ICONS.generic;
      ctx.save();
      ctx.beginPath();
      drawFn(ctx, x + w - 15, y + 14, 9);
      ctx.strokeStyle = L.accent; ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Label — move to top-left when children overlap this element
    ctx.fillStyle = L.text;
    ctx.font = `400 13px ${FONT}`;
    const mw = w - 28;
    const displayName = isViewReference ? `View: ${el.name || 'Untitled'}` : (el.name || '');
    const words = displayName.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const word of words) {
      const t = cur ? cur + ' ' + word : word;
      if (ctx.measureText(t).width > mw && cur) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    const lh = 17;
    const availableHeight = Math.max(lh, h - (hasChildren ? 20 : 10));
    const maxLines = Math.max(1, Math.floor(availableHeight / lh));
    const renderLines = lines.slice(0, maxLines);
    if (lines.length > maxLines) {
      const ellipsis = '…';
      let lastLine = renderLines[maxLines - 1] || '';
      while (lastLine.length > 0 && ctx.measureText(lastLine + ellipsis).width > mw) {
        lastLine = lastLine.slice(0, -1);
      }
      renderLines[maxLines - 1] = lastLine + ellipsis;
    }

    if (hasChildren) {
      // Top-left aligned when acting as a container
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      renderLines.forEach((ln, i) => ctx.fillText(ln, x + 12, y + 10 + i * lh));
    } else {
      // Centered (default)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const totalH = renderLines.length * lh;
      const textTop = y + (h - totalH) / 2 + lh / 2;
      renderLines.forEach((ln, i) => ctx.fillText(ln, x + w / 2, textTop + i * lh));
    }
  }

  // Pop-out icon (larger, more visible)
  if (el.linkedViewId && !isJunction) {
    const px = x + w - 16, py = y + h - 16;
    ctx.save();
    rrect(ctx, px - 8, py - 8, 16, 16, 3);
    ctx.fillStyle = '#e8ecf0'; ctx.fill();
    ctx.strokeStyle = '#9aa5b4'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 3, py + 4); ctx.lineTo(px + 4, py - 3);
    ctx.strokeStyle = '#556'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 0, py - 3); ctx.lineTo(px + 4, py - 3); ctx.lineTo(px + 4, py + 1);
    ctx.strokeStyle = '#556'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }

  // Anchors
  if (showAnch && !isComposite && !isJunction) {
    const anchors = getAnchors(el);
    anchors.forEach((a, i) => {
      const isPrimary = i < 4;
      const rad = isPrimary ? 5 : 3.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = isPrimary ? 2 : 1.4;
      ctx.strokeStyle = '#3b82f6'; ctx.stroke();
      if (isPrimary) {
        ctx.beginPath(); ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6'; ctx.fill();
      }
    });
  }

  // Selection + resize handles
  if (isSel) {
    ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(37,99,235,0.35)'; ctx.lineWidth = 1;
    rrect(ctx, x - 5, y - 5, w + 10, h + 10, r + 3);
    ctx.stroke(); ctx.setLineDash([]);

    // Resize handles
    const handles = getResizeHandles(el);
    for (const hd of handles) {
      const sz = 4;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.rect(hd.x - sz, hd.y - sz, sz * 2, sz * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  ctx.restore();
}

// ============================================================
// Relationship rendering — line crossing hops
// ============================================================

interface Seg { x1: number; y1: number; x2: number; y2: number }

/** Find the parameter t where two segments cross (or null) */
function segIntersect(a: Seg, b: Seg): { x: number; y: number } | null {
  const dx1 = a.x2 - a.x1, dy1 = a.y2 - a.y1;
  const dx2 = b.x2 - b.x1, dy2 = b.y2 - b.y1;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 0.001) return null; // parallel or collinear
  const t = ((b.x1 - a.x1) * dy2 - (b.y1 - a.y1) * dx2) / denom;
  const u = ((b.x1 - a.x1) * dy1 - (b.y1 - a.y1) * dx1) / denom;
  if (t <= 0.01 || t >= 0.99 || u <= 0.01 || u >= 0.99) return null;
  return { x: a.x1 + t * dx1, y: a.y1 + t * dy1 };
}

/** Pre-computed segments for all relationships, used for crossing detection */
export interface RelSegments { relId: string; segments: Seg[] }

/** Extract segments from a relationship's resolved points */
export function getRelSegments(rel: ModelRelationship, elements: ModelElement[], elementMap?: Map<string, ModelElement>): RelSegments | null {
  const pts = getRelPoints(rel, elements, elementMap);
  if (!pts) return null;
  const allPts = [pts.start, ...pts.waypoints, pts.end];
  const segments: Seg[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    segments.push({ x1: allPts[i].x, y1: allPts[i].y, x2: allPts[i + 1].x, y2: allPts[i + 1].y });
  }
  return { relId: rel.id, segments };
}

const HOP_RADIUS = 6;

/** Draw a polyline path with small arc hops at crossing points */
function drawPathWithHops(
  ctx: CanvasRenderingContext2D,
  allPts: { x: number; y: number }[],
  otherSegments: Seg[],
) {
  // Collect all crossing points per segment
  const mySegments: Seg[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    mySegments.push({ x1: allPts[i].x, y1: allPts[i].y, x2: allPts[i + 1].x, y2: allPts[i + 1].y });
  }

  ctx.beginPath();
  ctx.moveTo(allPts[0].x, allPts[0].y);

  for (let i = 0; i < mySegments.length; i++) {
    const seg = mySegments[i];
    const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen < 0.1) { ctx.lineTo(seg.x2, seg.y2); continue; }

    // Find crossings on this segment
    const crossings: number[] = []; // parameter t values
    for (const other of otherSegments) {
      const hit = segIntersect(seg, other);
      if (!hit) continue;
      const t = ((hit.x - seg.x1) * dx + (hit.y - seg.y1) * dy) / (segLen * segLen);
      crossings.push(t);
    }
    crossings.sort((a, b) => a - b);

    if (crossings.length === 0) {
      ctx.lineTo(seg.x2, seg.y2);
    } else {
      // Unit normal perpendicular to segment (pointing "up" in screen space)
      const nx = -dy / segLen, ny = dx / segLen;
      const hopT = HOP_RADIUS / segLen;

      for (const t of crossings) {
        const tBefore = Math.max(0, t - hopT);
        const tAfter = Math.min(1, t + hopT);
        // Draw to just before the crossing
        ctx.lineTo(seg.x1 + tBefore * dx, seg.y1 + tBefore * dy);
        // Draw arc hop (semicircle above the line)
        const cx = seg.x1 + t * dx, cy = seg.y1 + t * dy;
        const startAngle = Math.atan2(-nx, -ny);
        ctx.arc(cx, cy, HOP_RADIUS, startAngle, startAngle + Math.PI);
      }
      ctx.lineTo(seg.x2, seg.y2);
    }
  }
  ctx.stroke();
}

export function drawRelationship(ctx: CanvasRenderingContext2D, rel: ModelRelationship, elements: ModelElement[], isSel: boolean, isHov: boolean, otherSegments?: Seg[], elementMap?: Map<string, ModelElement>) {
  const pts = getRelPoints(rel, elements, elementMap);
  if (!pts) return;
  const { start, end, waypoints } = pts;
  const rd = RELATIONSHIP_TYPES[rel.type] || RELATIONSHIP_TYPES.association;
  const col = isSel ? '#2563eb' : isHov ? '#555' : '#777';
  const lw = isSel ? 1.6 : 1.1;

  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (rd.dash) ctx.setLineDash([6, 4]);

  const allPts = [start, ...waypoints, end];
  if (otherSegments && otherSegments.length > 0) {
    drawPathWithHops(ctx, allPts, otherSegments);
  } else {
    ctx.beginPath();
    ctx.moveTo(allPts[0].x, allPts[0].y);
    for (let i = 1; i < allPts.length; i++) ctx.lineTo(allPts[i].x, allPts[i].y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Arrowheads — wider spread (0.5 rad ≈ 29°) for clear visual distinction
  const last = allPts[allPts.length - 2] || start;
  const angle = Math.atan2(end.y - last.y, end.x - last.x);
  const aL = 12;
  const aSpread = 0.5;

  if (rd.head === 'filled_arrow') {
    // Solid filled triangle — triggering, flow
    ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - aL * Math.cos(angle - aSpread), end.y - aL * Math.sin(angle - aSpread));
    ctx.lineTo(end.x - aL * Math.cos(angle + aSpread), end.y - aL * Math.sin(angle + aSpread));
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  } else if (rd.head === 'open_arrow') {
    // Open chevron — serving, access, influence
    const oL = 11;
    ctx.beginPath();
    ctx.moveTo(end.x - oL * Math.cos(angle - aSpread), end.y - oL * Math.sin(angle - aSpread));
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - oL * Math.cos(angle + aSpread), end.y - oL * Math.sin(angle + aSpread));
    ctx.strokeStyle = col; ctx.lineWidth = isSel ? 2 : 1.4; ctx.stroke();
  } else if (rd.head === 'hollow_arrow') {
    // Hollow triangle — realization, specialization
    ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - aL * Math.cos(angle - aSpread), end.y - aL * Math.sin(angle - aSpread));
    ctx.lineTo(end.x - aL * Math.cos(angle + aSpread), end.y - aL * Math.sin(angle + aSpread));
    ctx.closePath(); ctx.fillStyle = '#f5f6f8'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = isSel ? 1.6 : 1.2; ctx.stroke();
  } else if (rd.head === 'diamond_filled' || rd.head === 'diamond') {
    // Diamond at source — composition (filled), aggregation (hollow)
    const sA = Math.atan2(allPts[1].y - start.y, allPts[1].x - start.x);
    const dW = 7; // half-width
    const dLen = 12; // length along the line
    const cx = start.x + dLen * 0.5 * Math.cos(sA);
    const cy = start.y + dLen * 0.5 * Math.sin(sA);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(cx + dW * Math.cos(sA - Math.PI / 2), cy + dW * Math.sin(sA - Math.PI / 2));
    ctx.lineTo(start.x + dLen * Math.cos(sA), start.y + dLen * Math.sin(sA));
    ctx.lineTo(cx + dW * Math.cos(sA + Math.PI / 2), cy + dW * Math.sin(sA + Math.PI / 2));
    ctx.closePath();
    ctx.fillStyle = rd.head === 'diamond_filled' ? col : '#f5f6f8'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = isSel ? 1.4 : 1.1; ctx.stroke();
  } else if (rd.head === 'filled_dot') {
    // Filled circle at source — assignment
    const sA = Math.atan2(allPts[1].y - start.y, allPts[1].x - start.x);
    const dotR = 5;
    ctx.beginPath(); ctx.arc(start.x + (dotR + 1) * Math.cos(sA), start.y + (dotR + 1) * Math.sin(sA), dotR, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
  }

  // Waypoint handles
  if (isSel) {
    waypoints.forEach(wp => {
      ctx.beginPath(); ctx.arc(wp.x, wp.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#2563eb'; ctx.stroke();
    });
    // Endpoint handles (start & end)
    [start, end].forEach(pt => {
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#2563eb'; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke();
    });
  }

  // Label (larger)
  if (rel.name) {
    const lp = rel.labelPos ?? 0.5;
    const pt = pointOnPath(allPts, lp);
    ctx.font = `400 12px ${FONT}`;
    const measured = ctx.measureText(rel.name).width;
    const padX = 6, padY = 3;
    rrect(ctx, pt.x - measured / 2 - padX, pt.y - 8 - padY, measured + padX * 2, 16 + padY * 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
    if (isSel) { ctx.strokeStyle = 'rgba(37,99,235,0.25)'; ctx.lineWidth = 0.8; ctx.stroke(); }
    ctx.fillStyle = isSel ? '#2563eb' : '#777';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rel.name, pt.x, pt.y);
  }

  ctx.restore();
}

// ============================================================
// Snap guide lines
// ============================================================

export function drawSnapGuides(ctx: CanvasRenderingContext2D, guides: SnapGuide[], w: number, h: number, ox: number, oy: number, sc: number) {
  if (guides.length === 0) return;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1 / sc; // constant pixel width regardless of zoom

  for (const guide of guides) {
    ctx.strokeStyle = guide.type === 'center' ? '#e855a0' : '#3b82f6';
    ctx.beginPath();
    // Extend lines across the visible viewport
    const vLeft   = -ox / sc;
    const vTop    = -oy / sc;
    const vRight  = vLeft + w / sc;
    const vBottom = vTop + h / sc;

    if (guide.axis === 'x') {
      ctx.moveTo(guide.value, vTop);
      ctx.lineTo(guide.value, vBottom);
    } else {
      ctx.moveTo(vLeft, guide.value);
      ctx.lineTo(vRight, guide.value);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}
