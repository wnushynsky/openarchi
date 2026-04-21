import type { ModelElement, ModelRelationship, Anchor, Point, RelHit, ResizeHandle } from '../types';

export const GRID = 20;
export const FONT = "'IBM Plex Sans', system-ui, -apple-system, sans-serif";

export function snap(v: number, g: number = GRID / 2): number {
  return Math.round(v / g) * g;
}

export function uid(): string {
  return Math.random().toString(36).substr(2, 9);
}

// ============================================================
// Anchor points — Archi-style dynamic edge anchors
// ============================================================
//
// Archi doesn't use fixed anchor dots. Any point on the element
// edge is a valid connection point. getAnchors() returns 4 cardinal
// anchor indicators (midpoints of each edge) for visual feedback.
// nearestAnchor() snaps to the nearest point on the element boundary.

export function getAnchors(el: ModelElement): Anchor[] {
  return [
    { x: el.x + el.w / 2, y: el.y, side: 'tc' },
    { x: el.x + el.w / 2, y: el.y + el.h, side: 'bc' },
    { x: el.x, y: el.y + el.h / 2, side: 'ml' },
    { x: el.x + el.w, y: el.y + el.h / 2, side: 'mr' },
  ];
}

export function nearestAnchor(el: ModelElement, px: number, py: number): Anchor {
  // Snap to the nearest point on the element boundary (any edge position)
  return snapToEdge(el, { x: px, y: py });
}

// ============================================================
// Relationship path computation
// ============================================================

export interface RelPath {
  start: Anchor;
  end: Anchor;
  waypoints: Point[];
}

/**
 * Compute the point where a ray from the center of a rect toward a target
 * intersects the rect boundary. Keeps lines straight regardless of element position.
 *
 * When the direction is nearly diagonal, we bias toward the edge that aligns
 * with the dominant axis so connections don't flip sides unexpectedly.
 */
// ============================================================
// ============================================================
// Connection Anchoring — 1:1 port of Archi's OrthogonalAnchor.java
// by Jean-Baptiste Sarrodie (MIT License)
// ============================================================
//
// Archi uses a 5×5 position grid (LEFT/LEFT_CORNER/MIDDLE/RIGHT_CORNER/RIGHT
// × TOP/TOP_CORNER/CENTER/BOTTOM_CORNER/BOTTOM) to classify where the
// reference point falls relative to the element. Each of the 25 cases
// produces a specific anchor point on the element boundary.
//
// Corner zones are defined by the element's corner arc (default 10px for
// ArchiMate elements). For the corner cases, the anchor sits on the
// elliptical arc of the rounded corner.

// Archi's default corner arc for element figures
const CORNER_W = 10;
const CORNER_H = 10;
const COSPI4 = Math.cos(Math.PI / 4); // ≈ 0.7071

// Bitwise position flags (matching Archi's OrthogonalAnchor constants)
const LEFT = 1, LEFT_CORNER = 2, MIDDLE = 4, RIGHT_CORNER = 8, RIGHT = 16;
const TOP = 32, TOP_CORNER = 64, CENTER = 128, BOTTOM_CORNER = 256, BOTTOM = 512;

/**
 * OrthogonalAnchor — 1:1 port of Archi's OrthogonalAnchor.getLocation().
 *
 * @param el     The element figure (bounding box)
 * @param ref    Reference point (first/last bendpoint, or remote element center)
 * @param remote Optional remote element — when provided and overlapping, the
 *               reference is adjusted to the midpoint of the overlapping region
 */
function orthogonalAnchor(el: ModelElement, ref: Point, remote?: ModelElement): Anchor {
  const bx = el.x, by = el.y, bw = el.w - 1, bh = el.h - 1; // -1 matches Archi's resize(-1,-1)
  const cw = CORNER_W, ch = CORNER_H;

  // If reference comes from a remote figure center and figures overlap,
  // adjust reference to the midpoint of the overlapping region
  let rx = ref.x, ry = ref.y;
  if (remote) {
    const rbx = remote.x, rby = remote.y, rbw = remote.w, rbh = remote.h;
    // Check if reference is near the remote figure's center (5px tolerance, matching Archi)
    const rcx = rbx + rbw / 2, rcy = rby + rbh / 2;
    if (Math.abs(rx - rcx) <= 3 && Math.abs(ry - rcy) <= 3) {
      // Compute overlap region midpoint
      const oL = Math.max(bx, rbx), oR = Math.min(bx + bw, rbx + rbw);
      const oT = Math.max(by, rby), oB = Math.min(by + bh, rby + rbh);
      if (oL < oR && oT < oB) {
        rx = (oL + oR) / 2;
        ry = (oT + oB) / 2;
      }
    }
  }

  // Classify X position
  let xPos: number;
  if (rx < bx) xPos = LEFT;
  else if (rx < bx + cw / 2) xPos = LEFT_CORNER;
  else if (rx < bx + bw - cw / 2) xPos = MIDDLE;
  else if (rx < bx + bw) xPos = RIGHT_CORNER;
  else xPos = RIGHT;

  // Classify Y position
  let yPos: number;
  if (ry < by) yPos = TOP;
  else if (ry < by + ch / 2) yPos = TOP_CORNER;
  else if (ry < by + bh - ch / 2) yPos = CENTER;
  else if (ry < by + bh) yPos = BOTTOM_CORNER;
  else yPos = BOTTOM;

  const pos = xPos | yPos;

  // Compute anchor point for each of the 25 position cases
  let ax: number, ay: number;
  let side: string;

  switch (pos) {
    // --- 4 pure corners: anchor at 45° point on corner arc ---
    case LEFT | TOP:
      ax = bx + cw / 2 - COSPI4 * (cw / 2);
      ay = by + ch / 2 - COSPI4 * (ch / 2);
      side = 'tc'; break;
    case RIGHT | TOP:
      ax = bx + bw - cw / 2 + COSPI4 * (cw / 2);
      ay = by + ch / 2 - COSPI4 * (ch / 2);
      side = 'tr'; break;
    case LEFT | BOTTOM:
      ax = bx + cw / 2 - COSPI4 * (cw / 2);
      ay = by + bh - ch / 2 + COSPI4 * (ch / 2);
      side = 'bc'; break;
    case RIGHT | BOTTOM:
      ax = bx + bw - cw / 2 + COSPI4 * (cw / 2);
      ay = by + bh - ch / 2 + COSPI4 * (ch / 2);
      side = 'br'; break;

    // --- 4 straight edges: project reference onto edge ---
    case MIDDLE | TOP:
      ax = rx; ay = by; side = 'tc'; break;
    case MIDDLE | BOTTOM:
      ax = rx; ay = by + bh; side = 'bc'; break;
    case LEFT | CENTER:
      ax = bx; ay = ry; side = 'ml'; break;
    case RIGHT | CENTER:
      ax = bx + bw; ay = ry; side = 'mr'; break;

    // --- 8 corner-edge transitions: anchor on the corner ellipse arc ---
    case LEFT_CORNER | TOP: {
      const dx = bx + cw / 2 - rx;
      ax = rx;
      ay = by + ch / 2 - Math.sin(Math.acos(Math.min(1, dx / (cw / 2)))) * (ch / 2);
      side = 'tc'; break;
    }
    case RIGHT_CORNER | TOP: {
      const dx = bx + bw - cw / 2 - rx;
      ax = rx;
      ay = by + ch / 2 - Math.sin(Math.acos(Math.min(1, Math.abs(dx) / (cw / 2)))) * (ch / 2);
      side = 'tc'; break;
    }
    case LEFT_CORNER | BOTTOM: {
      const dx = bx + cw / 2 - rx;
      ax = rx;
      ay = by + bh - ch / 2 + Math.sin(Math.acos(Math.min(1, dx / (cw / 2)))) * (ch / 2);
      side = 'bc'; break;
    }
    case RIGHT_CORNER | BOTTOM: {
      const dx = bx + bw - cw / 2 - rx;
      ax = rx;
      ay = by + bh - ch / 2 + Math.sin(Math.acos(Math.min(1, Math.abs(dx) / (cw / 2)))) * (ch / 2);
      side = 'bc'; break;
    }
    case LEFT | TOP_CORNER: {
      const dy = by + ch / 2 - ry;
      ax = bx + cw / 2 - Math.cos(Math.asin(Math.min(1, dy / (ch / 2)))) * (cw / 2);
      ay = ry;
      side = 'ml'; break;
    }
    case RIGHT | TOP_CORNER: {
      const dy = by + ch / 2 - ry;
      ax = bx + bw - cw / 2 + Math.cos(Math.asin(Math.min(1, dy / (ch / 2)))) * (cw / 2);
      ay = ry;
      side = 'mr'; break;
    }
    case LEFT | BOTTOM_CORNER: {
      const dy = by + bh - ch / 2 - ry;
      ax = bx + cw / 2 - Math.cos(Math.asin(Math.min(1, Math.abs(dy) / (ch / 2)))) * (cw / 2);
      ay = ry;
      side = 'ml'; break;
    }
    case RIGHT | BOTTOM_CORNER: {
      const dy = by + bh - ch / 2 - ry;
      ax = bx + bw - cw / 2 + Math.cos(Math.asin(Math.min(1, Math.abs(dy) / (ch / 2)))) * (cw / 2);
      ay = ry;
      side = 'mr'; break;
    }

    // --- 8 inner zones (reference inside the element) ---
    // These produce the same result as adjacent straight edges
    case MIDDLE | CENTER:
      ax = bx + bw / 2; ay = by; side = 'tc'; break;
    case LEFT_CORNER | CENTER:
      ax = bx; ay = ry; side = 'ml'; break;
    case RIGHT_CORNER | CENTER:
      ax = bx + bw; ay = ry; side = 'mr'; break;
    case MIDDLE | TOP_CORNER:
      ax = rx; ay = by; side = 'tc'; break;
    case MIDDLE | BOTTOM_CORNER:
      ax = rx; ay = by + bh; side = 'bc'; break;
    case LEFT_CORNER | TOP_CORNER:
      ax = bx; ay = by; side = 'tc'; break;
    case RIGHT_CORNER | TOP_CORNER:
      ax = bx + bw; ay = by; side = 'tr'; break;
    case LEFT_CORNER | BOTTOM_CORNER:
      ax = bx; ay = by + bh; side = 'bc'; break;
    case RIGHT_CORNER | BOTTOM_CORNER:
      ax = bx + bw; ay = by + bh; side = 'br'; break;

    default:
      ax = bx + bw / 2; ay = by; side = 'tc'; break;
  }

  return { x: ax, y: ay, side };
}

/**
 * ChopboxAnchor — smooth line-intersection anchor (Archi's default for connections
 * without USE_ORTHOGONAL_ANCHOR preference). Draws a line from element center to
 * the reference point and finds where it intersects the element boundary.
 * The exit point slides smoothly along edges — no jumping between edges.
 */
function chopboxAnchor(el: ModelElement, ref: Point): Anchor {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const dx = ref.x - cx, dy = ref.y - cy;

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return { x: cx, y: el.y, side: 'tc' };
  }

  const hw = el.w / 2, hh = el.h / 2;
  // Find intersection of center→ref line with rectangle boundary
  // Scale factors to reach each edge
  const tx = hw / Math.abs(dx || 0.001);
  const ty = hh / Math.abs(dy || 0.001);
  const t = Math.min(tx, ty);

  let ix = cx + dx * t;
  let iy = cy + dy * t;

  // Clamp to bounds (numerical safety)
  ix = Math.max(el.x, Math.min(el.x + el.w, ix));
  iy = Math.max(el.y, Math.min(el.y + el.h, iy));

  // Determine side
  let side: string;
  if (Math.abs(iy - el.y) < 0.5) side = 'tc';
  else if (Math.abs(iy - (el.y + el.h)) < 0.5) side = 'bc';
  else if (Math.abs(ix - el.x) < 0.5) side = 'ml';
  else side = 'mr';

  return { x: ix, y: iy, side };
}

/**
 * Snap an arbitrary point to the nearest point on an element's boundary.
 * Used for manually placed anchor points.
 */
function snapToEdge(el: ModelElement, p: Point): Anchor {
  const candidates: { x: number; y: number; side: string; d: number }[] = [];
  const tx = Math.max(el.x, Math.min(el.x + el.w, p.x));
  candidates.push({ x: tx, y: el.y, side: 'tc', d: Math.hypot(p.x - tx, p.y - el.y) });
  const bx = Math.max(el.x, Math.min(el.x + el.w, p.x));
  candidates.push({ x: bx, y: el.y + el.h, side: 'bc', d: Math.hypot(p.x - bx, p.y - (el.y + el.h)) });
  const ly = Math.max(el.y, Math.min(el.y + el.h, p.y));
  candidates.push({ x: el.x, y: ly, side: 'ml', d: Math.hypot(p.x - el.x, p.y - ly) });
  const ry = Math.max(el.y, Math.min(el.y + el.h, p.y));
  candidates.push({ x: el.x + el.w, y: ry, side: 'mr', d: Math.hypot(p.x - (el.x + el.w), p.y - ry) });
  candidates.sort((a, b) => a.d - b.d);
  return { x: candidates[0].x, y: candidates[0].y, side: candidates[0].side };
}

export function getRelPoints(rel: ModelRelationship, elements: ModelElement[], elementMap?: Map<string, ModelElement>): RelPath | null {
  const src = elementMap ? elementMap.get(rel.sourceId) : elements.find(e => e.id === rel.sourceId);
  const tgt = elementMap ? elementMap.get(rel.targetId) : elements.find(e => e.id === rel.targetId);
  if (!src || !tgt) return null;

  const tgtCenter = { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 };
  const srcCenter = { x: src.x + src.w / 2, y: src.y + src.h / 2 };

  // Resolve waypoints: if we have Archi-style relative bendpoints, resolve them
  // dynamically from CURRENT source/target centers. This is how Archi works —
  // bendpoints are offsets, not absolute positions, so they track element movement.
  let waypoints: Point[];
  if (rel.relativeBendpoints && rel.relativeBendpoints.length > 0) {
    const total = rel.relativeBendpoints.length;
    waypoints = rel.relativeBendpoints.map((bp, i) => {
      const weight = (i + 1) / (total + 1);
      const fromSrc = { x: srcCenter.x + bp.startX, y: srcCenter.y + bp.startY };
      const fromTgt = { x: tgtCenter.x + bp.endX, y: tgtCenter.y + bp.endY };
      return {
        x: fromSrc.x * (1 - weight) + fromTgt.x * weight,
        y: fromSrc.y * (1 - weight) + fromTgt.y * weight,
      };
    });
  } else {
    waypoints = (rel.waypoints || []).map(wp => ({ x: wp.x, y: wp.y }));
  }

  let sA: Anchor, tA: Anchor;

  if (waypoints.length > 0) {
    // Connections WITH waypoints: OrthogonalAnchor for clean 90° routing
    sA = rel.sourceAnchor ? snapToEdge(src, rel.sourceAnchor) : orthogonalAnchor(src, waypoints[0]);
    tA = rel.targetAnchor ? snapToEdge(tgt, rel.targetAnchor) : orthogonalAnchor(tgt, waypoints[waypoints.length - 1]);
  } else if (rel.sourceAnchor || rel.targetAnchor) {
    sA = rel.sourceAnchor ? snapToEdge(src, rel.sourceAnchor) : chopboxAnchor(src, tgtCenter);
    tA = rel.targetAnchor ? snapToEdge(tgt, rel.targetAnchor) : chopboxAnchor(tgt, srcCenter);
  } else {
    // Connections WITHOUT waypoints: forced orthogonal routing.
    // Determine dominant axis from element centers and create a straight
    // horizontal or vertical connection that stays on-axis.
    const dx = tgtCenter.x - srcCenter.x;
    const dy = tgtCenter.y - srcCenter.y;

    // Check if elements overlap on each axis
    const overlapX = src.x < tgt.x + tgt.w && tgt.x < src.x + src.w;
    const overlapY = src.y < tgt.y + tgt.h && tgt.y < src.y + src.h;

    if (overlapX && !overlapY) {
      // Vertically stacked — vertical connection at shared X
      const sharedX = Math.max(src.x, tgt.x) + (Math.min(src.x + src.w, tgt.x + tgt.w) - Math.max(src.x, tgt.x)) / 2;
      const clampedSrcX = Math.max(src.x, Math.min(src.x + src.w, sharedX));
      const clampedTgtX = Math.max(tgt.x, Math.min(tgt.x + tgt.w, sharedX));
      if (dy > 0) {
        sA = { x: clampedSrcX, y: src.y + src.h, side: 'bc' };
        tA = { x: clampedTgtX, y: tgt.y, side: 'tc' };
      } else {
        sA = { x: clampedSrcX, y: src.y, side: 'tc' };
        tA = { x: clampedTgtX, y: tgt.y + tgt.h, side: 'bc' };
      }
    } else if (overlapY && !overlapX) {
      // Side by side — horizontal connection at shared Y
      const sharedY = Math.max(src.y, tgt.y) + (Math.min(src.y + src.h, tgt.y + tgt.h) - Math.max(src.y, tgt.y)) / 2;
      const clampedSrcY = Math.max(src.y, Math.min(src.y + src.h, sharedY));
      const clampedTgtY = Math.max(tgt.y, Math.min(tgt.y + tgt.h, sharedY));
      if (dx > 0) {
        sA = { x: src.x + src.w, y: clampedSrcY, side: 'mr' };
        tA = { x: tgt.x, y: clampedTgtY, side: 'ml' };
      } else {
        sA = { x: src.x, y: clampedSrcY, side: 'ml' };
        tA = { x: tgt.x + tgt.w, y: clampedTgtY, side: 'mr' };
      }
    } else {
      // No axis overlap or full overlap — use dominant direction
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Horizontal dominant — exit right/left, shared Y at midpoint
        const midY = (srcCenter.y + tgtCenter.y) / 2;
        const clampedSrcY = Math.max(src.y, Math.min(src.y + src.h, midY));
        const clampedTgtY = Math.max(tgt.y, Math.min(tgt.y + tgt.h, midY));
        if (dx > 0) {
          sA = { x: src.x + src.w, y: clampedSrcY, side: 'mr' };
          tA = { x: tgt.x, y: clampedTgtY, side: 'ml' };
        } else {
          sA = { x: src.x, y: clampedSrcY, side: 'ml' };
          tA = { x: tgt.x + tgt.w, y: clampedTgtY, side: 'mr' };
        }
      } else {
        // Vertical dominant — exit bottom/top, shared X at midpoint
        const midX = (srcCenter.x + tgtCenter.x) / 2;
        const clampedSrcX = Math.max(src.x, Math.min(src.x + src.w, midX));
        const clampedTgtX = Math.max(tgt.x, Math.min(tgt.x + tgt.w, midX));
        if (dy > 0) {
          sA = { x: clampedSrcX, y: src.y + src.h, side: 'bc' };
          tA = { x: clampedTgtX, y: tgt.y, side: 'tc' };
        } else {
          sA = { x: clampedSrcX, y: src.y, side: 'tc' };
          tA = { x: clampedTgtX, y: tgt.y + tgt.h, side: 'bc' };
        }
      }
    }
  }

  return { start: sA, end: tA, waypoints };
}

// Get a point along a polyline at position t (0–1)
export function pointOnPath(allPts: Point[], t: number): Point {
  if (allPts.length < 2) return allPts[0] || { x: 0, y: 0 };

  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    const d = Math.hypot(allPts[i + 1].x - allPts[i].x, allPts[i + 1].y - allPts[i].y);
    segLens.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return allPts[0];

  const targetDist = t * totalLen;
  let accum = 0;
  for (let i = 0; i < segLens.length; i++) {
    if (accum + segLens[i] >= targetDist) {
      const frac = (targetDist - accum) / segLens[i];
      return {
        x: allPts[i].x + (allPts[i + 1].x - allPts[i].x) * frac,
        y: allPts[i].y + (allPts[i + 1].y - allPts[i].y) * frac,
      };
    }
    accum += segLens[i];
  }
  return allPts[allPts.length - 1];
}

// Find nearest t on polyline to a world point
export function nearestTOnPath(allPts: Point[], wx: number, wy: number): number {
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 0; i < allPts.length - 1; i++) {
    const d = Math.hypot(allPts[i + 1].x - allPts[i].x, allPts[i + 1].y - allPts[i].y);
    segLens.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return 0.5;

  let bestT = 0.5;
  let bestDist = Infinity;
  let accum = 0;

  for (let i = 0; i < segLens.length; i++) {
    const a = allPts[i], b = allPts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let ft = len2 === 0 ? 0 : ((wx - a.x) * dx + (wy - a.y) * dy) / len2;
    ft = Math.max(0, Math.min(1, ft));
    const px = a.x + ft * dx, py = a.y + ft * dy;
    const dist = Math.hypot(wx - px, wy - py);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = (accum + ft * segLens[i]) / totalLen;
    }
    accum += segLens[i];
  }
  return Math.max(0.05, Math.min(0.95, bestT));
}

// ============================================================
// Hit testing
// ============================================================

export function hitTestElement(elements: ModelElement[], wx: number, wy: number, _getLayer: (type: string) => string | undefined, _isNote: (type: string) => boolean): ModelElement | null {
  // Elements array is sorted by draw order (back to front).
  // Iterate in reverse to hit the topmost (frontmost) element first.
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (wx >= el.x && wx <= el.x + el.w && wy >= el.y && wy <= el.y + el.h) return el;
  }
  return null;
}

export function hitTestAnchor(elements: ModelElement[], wx: number, wy: number, _getLayer: (type: string) => string | undefined, _isNote: (type: string) => boolean): { elId: string; side: string } | null {
  // Archi-style: detect when cursor is near an element's edge (within margin).
  // Any point on the edge is a valid connection anchor.
  // Iterate in reverse draw order (topmost first).
  const edgeMargin = 8;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const inOuter = wx >= el.x - edgeMargin && wx <= el.x + el.w + edgeMargin &&
                    wy >= el.y - edgeMargin && wy <= el.y + el.h + edgeMargin;
    const inInner = wx > el.x + edgeMargin && wx < el.x + el.w - edgeMargin &&
                    wy > el.y + edgeMargin && wy < el.y + el.h - edgeMargin;
    if (inOuter && !inInner) {
      const snapped = snapToEdge(el, { x: wx, y: wy });
      return { elId: el.id, side: snapped.side };
    }
  }
  return null;
}

/** Hit test start/end endpoint of a relationship. Only checks the given rel (should be the selected one). */
export function hitTestEndpoint(rel: ModelRelationship, elements: ModelElement[], wx: number, wy: number, scale: number = 1): 'source' | 'target' | null {
  const pts = getRelPoints(rel, elements);
  if (!pts) return null;
  const threshold = 10 / Math.max(scale, 0.1);
  if (Math.hypot(pts.start.x - wx, pts.start.y - wy) < threshold) return 'source';
  if (Math.hypot(pts.end.x - wx, pts.end.y - wy) < threshold) return 'target';
  return null;
}

export function hitTestWaypoint(relationships: ModelRelationship[], wx: number, wy: number, scale: number = 1): { relId: string; wpIdx: number } | null {
  const threshold = 8 / Math.max(scale, 0.1);
  for (const r of relationships) {
    if (!r.waypoints) continue;
    for (let i = 0; i < r.waypoints.length; i++) {
      if (Math.hypot(r.waypoints[i].x - wx, r.waypoints[i].y - wy) < threshold) return { relId: r.id, wpIdx: i };
    }
  }
  return null;
}

export function hitTestRelationship(relationships: ModelRelationship[], elements: ModelElement[], wx: number, wy: number, scale: number = 1): RelHit | null {
  let bestHit: RelHit | null = null;
  let bestDistance = Infinity;
  // Keep a consistent ~12 screen-pixel hit area regardless of zoom level
  const threshold = 12 / Math.max(scale, 0.1);

  for (const rel of relationships) {
    const pts = getRelPoints(rel, elements);
    if (!pts) continue;
    const all = [pts.start, ...pts.waypoints, pts.end];
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i], b = all[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 === 0 ? 0 : ((wx - a.x) * dx + (wy - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const distance = Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy));
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        bestHit = { rel, segIdx: i };
      }
    }
  }
  return bestHit;
}

/** Determine if a relationship segment is horizontal or vertical */
export function getSegmentOrientation(rel: ModelRelationship, elements: ModelElement[], segIdx: number, elementMap?: Map<string, ModelElement>): 'h' | 'v' | null {
  const pts = getRelPoints(rel, elements, elementMap);
  if (!pts) return null;
  const all = [pts.start, ...pts.waypoints, pts.end];
  if (segIdx < 0 || segIdx >= all.length - 1) return null;
  const a = all[segIdx], b = all[segIdx + 1];
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  // Horizontal segment → drag moves it vertically; Vertical → drag moves horizontally
  return dx >= dy ? 'h' : 'v';
}

export function hitTestLabel(relationships: ModelRelationship[], elements: ModelElement[], wx: number, wy: number, scale: number = 1): ModelRelationship | null {
  const s = Math.max(scale, 0.1);
  for (const rel of relationships) {
    if (!rel.name) continue;
    const pts = getRelPoints(rel, elements);
    if (!pts) continue;
    const allPts = [pts.start, ...pts.waypoints, pts.end];
    const lp = rel.labelPos ?? 0.5;
    const pt = pointOnPath(allPts, lp);
    if (Math.abs(wx - pt.x) < 40 / s && Math.abs(wy - pt.y) < 12 / s) return rel;
  }
  return null;
}

// ============================================================
// Resize handles
// ============================================================

export function getResizeHandles(el: ModelElement): { handle: ResizeHandle; x: number; y: number }[] {
  const { x, y, w, h } = el;
  return [
    { handle: 'nw', x, y },
    { handle: 'n', x: x + w / 2, y },
    { handle: 'ne', x: x + w, y },
    { handle: 'e', x: x + w, y: y + h / 2 },
    { handle: 'se', x: x + w, y: y + h },
    { handle: 's', x: x + w / 2, y: y + h },
    { handle: 'sw', x, y: y + h },
    { handle: 'w', x, y: y + h / 2 },
  ];
}

export function hitTestResizeHandle(el: ModelElement, wx: number, wy: number): ResizeHandle | null {
  for (const h of getResizeHandles(el)) {
    if (Math.hypot(h.x - wx, h.y - wy) < 9) return h.handle;
  }
  return null;
}

export const HANDLE_CURSORS: Record<ResizeHandle, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
  se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
};

// ============================================================
// Smart-snap: align to other elements' edges & centers
// ============================================================

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;        // world-coordinate of the guide line
  type: 'edge' | 'center';
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

const SNAP_THRESHOLD = 6;

/**
 * Given a dragged element's proposed bounds, snap it to nearby element
 * edges / centers and return the adjusted position + active guides.
 */
export function snapToElements(
  proposed: { x: number; y: number; w: number; h: number },
  others: ModelElement[],
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const guides: SnapGuide[] = [];
  let bestDx: number | null = null;
  let bestDxDist = Infinity;
  let bestDy: number | null = null;
  let bestDyDist = Infinity;

  // Edges and centers of the proposed element
  const pLeft   = proposed.x;
  const pRight  = proposed.x + proposed.w;
  const pCx     = proposed.x + proposed.w / 2;
  const pTop    = proposed.y;
  const pBottom = proposed.y + proposed.h;
  const pCy     = proposed.y + proposed.h / 2;

  for (const other of others) {
    const oLeft   = other.x;
    const oRight  = other.x + other.w;
    const oCx     = other.x + other.w / 2;
    const oTop    = other.y;
    const oBottom = other.y + other.h;
    const oCy     = other.y + other.h / 2;

    // X-axis candidates: left, right, center of proposed vs left, right, center of other
    const xCandidates: { proposed: number; target: number; type: 'edge' | 'center' }[] = [
      { proposed: pLeft,  target: oLeft,  type: 'edge' },
      { proposed: pLeft,  target: oRight, type: 'edge' },
      { proposed: pRight, target: oLeft,  type: 'edge' },
      { proposed: pRight, target: oRight, type: 'edge' },
      { proposed: pCx,    target: oCx,    type: 'center' },
    ];

    for (const c of xCandidates) {
      const dist = Math.abs(c.proposed - c.target);
      if (dist < threshold && dist < bestDxDist) {
        bestDxDist = dist;
        bestDx = c.target - c.proposed;
      }
    }

    // Y-axis candidates
    const yCandidates: { proposed: number; target: number; type: 'edge' | 'center' }[] = [
      { proposed: pTop,    target: oTop,    type: 'edge' },
      { proposed: pTop,    target: oBottom, type: 'edge' },
      { proposed: pBottom, target: oTop,    type: 'edge' },
      { proposed: pBottom, target: oBottom, type: 'edge' },
      { proposed: pCy,     target: oCy,     type: 'center' },
    ];

    for (const c of yCandidates) {
      const dist = Math.abs(c.proposed - c.target);
      if (dist < threshold && dist < bestDyDist) {
        bestDyDist = dist;
        bestDy = c.target - c.proposed;
      }
    }
  }

  const snappedX = bestDx !== null ? proposed.x + bestDx : proposed.x;
  const snappedY = bestDy !== null ? proposed.y + bestDy : proposed.y;

  // Build guide lines for all matching edges at the snapped position
  if (bestDx !== null) {
    const sLeft  = snappedX;
    const sRight = snappedX + proposed.w;
    const sCx    = snappedX + proposed.w / 2;
    for (const other of others) {
      const oLeft  = other.x;
      const oRight = other.x + other.w;
      const oCx    = other.x + other.w / 2;
      if (Math.abs(sLeft - oLeft) < 1 || Math.abs(sLeft - oRight) < 1)   guides.push({ axis: 'x', value: sLeft,  type: 'edge' });
      if (Math.abs(sRight - oLeft) < 1 || Math.abs(sRight - oRight) < 1) guides.push({ axis: 'x', value: sRight, type: 'edge' });
      if (Math.abs(sCx - oCx) < 1)                                        guides.push({ axis: 'x', value: sCx,    type: 'center' });
    }
  }
  if (bestDy !== null) {
    const sTop    = snappedY;
    const sBottom = snappedY + proposed.h;
    const sCy     = snappedY + proposed.h / 2;
    for (const other of others) {
      const oTop    = other.y;
      const oBottom = other.y + other.h;
      const oCy     = other.y + other.h / 2;
      if (Math.abs(sTop - oTop) < 1 || Math.abs(sTop - oBottom) < 1)       guides.push({ axis: 'y', value: sTop,    type: 'edge' });
      if (Math.abs(sBottom - oTop) < 1 || Math.abs(sBottom - oBottom) < 1) guides.push({ axis: 'y', value: sBottom, type: 'edge' });
      if (Math.abs(sCy - oCy) < 1)                                          guides.push({ axis: 'y', value: sCy,     type: 'center' });
    }
  }

  // Deduplicate guides
  const seen = new Set<string>();
  const unique = guides.filter(g => {
    const k = `${g.axis}:${g.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { x: snappedX, y: snappedY, guides: unique };
}

/**
 * Snap during resize — snaps the edges being resized to other element edges.
 * Returns adjusted bounds + guides.
 */
export function snapResizeToElements(
  proposed: { x: number; y: number; w: number; h: number },
  handle: ResizeHandle,
  others: ModelElement[],
  threshold: number = SNAP_THRESHOLD,
  resizingType?: string,
): SnapResult & { w: number; h: number } {
  const guides: SnapGuide[] = [];
  let { x, y, w, h } = proposed;

  const resizingLeft   = handle.includes('w');
  const resizingRight  = handle.includes('e');
  const resizingTop    = handle.includes('n');
  const resizingBottom = handle.includes('s');
  const resizingW = resizingLeft || resizingRight;
  const resizingH = resizingTop || resizingBottom;

  // Phase 1: Snap to SIZE of same-type elements first.
  // When resizing, match the width/height of elements with the same ArchiMate type/layer.
  // This is prioritized over edge alignment.
  let bestWidthSnap: { target: number; dist: number } | null = null;
  let bestHeightSnap: { target: number; dist: number } | null = null;

  if (resizingType) {
    for (const other of others) {
      if (other.type === resizingType) {
        // Match width
        if (resizingW) {
          const d = Math.abs(w - other.w);
          if (d < threshold && d > 0 && (!bestWidthSnap || d < bestWidthSnap.dist)) {
            bestWidthSnap = { target: other.w, dist: d };
          }
        }
        // Match height
        if (resizingH) {
          const d = Math.abs(h - other.h);
          if (d < threshold && d > 0 && (!bestHeightSnap || d < bestHeightSnap.dist)) {
            bestHeightSnap = { target: other.h, dist: d };
          }
        }
      }
    }
  }

  // Also try matching size of ANY element (lower priority — only if no same-type match)
  if (!bestWidthSnap && resizingW) {
    for (const other of others) {
      const d = Math.abs(w - other.w);
      if (d < threshold && d > 0 && (!bestWidthSnap || d < bestWidthSnap.dist)) {
        bestWidthSnap = { target: other.w, dist: d };
      }
    }
  }
  if (!bestHeightSnap && resizingH) {
    for (const other of others) {
      const d = Math.abs(h - other.h);
      if (d < threshold && d > 0 && (!bestHeightSnap || d < bestHeightSnap.dist)) {
        bestHeightSnap = { target: other.h, dist: d };
      }
    }
  }

  // Apply size snaps
  if (bestWidthSnap) {
    if (resizingLeft) { x = x + w - bestWidthSnap.target; }
    w = bestWidthSnap.target;
  }
  if (bestHeightSnap) {
    if (resizingTop) { y = y + h - bestHeightSnap.target; }
    h = bestHeightSnap.target;
  }

  // Phase 2: Snap resizing edges to other element edges/centers
  let bestLeftSnap: { target: number; dist: number } | null = null;
  let bestRightSnap: { target: number; dist: number } | null = null;
  let bestTopSnap: { target: number; dist: number } | null = null;
  let bestBottomSnap: { target: number; dist: number } | null = null;

  const pRight = x + w, pBottom = y + h;

  for (const other of others) {
    const oLeft = other.x, oRight = other.x + other.w;
    const oTop = other.y, oBottom = other.y + other.h;
    const oCx = other.x + other.w / 2, oCy = other.y + other.h / 2;

    if (resizingLeft) {
      for (const t of [oLeft, oRight, oCx]) {
        const d = Math.abs(x - t);
        if (d < threshold && (!bestLeftSnap || d < bestLeftSnap.dist)) bestLeftSnap = { target: t, dist: d };
      }
    }
    if (resizingRight) {
      for (const t of [oLeft, oRight, oCx]) {
        const d = Math.abs(pRight - t);
        if (d < threshold && (!bestRightSnap || d < bestRightSnap.dist)) bestRightSnap = { target: t, dist: d };
      }
    }
    if (resizingTop) {
      for (const t of [oTop, oBottom, oCy]) {
        const d = Math.abs(y - t);
        if (d < threshold && (!bestTopSnap || d < bestTopSnap.dist)) bestTopSnap = { target: t, dist: d };
      }
    }
    if (resizingBottom) {
      for (const t of [oTop, oBottom, oCy]) {
        const d = Math.abs(pBottom - t);
        if (d < threshold && (!bestBottomSnap || d < bestBottomSnap.dist)) bestBottomSnap = { target: t, dist: d };
      }
    }
  }

  // Apply edge snaps (only if closer than size snap)
  if (bestLeftSnap) { const diff = bestLeftSnap.target - x; x += diff; w -= diff; }
  if (bestRightSnap) { w = bestRightSnap.target - x; }
  if (bestTopSnap) { const diff = bestTopSnap.target - y; y += diff; h -= diff; }
  if (bestBottomSnap) { h = bestBottomSnap.target - y; }

  // Build guide lines
  const snappedRight = x + w, snappedBottom = y + h;

  // Size-match guides: show guides on elements whose size was matched
  if (bestWidthSnap) {
    for (const other of others) {
      if (Math.abs(w - other.w) < 1) {
        guides.push({ axis: 'x', value: other.x, type: 'edge' });
        guides.push({ axis: 'x', value: other.x + other.w, type: 'edge' });
      }
    }
  }
  if (bestHeightSnap) {
    for (const other of others) {
      if (Math.abs(h - other.h) < 1) {
        guides.push({ axis: 'y', value: other.y, type: 'edge' });
        guides.push({ axis: 'y', value: other.y + other.h, type: 'edge' });
      }
    }
  }

  // Edge-alignment guides
  for (const other of others) {
    const oLeft = other.x, oRight = other.x + other.w, oCx = other.x + other.w / 2;
    const oTop = other.y, oBottom = other.y + other.h, oCy = other.y + other.h / 2;
    if (bestLeftSnap && (Math.abs(x - oLeft) < 1 || Math.abs(x - oRight) < 1)) guides.push({ axis: 'x', value: x, type: 'edge' });
    if (bestLeftSnap && Math.abs(x - oCx) < 1) guides.push({ axis: 'x', value: x, type: 'center' });
    if (bestRightSnap && (Math.abs(snappedRight - oLeft) < 1 || Math.abs(snappedRight - oRight) < 1)) guides.push({ axis: 'x', value: snappedRight, type: 'edge' });
    if (bestRightSnap && Math.abs(snappedRight - oCx) < 1) guides.push({ axis: 'x', value: snappedRight, type: 'center' });
    if (bestTopSnap && (Math.abs(y - oTop) < 1 || Math.abs(y - oBottom) < 1)) guides.push({ axis: 'y', value: y, type: 'edge' });
    if (bestTopSnap && Math.abs(y - oCy) < 1) guides.push({ axis: 'y', value: y, type: 'center' });
    if (bestBottomSnap && (Math.abs(snappedBottom - oTop) < 1 || Math.abs(snappedBottom - oBottom) < 1)) guides.push({ axis: 'y', value: snappedBottom, type: 'edge' });
    if (bestBottomSnap && Math.abs(snappedBottom - oCy) < 1) guides.push({ axis: 'y', value: snappedBottom, type: 'center' });
  }

  // Also snap to match width/height of other elements
  if (resizingRight || resizingLeft) {
    for (const other of others) {
      if (Math.abs(w - other.w) < threshold) {
        if (resizingRight) w = other.w;
        else { x = x + (proposed.w - other.w); w = other.w; }
        // Don't add a guide for size-match — it's implicit
        break;
      }
    }
  }
  if (resizingBottom || resizingTop) {
    for (const other of others) {
      if (Math.abs(h - other.h) < threshold) {
        if (resizingBottom) h = other.h;
        else { y = y + (proposed.h - other.h); h = other.h; }
        break;
      }
    }
  }

  w = Math.max(60, w);
  h = Math.max(40, h);

  // Deduplicate guides
  const seen = new Set<string>();
  const unique = guides.filter(g => {
    const k = `${g.axis}:${g.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { x, y, w, h, guides: unique };
}

export function hitTestPopout(elements: ModelElement[], wx: number, wy: number): string | null {
  for (const el of elements) {
    if (!el.linkedViewId) continue;
    const px = el.x + el.w - 16, py = el.y + el.h - 16;
    if (Math.hypot(wx - px, wy - py) < 14) return el.linkedViewId;
  }
  return null;
}
