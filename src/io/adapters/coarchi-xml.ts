import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../../core';
import type {
  CanonicalElement,
  CanonicalModelDocument,
  CoArchiFolderEntry,
  CoArchiMetadata,
  CanonicalRelationship,
  CanonicalView,
  CanonicalViewConnection,
  CanonicalViewNode,
} from '../../model/canonical';
import type { ModelDiagnostic } from '../../model/diagnostics';
import type { ModelFormatAdapter, ParseResult, SerializeResult } from '../adapter';

const ELEMENT_TYPE_KEYS = new Set(Object.keys(ELEMENT_TYPES));
const RELATIONSHIP_TYPE_KEYS = new Set(Object.keys(RELATIONSHIP_TYPES));

function localName(node: Element): string {
  return node.localName || node.tagName.split(':').pop() || node.tagName;
}

function getAttr(node: Element, names: string[]): string | undefined {
  for (const name of names) {
    const value = node.getAttribute(name);
    if (value) return value;
  }

  for (const attribute of Array.from(node.attributes)) {
    if (names.includes(attribute.localName) && attribute.value) return attribute.value;
  }

  return undefined;
}

/**
 * Strip path prefix from an href-style value (e.g. "file.xml#id-abc" → "id-abc").
 * If there's no '#', return the value as-is (it's already a plain ID).
 */
function cleanHref(value: string): string {
  // If href contains #, extract the fragment (element ID)
  if (value.includes('#')) return value.replace(/^.*#/, '').trim();
  // If it looks like a file path (contains .xml), try to extract an embedded ID
  // GRAFICO filenames are like "BusinessActor_id-abc123.xml"
  const trimmed = value.trim();
  if (/\.xml$/i.test(trimmed)) {
    const match = trimmed.match(/(id-[0-9a-f-]+)/i);
    if (match) return match[1];
  }
  return trimmed;
}

/**
 * Get a referenced element ID from a child element (GRAFICO format).
 * e.g. <archimateElement href="id-xxx"/> or <archimateElement xsi:type="..." href="id-xxx"/>
 */
function getChildElementRef(node: Element, childNames: string[]): string | undefined {
  for (const child of Array.from(node.children)) {
    const childTag = localName(child).toLowerCase();
    if (childNames.some(n => n.toLowerCase() === childTag)) {
      // Try href attribute first, then xlink:href
      const href = child.getAttribute('href') || child.getAttribute('xlink:href');
      if (href) {
        const cleaned = cleanHref(href);
        return cleaned || undefined;
      }
    }
  }
  return undefined;
}

/**
 * Get a reference ID from either a direct attribute or a child element href (GRAFICO format).
 * Handles both `<node source="id-abc"/>` and `<node><source href="file.xml#id-abc"/></node>`.
 */
function getRef(node: Element, attrNames: string[], childNames?: string[]): string | undefined {
  // First try direct attributes
  const attrVal = getAttr(node, attrNames);
  if (attrVal) return cleanHref(attrVal);
  // Then try child element hrefs
  return getChildElementRef(node, childNames ?? attrNames);
}

function getName(node: Element): string {
  const byAttr = getAttr(node, ['name']);
  if (byAttr) return byAttr;

  for (const child of Array.from(node.children)) {
    if (localName(child).toLowerCase() === 'name') {
      const text = child.textContent?.trim();
      if (text) return text;
    }
  }

  return '';
}

function getDocumentation(node: Element): string {
  const byAttr = getAttr(node, ['documentation']);
  if (byAttr) return byAttr;

  for (const child of Array.from(node.children)) {
    if (localName(child).toLowerCase() === 'documentation') {
      return child.textContent?.trim() || '';
    }
  }

  return '';
}

function getProperties(node: Element): import('../../types').PropertyRecord[] | undefined {
  const properties: import('../../types').PropertyRecord[] = [];

  const candidates: Element[] = [];
  for (const child of Array.from(node.children)) {
    const childName = localName(child).toLowerCase();
    if (childName === 'property') candidates.push(child);
    if (childName === 'properties') {
      for (const prop of Array.from(child.children)) {
        if (localName(prop).toLowerCase() === 'property') candidates.push(prop);
      }
    }
  }

  for (const candidate of candidates) {
    const key = getAttr(candidate, ['key', 'name', 'propertyDefinitionRef']);
    if (!key) continue;

    let value = getAttr(candidate, ['value']) || '';
    if (!value) {
      const valueChild = Array.from(candidate.children).find(child => localName(child).toLowerCase() === 'value');
      value = valueChild?.textContent?.trim() || candidate.textContent?.trim() || '';
    }

    properties.push({ key, value });
  }

  return properties.length > 0 ? properties : undefined;
}

/** Extract text from a <content> child element (used by DiagramModelNote) */
function getContentText(node: Element): string {
  const byAttr = getAttr(node, ['content']);
  if (byAttr) return byAttr;

  for (const child of Array.from(node.children)) {
    if (localName(child).toLowerCase() === 'content') {
      return child.textContent?.trim() || '';
    }
  }

  return '';
}

function extractTypeName(rawType: string | undefined): string {
  if (!rawType) return '';
  const noPrefix = rawType.includes(':') ? rawType.split(':').pop() || '' : rawType;
  return noPrefix.trim();
}

function toCamelLower(name: string): string {
  if (!name) return '';
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function mapElementType(rawType: string | undefined, node?: Element): string | undefined {
  const base = extractTypeName(rawType).replace(/Element$/, '');
  if (!base || /relationship$/i.test(base)) return undefined;
  if (/diagrammodel|diagramobject|diagramconnection|diagramreference/i.test(base)) return undefined;
  // Skip structural/non-element tags that appear in coArchi files
  if (/^(folder|property|feature|metadata|model|children|child|connection|bounds|bendpoint|point|documentation|name|purpose|content|label|source|target)$/i.test(base)) return undefined;

  const candidate = toCamelLower(base);

  // Junction handling: In GRAFICO format, junction fragments use the tag name
  // (e.g. <archimate:Junction>) with a root `type="or"` attribute for subtype.
  // The generic type detection picks up `type="or"` as rawType instead of the tag.
  // Detect junction from either the candidate or the tag name.
  const tagLower = node ? localName(node).toLowerCase() : '';
  if (candidate === 'junction' || tagLower.endsWith('junction')) {
    const junctionType = (node ? getAttr(node, ['type']) : undefined)?.toLowerCase();
    if (junctionType === 'or') return 'orJunction';
    return 'andJunction'; // default junction semantics
  }

  if (ELEMENT_TYPE_KEYS.has(candidate)) return candidate;

  return undefined;
}

function mapRelationshipType(rawType: string | undefined, tagName?: string): string | undefined {
  // Try rawType first, then fall back to tag name
  // (GRAFICO fragments may have a `type` attribute that shadows the tag name)
  for (const src of [rawType, tagName]) {
    const base = extractTypeName(src).replace(/Relationship$/, '');
    if (!base) continue;

    const candidate = toCamelLower(base);
    if (RELATIONSHIP_TYPE_KEYS.has(candidate)) return candidate;

    const aliases: Record<string, string> = {
      usedBy: 'serving',
    };

    if (aliases[candidate]) return aliases[candidate];
  }

  return undefined;
}

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Extract optional visual style metadata from a diagram element */
function parseStyle(node: Element): import('../../model/canonical').DiagramStyle | undefined {
  const fillColor = getAttr(node, ['fillColor']);
  const lineColor = getAttr(node, ['lineColor']);
  const fontColor = getAttr(node, ['fontColor']);
  const font = getAttr(node, ['font']);
  const textAlignment = asNumber(getAttr(node, ['textAlignment']));
  const textPosition = asNumber(getAttr(node, ['textPosition']));
  const lineWidth = asNumber(getAttr(node, ['lineWidth']));
  const lineStyle = getAttr(node, ['lineStyle']);
  const gradient = asNumber(getAttr(node, ['gradient']));
  const alpha = asNumber(getAttr(node, ['alpha']));
  const lineAlpha = asNumber(getAttr(node, ['lineAlpha']));
  const nameVisibleRaw = getAttr(node, ['nameVisible']);
  const nameVisible = nameVisibleRaw === 'false' ? false : nameVisibleRaw === 'true' ? true : undefined;
  const labelExpression = getAttr(node, ['labelExpression']);

  // Only return style object if at least one property was found
  if (fillColor === undefined && lineColor === undefined && fontColor === undefined &&
    font === undefined && textAlignment === undefined && textPosition === undefined &&
    lineWidth === undefined && lineStyle === undefined && gradient === undefined &&
    alpha === undefined && lineAlpha === undefined && nameVisible === undefined &&
    labelExpression === undefined) {
    return undefined;
  }

  return {
    ...(fillColor !== undefined && { fillColor }),
    ...(lineColor !== undefined && { lineColor }),
    ...(fontColor !== undefined && { fontColor }),
    ...(font !== undefined && { font }),
    ...(textAlignment !== undefined && { textAlignment }),
    ...(textPosition !== undefined && { textPosition }),
    ...(lineWidth !== undefined && { lineWidth }),
    ...(lineStyle !== undefined && { lineStyle }),
    ...(gradient !== undefined && { gradient }),
    ...(alpha !== undefined && { alpha }),
    ...(lineAlpha !== undefined && { lineAlpha }),
    ...(nameVisible !== undefined && { nameVisible }),
    ...(labelExpression !== undefined && { labelExpression }),
  };
}

function parseBounds(node: Element): { x: number; y: number; width: number; height: number } | null {
  const x = asNumber(getAttr(node, ['x']));
  const y = asNumber(getAttr(node, ['y']));
  const width = asNumber(getAttr(node, ['w', 'width']));
  const height = asNumber(getAttr(node, ['h', 'height']));

  if (x !== undefined && y !== undefined && width !== undefined && height !== undefined) {
    return { x, y, width, height };
  }

  const packed = getAttr(node, ['bounds']);
  if (packed) {
    const values = packed.split(',').map(part => Number(part.trim()));
    if (values.length === 4 && values.every(Number.isFinite)) {
      return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
  }

  const boundsChild = Array.from(node.children).find(child => localName(child).toLowerCase() === 'bounds');
  if (boundsChild) return parseBounds(boundsChild);

  return null;
}

interface RawBendpoint {
  x?: number;
  y?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

function parseRawBendpoints(node: Element): RawBendpoint[] {
  const bendpoints: RawBendpoint[] = [];

  for (const child of Array.from(node.querySelectorAll('*'))) {
    const childName = localName(child).toLowerCase();
    if (!childName.includes('bendpoint') && childName !== 'point') continue;

    const bp: RawBendpoint = {};
    const absX = asNumber(child.getAttribute('x') ?? undefined);
    const absY = asNumber(child.getAttribute('y') ?? undefined);
    const sX = asNumber(child.getAttribute('startX') ?? undefined);
    const sY = asNumber(child.getAttribute('startY') ?? undefined);
    const eX = asNumber(child.getAttribute('endX') ?? undefined);
    const eY = asNumber(child.getAttribute('endY') ?? undefined);

    const hasRelative = sX !== undefined || sY !== undefined || eX !== undefined || eY !== undefined;

    if (hasRelative) {
      bp.startX = sX ?? 0;
      bp.startY = sY ?? 0;
      bp.endX = eX ?? 0;
      bp.endY = eY ?? 0;
    } else if (absX !== undefined && absY !== undefined) {
      bp.x = absX;
      bp.y = absY;
    } else {
      continue;
    }

    bendpoints.push(bp);
  }

  return bendpoints;
}

function resolveBendpoints(
  raw: RawBendpoint[],
  sourceCenter: { x: number; y: number } | null,
  targetCenter: { x: number; y: number } | null,
): { x: number; y: number }[] {
  const total = raw.length;
  return raw.flatMap((bp, i) => {
    if (bp.x !== undefined && bp.y !== undefined) {
      return [{ x: bp.x, y: bp.y }];
    }
    // Archi uses weighted interpolation: weight = (i+1) / (N+1)
    // For 1 bendpoint: weight=0.5. For 2: weights=0.33,0.67. For 3: 0.25,0.5,0.75.
    if (sourceCenter && targetCenter) {
      const weight = (i + 1) / (total + 1);
      const fromSource = { x: sourceCenter.x + (bp.startX ?? 0), y: sourceCenter.y + (bp.startY ?? 0) };
      const fromTarget = { x: targetCenter.x + (bp.endX ?? 0), y: targetCenter.y + (bp.endY ?? 0) };
      return [{
        x: fromSource.x * (1 - weight) + fromTarget.x * weight,
        y: fromSource.y * (1 - weight) + fromTarget.y * weight,
      }];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Recursive view tree walker — handles nested children with relative coords
// ---------------------------------------------------------------------------

interface PendingConnection {
  id: string;
  viewId: string;
  relationshipId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  rawBendpoints: RawBendpoint[];
  labelPosition: number;
  style?: import('../../model/canonical').DiagramStyle;
}

interface ViewWalkContext {
  viewId: string;
  elementIds: Set<string>;
  relationshipIds: Set<string>;
  viewNodeKeys: Set<string>;
  viewConnectionKeys: Set<string>;
  viewNodes: CanonicalViewNode[];
  viewConnections: CanonicalViewConnection[];
  relationships: CanonicalRelationship[];
  /** Mutable elements array — synthetic elements (notes, view refs, groups) are added here */
  elements: CanonicalElement[];
  /** View name lookup for view references */
  viewNameById: Map<string, string>;
  fallbackIndex: number;
  /** Connections deferred until all nodes are collected */
  pendingConnections: PendingConnection[];
}

/**
 * Recursively walk <children> elements in an Archi view tree.
 * Each child's bounds are RELATIVE to its parent, so we accumulate
 * the parent's absolute offset (parentX, parentY) as we descend.
 */
function walkViewChildren(
  parentEl: Element,
  parentX: number,
  parentY: number,
  ctx: ViewWalkContext,
  parentNodeId?: string,
  depth: number = 0,
): void {
  // Direct <children> (Archi format) or <child> elements
  const childNodes = Array.from(parentEl.children).filter(c => {
    const tag = localName(c).toLowerCase();
    return tag === 'children' || tag === 'child';
  });

  for (const child of childNodes) {
    const bounds = parseBounds(child);
    const absX = parentX + (bounds?.x ?? 0);
    const absY = parentY + (bounds?.y ?? 0);
    const width = bounds?.width ?? 160;
    const height = bounds?.height ?? 72;
    const style = parseStyle(child);

    // Check if this node references a semantic element
    const elementId = getRef(child,
      ['archimateElement', 'elementRef', 'modelElement', 'conceptRef'],
      ['archimateElement', 'elementRef', 'modelElement']);

    if (elementId && ctx.elementIds.has(elementId)) {
      // Use the diagram object's own ID as dedup key to preserve multiple
      // instances of the same semantic element in the same view
      const nodeId = getAttr(child, ['identifier', 'id'])
        || `${ctx.viewId}::${elementId}::${ctx.fallbackIndex}`;
      if (!ctx.viewNodeKeys.has(nodeId)) {
        ctx.viewNodes.push({
          id: nodeId,
          viewId: ctx.viewId,
          elementId,
          x: absX,
          y: absY,
          width,
          height,
          style,
          parentNodeId,
          nestingDepth: depth,
        });
        ctx.viewNodeKeys.add(nodeId);
        ctx.fallbackIndex += 1;
      }
    }

    // Check if this node is a connection — defer resolution until all nodes are collected
    const relId = getRef(child,
      ['archimateRelationship', 'relationshipRef', 'relationship'],
      ['archimateRelationship', 'relationshipRef']);
    if (relId && ctx.relationshipIds.has(relId)) {
      const connId = getAttr(child, ['identifier', 'id'])
        || `${ctx.viewId}::${relId}::${ctx.fallbackIndex}`;
      if (!ctx.viewConnectionKeys.has(connId)) {
        ctx.pendingConnections.push({
          id: connId,
          viewId: ctx.viewId,
          relationshipId: relId,
          sourceNodeId: getAttr(child, ['source', 'sourceRef']),
          targetNodeId: getAttr(child, ['target', 'targetRef']),
          rawBendpoints: parseRawBendpoints(child),
          labelPosition: asNumber(getAttr(child, ['labelPos', 'labelPosition'])) ?? 0.5,
          style,
        });
        ctx.viewConnectionKeys.add(connId);
      }
    }

    // Check for non-semantic diagram objects (view references, notes, groups)
    // These don't reference a semantic element but are visual objects in the diagram.
    if (!elementId || !ctx.elementIds.has(elementId)) {
      const rawType = getAttr(child, ['xsi:type', 'type']) || localName(child);
      const typeLower = extractTypeName(rawType).toLowerCase();
      const diagramObjectId = getAttr(child, ['identifier', 'id']);

      // Type detection: .archimate format uses short names (Group, Note)
      // while coArchi/GRAFICO uses long names (DiagramModelGroup, DiagramModelNote)
      const tagLowerChild = localName(child).toLowerCase();
      const isViewRef = typeLower.includes('diagrammodelreference')
        || tagLowerChild.includes('diagrammodelreference');
      const isNote = typeLower.includes('note') || tagLowerChild.includes('note');
      const isGroup = typeLower.includes('group') || tagLowerChild.includes('group');

      if (isViewRef && diagramObjectId) {
        // View reference — navigable link to another view
        const targetViewId = getAttr(child, ['model', 'viewRef', 'targetView'])
          || getChildElementRef(child, ['model']);
        if (targetViewId) {
          if (!ctx.elementIds.has(diagramObjectId)) {
            const targetName = ctx.viewNameById.get(targetViewId) || 'View';
            ctx.elements.push({
              id: diagramObjectId,
              type: 'viewReference',
              name: targetName,
              documentation: `Navigation reference to view '${targetViewId}'.`,
            });
            ctx.elementIds.add(diagramObjectId);
          }
          if (!ctx.viewNodeKeys.has(diagramObjectId)) {
            ctx.viewNodes.push({
              id: diagramObjectId,
              viewId: ctx.viewId,
              elementId: diagramObjectId,
              x: absX, y: absY, width, height,
              linkedViewId: targetViewId,
              parentNodeId,
              nestingDepth: depth,
            });
            ctx.viewNodeKeys.add(diagramObjectId);
            ctx.fallbackIndex += 1;
          }
        }
      } else if (isNote && diagramObjectId) {
        // Note — free-text annotation
        const noteText = getContentText(child) || getName(child) || 'Note';
        if (!ctx.elementIds.has(diagramObjectId)) {
          ctx.elements.push({
            id: diagramObjectId,
            type: 'note',
            name: noteText,
            documentation: '',
          });
          ctx.elementIds.add(diagramObjectId);
        }
        if (!ctx.viewNodeKeys.has(diagramObjectId)) {
          ctx.viewNodes.push({
            id: diagramObjectId,
            viewId: ctx.viewId,
            elementId: diagramObjectId,
            x: absX, y: absY, width, height,
            parentNodeId,
            nestingDepth: depth,
          });
          ctx.viewNodeKeys.add(diagramObjectId);
          ctx.fallbackIndex += 1;
        }
      } else if (isGroup && diagramObjectId) {
        // Group — visual container
        const groupName = getName(child) || 'Group';
        if (!ctx.elementIds.has(diagramObjectId)) {
          ctx.elements.push({
            id: diagramObjectId,
            type: 'grouping',
            name: groupName,
            documentation: getDocumentation(child),
          });
          ctx.elementIds.add(diagramObjectId);
        }
        if (!ctx.viewNodeKeys.has(diagramObjectId)) {
          ctx.viewNodes.push({
            id: diagramObjectId,
            viewId: ctx.viewId,
            elementId: diagramObjectId,
            x: absX, y: absY, width, height,
            parentNodeId,
            nestingDepth: depth,
          });
          ctx.viewNodeKeys.add(diagramObjectId);
          ctx.fallbackIndex += 1;
        }
      }
    }

    // Recurse into nested children (they'll be offset relative to this node)
    // Determine the current node's ID for parent tracking
    const currentNodeId = (elementId && ctx.elementIds.has(elementId))
      ? (getAttr(child, ['identifier', 'id']) || `${ctx.viewId}::${elementId}::${ctx.fallbackIndex - 1}`)
      : (getAttr(child, ['identifier', 'id']) || parentNodeId);
    walkViewChildren(child, absX, absY, ctx, currentNodeId, depth + 1);
  }

  // Also handle <sourceConnection(s)> / <connection(s)> elements at this level
  // GRAFICO uses plural "sourceConnections" while some formats use singular
  const connectionNodes = Array.from(parentEl.children).filter(c => {
    const tag = localName(c).toLowerCase();
    return tag === 'sourceconnection' || tag === 'sourceconnections'
      || tag === 'connection' || tag === 'connections';
  });

  for (const conn of connectionNodes) {
    const relId = getRef(conn,
      ['archimateRelationship', 'relationshipRef', 'relationship'],
      ['archimateRelationship', 'relationshipRef']);
    if (relId && ctx.relationshipIds.has(relId)) {
      const connId = getAttr(conn, ['identifier', 'id'])
        || `${ctx.viewId}::${relId}::${ctx.fallbackIndex}`;
      if (!ctx.viewConnectionKeys.has(connId)) {
        ctx.pendingConnections.push({
          id: connId,
          viewId: ctx.viewId,
          relationshipId: relId,
          sourceNodeId: getAttr(conn, ['source', 'sourceRef']),
          targetNodeId: getAttr(conn, ['target', 'targetRef']),
          rawBendpoints: parseRawBendpoints(conn),
          labelPosition: asNumber(getAttr(conn, ['labelPos', 'labelPosition'])) ?? 0.5,
          style: parseStyle(conn),
        });
        ctx.viewConnectionKeys.add(connId);
      }
    }
  }
}

/** Pick the node instance closest to an anchor point (squared distance). */
function pickNearestNode(candidates: CanonicalViewNode[], ax: number, ay: number): CanonicalViewNode {
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x + c.width / 2 - ax) ** 2 + (c.y + c.height / 2 - ay) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Resolve all pending connections now that every node position is known */
function resolvePendingViewConnections(ctx: ViewWalkContext): void {
  // Pre-build lookup maps to avoid O(n) .find() per connection
  const relById = new Map(ctx.relationships.map(r => [r.id, r]));
  const nodeById = new Map<string, CanonicalViewNode>();
  const nodesByElementId = new Map<string, CanonicalViewNode[]>();
  for (const vn of ctx.viewNodes) {
    if (vn.viewId !== ctx.viewId) continue;
    nodeById.set(vn.id, vn);
    const arr = nodesByElementId.get(vn.elementId);
    if (arr) arr.push(vn);
    else nodesByElementId.set(vn.elementId, [vn]);
  }

  for (const conn of ctx.pendingConnections) {
    const rel = relById.get(conn.relationshipId);

    // Prefer explicit node IDs; fall back to elementId with proximity selection
    const srcNode = conn.sourceNodeId ? nodeById.get(conn.sourceNodeId) : undefined;
    const tgtNode = conn.targetNodeId ? nodeById.get(conn.targetNodeId) : undefined;

    let resolvedSourceNode = srcNode;
    let resolvedTargetNode = tgtNode;

    if (!resolvedSourceNode && rel) {
      const candidates = nodesByElementId.get(rel.sourceId);
      if (candidates?.length) {
        if (resolvedTargetNode) {
          // Pick source instance closest to the known target
          resolvedSourceNode = pickNearestNode(candidates, resolvedTargetNode.x + resolvedTargetNode.width / 2, resolvedTargetNode.y + resolvedTargetNode.height / 2);
        } else {
          resolvedSourceNode = candidates[0];
        }
      }
    }

    if (!resolvedTargetNode && rel) {
      const candidates = nodesByElementId.get(rel.targetId);
      if (candidates?.length) {
        if (resolvedSourceNode) {
          // Pick target instance closest to the (now resolved) source
          resolvedTargetNode = pickNearestNode(candidates, resolvedSourceNode.x + resolvedSourceNode.width / 2, resolvedSourceNode.y + resolvedSourceNode.height / 2);
        } else {
          resolvedTargetNode = candidates[0];
        }
      }
    }

    let sourceCenter: { x: number; y: number } | null = null;
    let targetCenter: { x: number; y: number } | null = null;
    if (resolvedSourceNode) sourceCenter = { x: resolvedSourceNode.x + resolvedSourceNode.width / 2, y: resolvedSourceNode.y + resolvedSourceNode.height / 2 };
    if (resolvedTargetNode) targetCenter = { x: resolvedTargetNode.x + resolvedTargetNode.width / 2, y: resolvedTargetNode.y + resolvedTargetNode.height / 2 };

    // Preserve raw relative bendpoints for dynamic resolution during drags
    const relativeBendpoints = conn.rawBendpoints
      .filter(bp => bp.startX !== undefined || bp.startY !== undefined || bp.endX !== undefined || bp.endY !== undefined)
      .map(bp => ({ startX: bp.startX ?? 0, startY: bp.startY ?? 0, endX: bp.endX ?? 0, endY: bp.endY ?? 0 }));

    ctx.viewConnections.push({
      id: conn.id,
      viewId: conn.viewId,
      relationshipId: conn.relationshipId,
      sourceNodeId: resolvedSourceNode?.id || conn.sourceNodeId,
      targetNodeId: resolvedTargetNode?.id || conn.targetNodeId,
      waypoints: resolveBendpoints(conn.rawBendpoints, sourceCenter, targetCenter),
      labelPosition: conn.labelPosition,
      style: conn.style,
      relativeBendpoints: relativeBendpoints.length > 0 ? relativeBendpoints : undefined,
    });
  }
}

function parseCoArchiXml(raw: string): ParseResult {
  if (typeof DOMParser === 'undefined') {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'XML_PARSER_UNAVAILABLE',
        message: 'XML parser is not available in this runtime.',
      }],
    };
  }

  const diagnostics: ModelDiagnostic[] = [];
  const document = new DOMParser().parseFromString(raw, 'application/xml');

  const parseError = document.querySelector('parsererror');
  if (parseError) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'COARCHI_XML_PARSE_FAILED',
        message: 'Invalid XML document.',
      }],
    };
  }

  const semanticElements: CanonicalElement[] = [];
  const semanticRelationships: CanonicalRelationship[] = [];
  const views: CanonicalView[] = [];
  const viewNodes: CanonicalViewNode[] = [];
  const viewConnections: CanonicalViewConnection[] = [];

  const elementIds = new Set<string>();
  const relationshipIds = new Set<string>();
  const viewIds = new Set<string>();
  const viewNodeKeys = new Set<string>();
  const viewConnectionKeys = new Set<string>();

  const allNodes = Array.from(document.querySelectorAll('*'));

  for (const node of allNodes) {
    const id = getAttr(node, ['identifier', 'id']);
    if (!id) continue;

    const tag = localName(node);
    const tagLower = tag.toLowerCase();
    // Use xsi:type or type attribute, falling back to the tag name itself
    // (coArchi fragments use the tag name as type, e.g. <archimate:BusinessActor>)
    const rawType = getAttr(node, ['xsi:type', 'type']) || tag;
    const typeName = extractTypeName(rawType).toLowerCase();

    const isRelationshipByTag = tagLower === 'relationship' || tagLower.endsWith('relationship');
    const isRelationshipByType = typeName.endsWith('relationship');

    if (isRelationshipByTag || isRelationshipByType) {
      if (relationshipIds.has(id)) continue;

      const sourceId = getRef(node, ['source', 'sourceRef']);
      const targetId = getRef(node, ['target', 'targetRef']);
      if (!sourceId || !targetId) {
        diagnostics.push({
          severity: 'warning',
          code: 'COARCHI_RELATIONSHIP_SKIPPED_MISSING_ENDPOINTS',
          message: `Skipping relationship '${id}' because source/target is missing.`,
          path: id,
        });
        continue;
      }

      const mappedType = mapRelationshipType(rawType, tag);
      if (!mappedType) {
        diagnostics.push({
          severity: 'warning',
          code: 'COARCHI_RELATIONSHIP_TYPE_FALLBACK',
          message: `Relationship '${id}' uses unknown type '${rawType || 'unknown'}'; mapped to association.`,
          path: id,
        });
      }

      semanticRelationships.push({
        id,
        type: mappedType || 'association',
        sourceId,
        targetId,
        name: getName(node),
        documentation: getDocumentation(node),
        properties: getProperties(node),
      });
      relationshipIds.add(id);
      continue;
    }

    // Skip diagram objects (<child> elements inside views) — they're not semantic elements.
    // In monolithic .archimate format, <child xsi:type="archimate:Note"> or <child xsi:type="archimate:Group">
    // would falsely match 'note'/'grouping' element types if not excluded here.
    if (tagLower === 'child' || tagLower === 'children') continue;

    const mappedType = mapElementType(rawType, node);
    if (!mappedType) continue;
    if (elementIds.has(id)) continue;

    semanticElements.push({
      id,
      type: mappedType,
      name: getName(node) || id,
      documentation: getDocumentation(node),
      properties: getProperties(node),
    });
    elementIds.add(id);
  }

  const viewCandidates = allNodes.filter(node => {
    const id = getAttr(node, ['identifier', 'id']);
    if (!id) return false;

    const tag = localName(node);
    const tagLower = tag.toLowerCase();
    const rawType = getAttr(node, ['xsi:type', 'type']);
    const typeName = extractTypeName(rawType).toLowerCase();

    // Exclude non-view diagram objects (references, notes, groups, child objects, connections)
    const isNonViewDiagramObj = /diagrammodel(reference|note|group)/i.test(tag)
      || /diagrammodel(reference|note|group)/i.test(typeName)
      || /diagramobject|diagramconnection/i.test(typeName);
    if (isNonViewDiagramObj) return false;

    // Match views by tag name OR xsi:type (monolithic .archimate uses <element xsi:type="...DiagramModel">)
    return tagLower === 'view' || /diagrammodel/i.test(tag) || /diagrammodel/i.test(typeName);
  });

  // Build view name lookup for view references
  const viewNameById = new Map<string, string>();
  for (const vc of viewCandidates) {
    const vcId = getAttr(vc, ['identifier', 'id']);
    if (vcId) viewNameById.set(vcId, getName(vc) || vcId);
  }

  for (const viewNode of viewCandidates) {
    const id = getAttr(viewNode, ['identifier', 'id']);
    if (!id || viewIds.has(id)) continue;

    views.push({
      id,
      name: getName(viewNode) || id,
      childViewIds: [],
      documentation: getDocumentation(viewNode),
      properties: getProperties(viewNode),
    });
    viewIds.add(id);

    // Recursively walk the view tree, accumulating parent offsets for relative coordinates
    const walkCtx: ViewWalkContext = {
      viewId: id,
      elementIds,
      relationshipIds,
      viewNodeKeys,
      viewConnectionKeys,
      viewNodes,
      viewConnections,
      relationships: semanticRelationships,
      elements: semanticElements,
      viewNameById,
      fallbackIndex: 0,
      pendingConnections: [],
    };
    // Pass 1: collect all nodes and diagram object positions
    walkViewChildren(viewNode, 0, 0, walkCtx, undefined, 0);
    // Pass 2: resolve connections now that all positions are known
    resolvePendingViewConnections(walkCtx);
  }

  // Build folder hierarchy from <folder> elements in the diagrams section.
  // Folders become pseudo-views (no elementIds) with childViewIds linking to sub-folders and views.
  const viewIdSet = new Set(views.map(v => v.id));
  const viewByIdMap = new Map(views.map(v => [v.id, v]));

  function walkFolderTree(folderEl: Element): string[] {
    const directChildIds: string[] = [];

    for (const child of Array.from(folderEl.children)) {
      const tag = localName(child).toLowerCase();

      if (tag === 'folder') {
        const folderId = getAttr(child, ['id', 'identifier']);
        const folderName = getName(child) || getAttr(child, ['name']) || 'Folder';
        if (!folderId) continue;

        // Recurse into sub-folder first to collect its children
        const subChildIds = walkFolderTree(child);

        // Only create a folder entry if it has children (views or sub-folders)
        if (subChildIds.length > 0) {
          if (!viewIdSet.has(folderId)) {
            views.push({
              id: folderId,
              name: folderName,
              childViewIds: subChildIds,
            });
            viewIdSet.add(folderId);
            viewByIdMap.set(folderId, views[views.length - 1]);
          } else {
            // Folder ID collides with an existing view — update its children
            const existing = viewByIdMap.get(folderId);
            if (existing) existing.childViewIds = subChildIds;
          }
          directChildIds.push(folderId);
        }
      } else {
        // Check if this child is a view (already collected)
        const childId = getAttr(child, ['id', 'identifier']);
        if (childId && viewIdSet.has(childId)) {
          directChildIds.push(childId);
        }
      }
    }

    return directChildIds;
  }

  // Find the top-level diagrams folder(s) and walk them
  const diagramsFolders = allNodes.filter(n => {
    const tag = localName(n).toLowerCase();
    if (tag !== 'folder') return false;
    const type = getAttr(n, ['type']);
    return type === 'diagrams';
  });

  // Track which views end up as children of a folder
  const childViewIdSet = new Set<string>();

  for (const df of diagramsFolders) {
    const topChildIds = walkFolderTree(df);
    for (const cid of topChildIds) childViewIdSet.add(cid);
  }

  // For views that are direct children of the diagrams folder (not inside a sub-folder),
  // they remain as root-level views. Views inside sub-folders are already linked via childViewIds.
  // Mark views that are children of folders so they don't appear as roots.
  // (The Sidebar's getRootViews filters by parentMap, which is built from childViewIds.)

  if (semanticElements.length === 0) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'COARCHI_NO_ELEMENTS_FOUND',
          message: 'No ArchiMate elements were found in the XML file.',
        },
      ],
    };
  }

  return finalizeCoArchiModel(semanticElements, semanticRelationships, views, viewNodes, viewConnections, diagnostics);
}

/** Finalize a coArchi model with fallback view/layout generation */
function finalizeCoArchiModel(
  elements: CanonicalElement[],
  relationships: CanonicalRelationship[],
  views: CanonicalView[],
  viewNodes: CanonicalViewNode[],
  viewConnections: CanonicalViewConnection[],
  diagnostics: ModelDiagnostic[],
  coArchiMetadata?: CoArchiMetadata,
): ParseResult {
  if (views.length === 0) {
    views.push({ id: 'v1', name: 'Imported View', childViewIds: [] });
  }

  if (viewNodes.length === 0) {
    const defaultViewId = views[0].id;
    elements.forEach((element, index) => {
      viewNodes.push({
        id: `${defaultViewId}::${element.id}`,
        viewId: defaultViewId,
        elementId: element.id,
        x: 140 + (index % 10) * 180,
        y: 100 + Math.floor(index / 10) * 120,
        width: 160,
        height: 72,
      });
    });

    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_VIEW_NODES_FALLBACK',
      message: 'No diagram node coordinates found; generated default layout for imported elements.',
    });
  }

  // Pre-group nodes and connections by viewId to avoid O(views × nodes) filtering
  const nodesByViewId = new Map<string, CanonicalViewNode[]>();
  for (const node of viewNodes) {
    if (!nodesByViewId.has(node.viewId)) nodesByViewId.set(node.viewId, []);
    nodesByViewId.get(node.viewId)!.push(node);
  }
  const connectionsByViewId = new Map<string, CanonicalViewConnection[]>();
  for (const conn of viewConnections) {
    if (!connectionsByViewId.has(conn.viewId)) connectionsByViewId.set(conn.viewId, []);
    connectionsByViewId.get(conn.viewId)!.push(conn);
  }

  // Normalize coordinates per view: shift so the top-left of content starts near (50, 50)
  const ORIGIN_PADDING = 50;
  for (const view of views) {
    const nodesInView = nodesByViewId.get(view.id);
    if (!nodesInView || nodesInView.length === 0) continue;

    let minX = Infinity, minY = Infinity;
    for (const n of nodesInView) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
    }
    const dx = ORIGIN_PADDING - minX;
    const dy = ORIGIN_PADDING - minY;

    // Skip if already near origin
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    for (const node of nodesInView) {
      node.x += dx;
      node.y += dy;
    }

    // Shift waypoints for connections in this view by the same offset
    const connectionsInView = connectionsByViewId.get(view.id) ?? [];
    for (const conn of connectionsInView) {
      conn.waypoints = conn.waypoints.map(wp => ({ x: wp.x + dx, y: wp.y + dy }));
    }
  }

  // Remove phantom views — entries that have no diagram content (no viewNodes)
  // and no meaningful name (name is just the raw ID). These are typically
  // structural XML nodes that were incorrectly promoted to views.
  const viewNodeCountById = new Map<string, number>();
  for (const vn of viewNodes) {
    viewNodeCountById.set(vn.viewId, (viewNodeCountById.get(vn.viewId) ?? 0) + 1);
  }
  const filteredViews = views.filter(v => {
    const hasContent = (viewNodeCountById.get(v.id) ?? 0) > 0;
    const hasRealName = v.name !== v.id && !/^id-[0-9a-f]/i.test(v.name);
    return hasContent || hasRealName;
  });
  // If filtering removed all views, keep originals (safety net)
  const finalViews = filteredViews.length > 0 ? filteredViews : views;

  if (views.length !== finalViews.length) {
    diagnostics.push({
      severity: 'info',
      code: 'COARCHI_PHANTOM_VIEWS_REMOVED',
      message: `Removed ${views.length - finalViews.length} empty phantom views (no diagram content and no name).`,
    });
  }

  const model: CanonicalModelDocument = {
    version: 'openarchi-0.1',
    elements,
    relationships,
    views: finalViews,
    viewNodes,
    viewConnections,
    metadata: {
      sourceFormat: 'coarchi-xml',
      ...(coArchiMetadata ? { coArchi: coArchiMetadata } : {}),
    },
  };

  return { model, diagnostics };
}

interface ParsedCoArchiFolderInfo {
  root?: {
    path: string;
    modelName?: string;
    modelId?: string;
    modelVersion?: string;
    modelPurpose?: string;
  };
  folder?: CoArchiFolderEntry;
}

function parseCoArchiFolderInfo(doc: Document, path: string): ParsedCoArchiFolderInfo | null {
  const root = doc.documentElement;
  if (!root) return null;

  const tag = localName(root).toLowerCase();
  if (tag === 'model') {
    let purpose = '';
    for (const child of Array.from(root.children)) {
      if (localName(child).toLowerCase() === 'purpose') {
        purpose = child.textContent?.trim() || '';
        break;
      }
    }
    return {
      root: {
        path,
        modelName: getName(root) || undefined,
        modelId: getAttr(root, ['identifier', 'id']),
        modelVersion: getAttr(root, ['version']),
        modelPurpose: purpose || undefined,
      },
    };
  }

  if (tag === 'folder') {
    return {
      folder: {
        path,
        name: getName(root) || undefined,
        id: getAttr(root, ['identifier', 'id']),
        type: getAttr(root, ['type']),
      },
    };
  }

  return null;
}

function dedupeFolderEntries(folders: CoArchiFolderEntry[]): CoArchiFolderEntry[] {
  const byPath = new Map<string, CoArchiFolderEntry>();
  for (const folder of folders) {
    if (!byPath.has(folder.path)) byPath.set(folder.path, folder);
  }
  return [...byPath.values()];
}

/**
 * Parse a fragmented coArchi directory where each element/relationship/view
 * is stored as an individual XML file (e.g. model/business/*.xml, model/relations/*.xml).
 * Optionally accepts file paths for path-aware hierarchy building.
 */
export function parseCoArchiFragments(xmlContents: string[], filePaths?: string[]): ParseResult {
  if (typeof DOMParser === 'undefined') {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'XML_PARSER_UNAVAILABLE',
        message: 'XML parser is not available in this runtime.',
      }],
    };
  }

  const diagnostics: ModelDiagnostic[] = [];
  const allElements: CanonicalElement[] = [];
  const allRelationships: CanonicalRelationship[] = [];
  const allViews: CanonicalView[] = [];
  const allViewNodes: CanonicalViewNode[] = [];
  const allViewConnections: CanonicalViewConnection[] = [];
  const coArchiFolders: CoArchiFolderEntry[] = [];
  let coArchiRoot: CoArchiMetadata | undefined;

  const elementIdxById = new Map<string, number>();
  const relationshipIdxById = new Map<string, number>();
  const viewIds = new Set<string>();
  const viewNodeKeys = new Set<string>();
  const viewConnectionKeys = new Set<string>();

  // Two-pass approach: first collect all elements and relationships across all
  // files, then process views. This ensures that element/relationship IDs are
  // fully known before views reference them via walkViewChildren.

  // Collect parsed documents and deferred view candidates
  const deferredViews: { doc: Document; node: Element; id: string; path?: string }[] = [];
  let skippedRelCount = 0;
  const skippedRelSample: { id: string; tag: string; sourceId: string; targetId: string; attrs: string }[] = [];
  let duplicateElementCount = 0;
  let duplicateRelCount = 0;

  // Pass 1: collect elements, relationships, and identify views
  for (let fileIdx = 0; fileIdx < xmlContents.length; fileIdx++) {
    const raw = xmlContents[fileIdx];
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    if (doc.querySelector('parsererror')) continue;
    const path = filePaths?.[fileIdx];

    if (path && path.toLowerCase().endsWith('folder.xml')) {
      const folderInfo = parseCoArchiFolderInfo(doc, path);
      if (folderInfo?.root) {
        coArchiRoot = {
          ...coArchiRoot,
          rootFilePath: folderInfo.root.path,
          modelName: folderInfo.root.modelName,
          modelId: folderInfo.root.modelId,
          modelVersion: folderInfo.root.modelVersion,
          modelPurpose: folderInfo.root.modelPurpose,
        };
      } else if (folderInfo?.folder) {
        coArchiFolders.push(folderInfo.folder);
      }
    }

    const allNodes = Array.from(doc.querySelectorAll('*'));

    for (const node of allNodes) {
      const id = getAttr(node, ['identifier', 'id']);
      if (!id) continue;

      const tag = localName(node);
      const tagLower = tag.toLowerCase();
      const rawType = getAttr(node, ['xsi:type', 'type']) || tag;
      const typeName = extractTypeName(rawType).toLowerCase();

      const isRelationshipByTag = tagLower === 'relationship' || tagLower.endsWith('relationship');
      const isRelationshipByType = typeName.endsWith('relationship');

      if (isRelationshipByTag || isRelationshipByType) {
        const sourceId = getRef(node, ['source', 'sourceRef']);
        const targetId = getRef(node, ['target', 'targetRef']);
        if (!sourceId || !targetId) {
          // Track skipped relationships for diagnostics
          if (skippedRelSample.length < 5) skippedRelSample.push({
            id, tag, sourceId: sourceId ?? '(missing)', targetId: targetId ?? '(missing)',
            attrs: Array.from(node.attributes).map(a => `${a.name}=${a.value.slice(0, 40)}`).join(', '),
          });
          skippedRelCount++;
          continue;
        }

        const mappedType = mapRelationshipType(rawType, tag);
        if (!mappedType) {
          diagnostics.push({
            severity: 'warning',
            code: 'COARCHI_RELATIONSHIP_TYPE_FALLBACK',
            message: `Relationship '${id}' uses unknown type '${rawType || 'unknown'}'; mapped to association.`,
            path: id,
          });
        }

        const newRel = {
          id,
          type: mappedType || 'association',
          sourceId,
          targetId,
          name: getName(node),
          documentation: getDocumentation(node),
          properties: getProperties(node),
          sourcePath: path,
        };

        const existingRelIdx = relationshipIdxById.get(id);
        if (existingRelIdx !== undefined) {
          // Prefer the entry with richer metadata
          const existing = allRelationships[existingRelIdx];
          const newRicher = (!existing.documentation && !!newRel.documentation)
            || (newRel.properties?.length ?? 0) > (existing.properties?.length ?? 0);
          if (newRicher) allRelationships[existingRelIdx] = newRel;
          duplicateRelCount++;
        } else {
          relationshipIdxById.set(id, allRelationships.length);
          allRelationships.push(newRel);
        }
        continue;
      }

      // Defer views for pass 2 — match by tag name AND xsi:type.
      // Exclude non-view diagram objects (references, notes, groups, child objects, connections).
      const isNonViewDiagramObj = /diagrammodel(reference|note|group)/i.test(tag)
        || /diagrammodel(reference|note|group)/i.test(typeName)
        || /diagramobject|diagramconnection/i.test(typeName);
      if (!isNonViewDiagramObj &&
        (tagLower === 'view' || /diagrammodel/i.test(tag) || /diagrammodel/i.test(typeName))) {
        if (!viewIds.has(id)) {
          deferredViews.push({ doc, node, id, path: filePaths?.[fileIdx] });
          viewIds.add(id);
        }
        continue;
      }

      // Regular element
      const mappedType = mapElementType(rawType, node);
      if (!mappedType) continue;

      const newEl = {
        id,
        type: mappedType,
        name: getName(node) || id,
        documentation: getDocumentation(node),
        properties: getProperties(node),
        sourcePath: path,
      };

      const existingElIdx = elementIdxById.get(id);
      if (existingElIdx !== undefined) {
        const existing = allElements[existingElIdx];
        const newRicher = (!existing.documentation && !!newEl.documentation)
          || (newEl.properties?.length ?? 0) > (existing.properties?.length ?? 0);
        if (newRicher) allElements[existingElIdx] = newEl;
        duplicateElementCount++;
      } else {
        elementIdxById.set(id, allElements.length);
        allElements.push(newEl);
      }
    }
  }

  // Log skipped relationships (missing source/target) for diagnostics
  if (skippedRelCount > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_REL_MISSING_ENDPOINTS',
      message: `${skippedRelCount} relationships skipped (missing source/target ref). First: ${skippedRelSample[0]?.attrs || 'n/a'}`,
    });
  }
  if (duplicateElementCount > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'COARCHI_DUPLICATE_ELEMENT_IDS',
      message: `${duplicateElementCount} duplicate element IDs encountered; kept richer entry for each.`,
    });
  }
  if (duplicateRelCount > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'COARCHI_DUPLICATE_RELATIONSHIP_IDS',
      message: `${duplicateRelCount} duplicate relationship IDs encountered; kept richer entry for each.`,
    });
  }

  // Pass 2: process views now that all elements and relationships are known
  // Build view name lookup for view references
  const viewNameById = new Map<string, string>();
  for (const dv of deferredViews) {
    viewNameById.set(dv.id, getName(dv.node) || dv.id);
  }

  for (const { node, id, path } of deferredViews) {
    allViews.push({
      id,
      name: getName(node) || id,
      childViewIds: [],
      documentation: getDocumentation(node),
      properties: getProperties(node),
      sourcePath: path,
    });

    const walkCtx: ViewWalkContext = {
      viewId: id,
      elementIds: new Set(elementIdxById.keys()),
      relationshipIds: new Set(relationshipIdxById.keys()),
      viewNodeKeys,
      viewConnectionKeys,
      viewNodes: allViewNodes,
      viewConnections: allViewConnections,
      relationships: allRelationships,
      elements: allElements,
      viewNameById,
      fallbackIndex: 0,
      pendingConnections: [],
    };
    walkViewChildren(node, 0, 0, walkCtx, undefined, 0);
    resolvePendingViewConnections(walkCtx);
  }

  // Build folder hierarchy from file paths (if available) — O(n) with Map
  if (filePaths) {
    // Map: directory path → view ID whose file is directly in that directory
    const viewIdByDir = new Map<string, string>();
    // Map: parent directory → list of child view IDs in subdirectories
    const childViewsByParentDir = new Map<string, string[]>();

    for (const dv of deferredViews) {
      if (!dv.path) continue;
      const dir = dv.path.replace(/\/[^/]+$/, '');
      viewIdByDir.set(dir, dv.id);
      // The grandparent directory is the parent view's directory
      const grandDir = dir.replace(/\/[^/]+$/, '');
      if (grandDir !== dir) {
        if (!childViewsByParentDir.has(grandDir)) childViewsByParentDir.set(grandDir, []);
        childViewsByParentDir.get(grandDir)!.push(dv.id);
      }
    }

    // Assign children to parent views
    for (const dv of deferredViews) {
      if (!dv.path) continue;
      const dir = dv.path.replace(/\/[^/]+$/, '');
      const children = childViewsByParentDir.get(dir);
      if (children) {
        const parentView = allViews.find(v => v.id === dv.id);
        if (parentView) {
          parentView.childViewIds.push(...children);
        }
      }
    }
  }

  if (allElements.length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'COARCHI_NO_ELEMENTS_FOUND',
        message: 'No ArchiMate elements were found in the directory.',
      }],
    };
  }

  // Diagnostic: verify relationship endpoint integrity
  const allElementIds = new Set(elementIdxById.keys());
  const orphanedRels = allRelationships.filter(r => !allElementIds.has(r.sourceId) || !allElementIds.has(r.targetId));
  if (orphanedRels.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_ORPHANED_RELATIONSHIPS',
      message: `${orphanedRels.length} of ${allRelationships.length} relationships reference elements not found in the model.`,
    });
  }

  // Diagnostic: verify view node integrity
  const viewNodesWithoutElement = allViewNodes.filter(vn => !allElementIds.has(vn.elementId));
  if (viewNodesWithoutElement.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_VIEWNODE_MISSING_ELEMENT',
      message: `${viewNodesWithoutElement.length} view nodes reference elements not in the model (synthetic diagram objects are expected).`,
    });
  }

  return finalizeCoArchiModel(
    allElements,
    allRelationships,
    allViews,
    allViewNodes,
    allViewConnections,
    diagnostics,
    {
      ...coArchiRoot,
      folders: dedupeFolderEntries(coArchiFolders),
    },
  );
}

// ---------------------------------------------------------------------------
// Streaming fragmented parser — processes files one at a time to avoid
// holding all raw XML strings + DOM trees in memory simultaneously.
// ---------------------------------------------------------------------------

export type ProgressCallback = (phase: string, current: number, total: number) => void;

/**
 * Streaming version of parseCoArchiFragments for large models (500MB+).
 * Processes files via an async iterator so only one file's raw string and DOM
 * tree are in memory at a time. Peak memory: ~30-50MB instead of ~1.5GB.
 */
export async function parseCoArchiFragmentsStreaming(
  fileIterator: AsyncIterable<{ content: string; path: string }>,
  totalFiles: number,
  onProgress?: ProgressCallback,
): Promise<ParseResult> {
  if (typeof DOMParser === 'undefined') {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'XML_PARSER_UNAVAILABLE',
        message: 'XML parser is not available in this runtime.',
      }],
    };
  }

  const diagnostics: ModelDiagnostic[] = [];
  const allElements: CanonicalElement[] = [];
  const allRelationships: CanonicalRelationship[] = [];
  const allViews: CanonicalView[] = [];
  const allViewNodes: CanonicalViewNode[] = [];
  const allViewConnections: CanonicalViewConnection[] = [];
  const coArchiFolders: CoArchiFolderEntry[] = [];
  let coArchiRoot: CoArchiMetadata | undefined;

  const elementIdxById = new Map<string, number>();
  const relationshipIdxById = new Map<string, number>();
  const viewIds = new Set<string>();
  const viewNodeKeys = new Set<string>();
  const viewConnectionKeys = new Set<string>();

  // Deferred view data: store only the raw XML string (view files are small)
  const deferredViews: { xml: string; path: string; id: string; name: string }[] = [];

  let skippedRelCount = 0;
  const skippedRelSample: { id: string; tag: string; sourceId: string; targetId: string; attrs: string }[] = [];
  let duplicateElementCount = 0;
  let duplicateRelCount = 0;
  let filesProcessed = 0;

  // ---- Pass 1: Stream through all files, extract elements/relationships, defer views ----
  for await (const { content, path } of fileIterator) {
    filesProcessed++;

    const doc = new DOMParser().parseFromString(content, 'application/xml');
    if (doc.querySelector('parsererror')) continue;

    if (path.toLowerCase().endsWith('folder.xml')) {
      const folderInfo = parseCoArchiFolderInfo(doc, path);
      if (folderInfo?.root) {
        coArchiRoot = {
          ...coArchiRoot,
          rootFilePath: folderInfo.root.path,
          modelName: folderInfo.root.modelName,
          modelId: folderInfo.root.modelId,
          modelVersion: folderInfo.root.modelVersion,
          modelPurpose: folderInfo.root.modelPurpose,
        };
      } else if (folderInfo?.folder) {
        coArchiFolders.push(folderInfo.folder);
      }
    }

    const allNodes = Array.from(doc.querySelectorAll('*'));

    for (const node of allNodes) {
      const id = getAttr(node, ['identifier', 'id']);
      if (!id) continue;

      const tag = localName(node);
      const tagLower = tag.toLowerCase();
      const rawType = getAttr(node, ['xsi:type', 'type']) || tag;
      const typeName = extractTypeName(rawType).toLowerCase();

      const isRelationshipByTag = tagLower === 'relationship' || tagLower.endsWith('relationship');
      const isRelationshipByType = typeName.endsWith('relationship');

      if (isRelationshipByTag || isRelationshipByType) {
        const sourceId = getRef(node, ['source', 'sourceRef']);
        const targetId = getRef(node, ['target', 'targetRef']);
        if (!sourceId || !targetId) {
          if (skippedRelSample.length < 5) skippedRelSample.push({
            id, tag, sourceId: sourceId ?? '(missing)', targetId: targetId ?? '(missing)',
            attrs: Array.from(node.attributes).map(a => `${a.name}=${a.value.slice(0, 40)}`).join(', '),
          });
          skippedRelCount++;
          continue;
        }

        const mappedType = mapRelationshipType(rawType, tag);
        if (!mappedType) {
          diagnostics.push({
            severity: 'warning',
            code: 'COARCHI_RELATIONSHIP_TYPE_FALLBACK',
            message: `Relationship '${id}' uses unknown type '${rawType || 'unknown'}'; mapped to association.`,
            path: id,
          });
        }

        const newRel = {
          id,
          type: mappedType || 'association',
          sourceId,
          targetId,
          name: getName(node),
          documentation: getDocumentation(node),
          properties: getProperties(node),
          sourcePath: path,
        };

        const existingRelIdx = relationshipIdxById.get(id);
        if (existingRelIdx !== undefined) {
          const existing = allRelationships[existingRelIdx];
          const newRicher = (!existing.documentation && !!newRel.documentation)
            || (newRel.properties?.length ?? 0) > (existing.properties?.length ?? 0);
          if (newRicher) allRelationships[existingRelIdx] = newRel;
          duplicateRelCount++;
        } else {
          relationshipIdxById.set(id, allRelationships.length);
          allRelationships.push(newRel);
        }
        continue;
      }

      // Detect views — defer for Pass 2
      const isNonViewDiagramObj = /diagrammodel(reference|note|group)/i.test(tag)
        || /diagrammodel(reference|note|group)/i.test(typeName)
        || /diagramobject|diagramconnection/i.test(typeName);
      if (!isNonViewDiagramObj &&
        (tagLower === 'view' || /diagrammodel/i.test(tag) || /diagrammodel/i.test(typeName))) {
        if (!viewIds.has(id)) {
          // Store only raw XML + path (not the DOM tree)
          deferredViews.push({ xml: content, path, id, name: getName(node) || id });
          viewIds.add(id);
        }
        continue;
      }

      // Regular element
      const mappedType = mapElementType(rawType, node);
      if (!mappedType) continue;

      const newEl = {
        id,
        type: mappedType,
        name: getName(node) || id,
        documentation: getDocumentation(node),
        properties: getProperties(node),
        sourcePath: path,
      };

      const existingElIdx = elementIdxById.get(id);
      if (existingElIdx !== undefined) {
        const existing = allElements[existingElIdx];
        const newRicher = (!existing.documentation && !!newEl.documentation)
          || (newEl.properties?.length ?? 0) > (existing.properties?.length ?? 0);
        if (newRicher) allElements[existingElIdx] = newEl;
        duplicateElementCount++;
      } else {
        elementIdxById.set(id, allElements.length);
        allElements.push(newEl);
      }
    }

    // doc and content go out of scope here — GC can reclaim them

    // Yield to event loop every 100 files for GC and UI responsiveness
    if (filesProcessed % 100 === 0) {
      onProgress?.('Reading files', filesProcessed, totalFiles);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.('Reading files', totalFiles, totalFiles);

  if (skippedRelCount > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_REL_MISSING_ENDPOINTS',
      message: `${skippedRelCount} relationships skipped (missing source/target ref). First: ${skippedRelSample[0]?.attrs || 'n/a'}`,
    });
  }
  if (duplicateElementCount > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'COARCHI_DUPLICATE_ELEMENT_IDS',
      message: `${duplicateElementCount} duplicate element IDs encountered; kept richer entry for each.`,
    });
  }
  if (duplicateRelCount > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'COARCHI_DUPLICATE_RELATIONSHIP_IDS',
      message: `${duplicateRelCount} duplicate relationship IDs encountered; kept richer entry for each.`,
    });
  }

  // ---- Pass 2: Process deferred views (re-parse their XML one at a time) ----
  const viewNameById = new Map<string, string>();
  for (const dv of deferredViews) {
    viewNameById.set(dv.id, dv.name);
  }

  for (let vi = 0; vi < deferredViews.length; vi++) {
    const dv = deferredViews[vi];

    // Re-parse just this view's XML
    const viewDoc = new DOMParser().parseFromString(dv.xml, 'application/xml');
    if (viewDoc.querySelector('parsererror')) continue;

    // Find the view root node
    const viewNodes = Array.from(viewDoc.querySelectorAll('*'));
    const viewRoot = viewNodes.find(n => {
      const nId = getAttr(n, ['identifier', 'id']);
      return nId === dv.id;
    });

    allViews.push({
      id: dv.id,
      name: dv.name,
      childViewIds: [],
      documentation: viewRoot ? getDocumentation(viewRoot) : '',
      properties: viewRoot ? getProperties(viewRoot) : undefined,
      sourcePath: dv.path,
    });

    if (viewRoot) {
      const walkCtx: ViewWalkContext = {
        viewId: dv.id,
        elementIds: new Set(elementIdxById.keys()),
        relationshipIds: new Set(relationshipIdxById.keys()),
        viewNodeKeys,
        viewConnectionKeys,
        viewNodes: allViewNodes,
        viewConnections: allViewConnections,
        relationships: allRelationships,
        elements: allElements,
        viewNameById,
        fallbackIndex: 0,
        pendingConnections: [],
      };
      walkViewChildren(viewRoot, 0, 0, walkCtx, undefined, 0);
      resolvePendingViewConnections(walkCtx);
    }

    // Release view XML and DOM
    dv.xml = ''; // Allow GC

    // Yield between views
    if (vi % 10 === 0) {
      onProgress?.('Processing views', vi + 1, deferredViews.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.('Processing views', deferredViews.length, deferredViews.length);

  // Build folder hierarchy from paths — O(n) with Map
  {
    const childViewsByParentDir = new Map<string, string[]>();
    const viewDirById = new Map<string, string>();

    for (const dv of deferredViews) {
      if (!dv.path) continue;
      const dir = dv.path.replace(/\/[^/]+$/, '');
      viewDirById.set(dv.id, dir);
      const grandDir = dir.replace(/\/[^/]+$/, '');
      if (grandDir !== dir) {
        if (!childViewsByParentDir.has(grandDir)) childViewsByParentDir.set(grandDir, []);
        childViewsByParentDir.get(grandDir)!.push(dv.id);
      }
    }

    for (const dv of deferredViews) {
      const dir = viewDirById.get(dv.id);
      if (!dir) continue;
      const children = childViewsByParentDir.get(dir);
      if (children) {
        const parentView = allViews.find(v => v.id === dv.id);
        if (parentView) parentView.childViewIds.push(...children);
      }
    }
  }

  if (allElements.length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'COARCHI_NO_ELEMENTS_FOUND',
        message: 'No ArchiMate elements were found in the directory.',
      }],
    };
  }

  // Diagnostic: verify relationship endpoint integrity
  const allElementIds = new Set(elementIdxById.keys());
  const orphanedRels = allRelationships.filter(r => !allElementIds.has(r.sourceId) || !allElementIds.has(r.targetId));
  if (orphanedRels.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_ORPHANED_RELATIONSHIPS',
      message: `${orphanedRels.length} of ${allRelationships.length} relationships reference elements not found in the model.`,
    });
  }

  onProgress?.('Finalizing', 1, 1);

  return finalizeCoArchiModel(
    allElements,
    allRelationships,
    allViews,
    allViewNodes,
    allViewConnections,
    diagnostics,
    {
      ...coArchiRoot,
      folders: dedupeFolderEntries(coArchiFolders),
    },
  );
}

function serializeCoArchiXml(model: CanonicalModelDocument): SerializeResult {
  // Single-file coArchi serialization: serialize the model as a monolithic XML document.
  // For fragmented directory save, use serializeCoArchiFragmented() instead.
  const result = serializeCoArchiFragmented(model);
  if (result.diagnostics.some(d => d.severity === 'error')) {
    return {
      content: '',
      diagnostics: result.diagnostics,
      mimeType: 'application/xml',
      suggestedFileName: 'model.coarchi.xml',
    };
  }
  // Concatenate all fragment files into a single document (for download)
  const content = result.files.map(f => `<!-- ${f.relativePath} -->\n${f.content}`).join('\n\n');
  return {
    content,
    diagnostics: result.diagnostics,
    mimeType: 'application/xml',
    suggestedFileName: 'model.coarchi.xml',
  };
}

// ---------------------------------------------------------------------------
// Fragmented coArchi/GRAFICO serializer
// ---------------------------------------------------------------------------

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n';
const ARCHIMATE_NS = 'http://www.archimatetool.com/archimate';

/** Convert a camelCase key like "businessActor" to PascalCase "BusinessActor" */
function toPascalCase(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Map an editor element type key back to the Archi XML tag name.
 * e.g. "businessActor" → "BusinessActor", "andJunction" → "Junction", "orJunction" → "Junction"
 */
function elementTypeToXmlTag(type: string): string {
  if (type === 'andJunction' || type === 'orJunction') return 'Junction';
  if (type === 'note') return 'DiagramModelNote';
  if (type === 'grouping') return 'DiagramModelGroup';
  if (type === 'viewReference') return 'DiagramModelReference';
  return toPascalCase(type);
}

/**
 * Map an editor relationship type key back to the Archi XML tag name.
 * e.g. "composition" → "CompositionRelationship"
 */
function relationshipTypeToXmlTag(type: string): string {
  return toPascalCase(type) + 'Relationship';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function styleAttrs(style: import('../../model/canonical').DiagramStyle | undefined): string {
  if (!style) return '';
  let attrs = '';
  if (style.fillColor !== undefined) attrs += ` fillColor="${escapeXml(style.fillColor)}"`;
  if (style.lineColor !== undefined) attrs += ` lineColor="${escapeXml(style.lineColor)}"`;
  if (style.fontColor !== undefined) attrs += ` fontColor="${escapeXml(style.fontColor)}"`;
  if (style.font !== undefined) attrs += ` font="${escapeXml(style.font)}"`;
  if (style.textAlignment !== undefined) attrs += ` textAlignment="${style.textAlignment}"`;
  if (style.textPosition !== undefined) attrs += ` textPosition="${style.textPosition}"`;
  if (style.lineWidth !== undefined) attrs += ` lineWidth="${style.lineWidth}"`;
  if (style.lineStyle !== undefined) attrs += ` lineStyle="${escapeXml(style.lineStyle)}"`;
  if (style.gradient !== undefined) attrs += ` gradient="${style.gradient}"`;
  if (style.alpha !== undefined) attrs += ` alpha="${style.alpha}"`;
  if (style.lineAlpha !== undefined) attrs += ` lineAlpha="${style.lineAlpha}"`;
  if (style.nameVisible === false) attrs += ` nameVisible="false"`;
  if (style.labelExpression !== undefined) attrs += ` labelExpression="${escapeXml(style.labelExpression)}"`;
  return attrs;
}

function propertiesXml(properties: { key: string; value: string }[] | undefined, indent: string): string {
  if (!properties || properties.length === 0) return '';
  let xml = `${indent}<properties>\n`;
  for (const property of properties) {
    xml += `${indent}  <property key="${escapeXml(property.key)}" value="${escapeXml(property.value)}"/>\n`;
  }
  xml += `${indent}</properties>\n`;
  return xml;
}

function getDirName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

function getRootModelFilePath(model: CanonicalModelDocument): string {
  return model.metadata?.coArchi?.rootFilePath || 'model/folder.xml';
}

function getDefaultFolderXmlPath(model: CanonicalModelDocument, folderName: string): string {
  const rootDir = getDirName(getRootModelFilePath(model)) || 'model';
  return `${rootDir}/${folderName}/folder.xml`;
}

function getFolderEntryMaps(model: CanonicalModelDocument): {
  byPath: Map<string, CoArchiFolderEntry>;
  byType: Map<string, CoArchiFolderEntry>;
} {
  const byPath = new Map<string, CoArchiFolderEntry>();
  const byType = new Map<string, CoArchiFolderEntry>();
  for (const folder of model.metadata?.coArchi?.folders || []) {
    if (!byPath.has(folder.path)) byPath.set(folder.path, folder);
    if (folder.type && !byType.has(folder.type)) byType.set(folder.type, folder);
  }
  return { byPath, byType };
}

function buildFolderEntry(
  folderXmlPath: string,
  defaults: { name: string; id: string; type: string },
  folderByPath: Map<string, CoArchiFolderEntry>,
  folderByType: Map<string, CoArchiFolderEntry>,
): CoArchiFolderEntry {
  return folderByPath.get(folderXmlPath)
    || folderByType.get(defaults.type)
    || {
      path: folderXmlPath,
      name: defaults.name,
      id: defaults.id,
      type: defaults.type,
    };
}

/**
 * Serialize a CanonicalModelDocument into the GRAFICO fragmented directory format.
 * Returns a list of { relativePath, content } pairs to be written to disk.
 */
export function serializeCoArchiFragmented(model: CanonicalModelDocument): import('../adapter').FragmentedSerializeResult {
  const files: { relativePath: string; content: string }[] = [];
  const diagnostics: import('../../model/diagnostics').ModelDiagnostic[] = [];
  const requiredFolders = new Map<string, CoArchiFolderEntry>();
  const { byPath: folderByPath, byType: folderByType } = getFolderEntryMaps(model);
  const rootFilePath = getRootModelFilePath(model);
  const rootMeta = model.metadata?.coArchi;

  // Root folder.xml
  files.push({
    relativePath: rootFilePath,
    content: XML_HEADER +
      `<archimate:model xmlns:archimate="${ARCHIMATE_NS}"\n` +
      `    name="${escapeXml(rootMeta?.modelName || 'OpenArchi Model')}"\n` +
      `    id="${escapeXml(rootMeta?.modelId || 'model-root')}"\n` +
      `    version="${escapeXml(rootMeta?.modelVersion || '5.0.0')}">\n` +
      `  <purpose>${escapeXml(rootMeta?.modelPurpose || '')}</purpose>\n` +
      `</archimate:model>\n`,
  });

  // Element folder structure by layer
  const elementsByLayer = new Map<string, typeof model.elements>();
  for (const el of model.elements) {
    // Skip synthetic diagram-only elements (notes, groups, view references)
    if (el.type === 'note' || el.type === 'grouping' || el.type === 'viewReference') continue;
    const layer = ELEMENT_TYPES[el.type]?.layer ?? 'other';
    if (!elementsByLayer.has(layer)) elementsByLayer.set(layer, []);
    elementsByLayer.get(layer)!.push(el);
  }

  // Map layer names to GRAFICO folder names
  const layerFolderMap: Record<string, string> = {
    strategy: 'strategy',
    business: 'business',
    application: 'application',
    technology: 'technology',
    motivation: 'motivation',
    implementation: 'implementation_migration',
    composite: 'other',
  };

  function registerFolder(folderXmlPath: string, defaults: { name: string; id: string; type: string }): void {
    if (requiredFolders.has(folderXmlPath)) return;
    requiredFolders.set(folderXmlPath, buildFolderEntry(folderXmlPath, defaults, folderByPath, folderByType));
  }

  for (const [layer, elements] of elementsByLayer) {
    const folder = layerFolderMap[layer] ?? 'other';
    const defaultFolderXmlPath = getDefaultFolderXmlPath(model, folder);
    registerFolder(defaultFolderXmlPath, {
      name: toPascalCase(layer),
      id: `folder-${folder}`,
      type: folder,
    });

    for (const el of elements) {
      const tag = elementTypeToXmlTag(el.type);
      const elementPath = el.sourcePath || `${getDirName(defaultFolderXmlPath)}/${tag}_${el.id}.xml`;
      registerFolder(`${getDirName(elementPath)}/folder.xml`, {
        name: toPascalCase(layer),
        id: `folder-${folder}`,
        type: folder,
      });
      let xml = XML_HEADER +
        `<archimate:${tag} xmlns:archimate="${ARCHIMATE_NS}"\n` +
        `    name="${escapeXml(el.name)}"\n` +
        `    id="${escapeXml(el.id)}"`;

      // Junction subtype
      if (el.type === 'andJunction') {
        xml += `\n    type="and"`;
      } else if (el.type === 'orJunction') {
        xml += `\n    type="or"`;
      }

      const hasChildren = !!el.documentation || !!(el.properties && el.properties.length > 0);
      if (hasChildren) {
        xml += `>\n`;
        if (el.documentation) {
          xml += `  <documentation>${escapeXml(el.documentation)}</documentation>\n`;
        }
        xml += propertiesXml(el.properties, '  ');
        xml += `</archimate:${tag}>\n`;
      } else {
        xml += `/>\n`;
      }

      files.push({
        relativePath: elementPath,
        content: xml,
      });
    }
  }

  // Relations folder
  if (model.relationships.length > 0) {
    const defaultRelationsFolderPath = getDefaultFolderXmlPath(model, 'relations');
    registerFolder(defaultRelationsFolderPath, {
      name: 'Relations',
      id: 'folder-relations',
      type: 'relations',
    });

    for (const rel of model.relationships) {
      const tag = relationshipTypeToXmlTag(rel.type);
      const relationPath = rel.sourcePath || `${getDirName(defaultRelationsFolderPath)}/${tag}_${rel.id}.xml`;
      registerFolder(`${getDirName(relationPath)}/folder.xml`, {
        name: 'Relations',
        id: 'folder-relations',
        type: 'relations',
      });
      let xml = XML_HEADER +
        `<archimate:${tag} xmlns:archimate="${ARCHIMATE_NS}"\n` +
        `    name="${escapeXml(rel.name)}"\n` +
        `    id="${escapeXml(rel.id)}"\n` +
        `    source="${escapeXml(rel.sourceId)}"\n` +
        `    target="${escapeXml(rel.targetId)}"`;
      const hasChildren = !!rel.documentation || !!(rel.properties && rel.properties.length > 0);
      if (hasChildren) {
        xml += `>\n`;
        if (rel.documentation) {
          xml += `  <documentation>${escapeXml(rel.documentation)}</documentation>\n`;
        }
        xml += propertiesXml(rel.properties, '  ');
        xml += `</archimate:${tag}>\n`;
      } else {
        xml += `/>\n`;
      }

      files.push({
        relativePath: relationPath,
        content: xml,
      });
    }
  }

  // Views folder
  if (model.views.length > 0) {
    const defaultViewsFolderPath = getDefaultFolderXmlPath(model, 'views');
    registerFolder(defaultViewsFolderPath, {
      name: 'Views',
      id: 'folder-views',
      type: 'diagrams',
    });

    for (const view of model.views) {
      const viewPath = view.sourcePath || `${getDirName(defaultViewsFolderPath)}/${view.id}.xml`;
      registerFolder(`${getDirName(viewPath)}/folder.xml`, {
        name: 'Views',
        id: 'folder-views',
        type: 'diagrams',
      });
      const viewNodes = model.viewNodes.filter(vn => vn.viewId === view.id);
      const viewConnections = model.viewConnections.filter(vc => vc.viewId === view.id);

      // Build nesting hierarchy: group nodes by parent
      const childrenByParent = new Map<string | undefined, typeof viewNodes>();
      for (const vn of viewNodes) {
        const parentKey = vn.parentNodeId ?? undefined;
        if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, []);
        childrenByParent.get(parentKey)!.push(vn);
      }

      // Build connection lookup by source element
      const connectionsBySourceNodeId = new Map<string, typeof viewConnections>();
      for (const vc of viewConnections) {
        const sourceNodeId = vc.sourceNodeId
          || viewNodes.find(vn => {
            const rel = model.relationships.find(r => r.id === vc.relationshipId);
            return vn.elementId === rel?.sourceId;
          })?.id;
        if (!sourceNodeId) continue;
        if (!connectionsBySourceNodeId.has(sourceNodeId)) connectionsBySourceNodeId.set(sourceNodeId, []);
        connectionsBySourceNodeId.get(sourceNodeId)!.push(vc);
      }

      function serializeViewNode(vn: CanonicalViewNode, indent: string): string {
        const el = model.elements.find(e => e.id === vn.elementId);
        const isNote = el?.type === 'note';
        const isGroup = el?.type === 'grouping';
        const isViewRef = el?.type === 'viewReference';

        let xsiType: string;
        if (isNote) xsiType = 'archimate:DiagramModelNote';
        else if (isGroup) xsiType = 'archimate:DiagramModelGroup';
        else if (isViewRef) xsiType = 'archimate:DiagramModelReference';
        else xsiType = 'archimate:DiagramModelArchimateObject';

        let line = `${indent}<children xsi:type="${xsiType}"`;
        line += ` id="${escapeXml(vn.id)}"`;

        if (!isNote && !isGroup && !isViewRef) {
          line += ` archimateElement="${escapeXml(vn.elementId)}"`;
        }
        if (isViewRef && vn.linkedViewId) {
          line += ` model="${escapeXml(vn.linkedViewId)}"`;
        }
        if (isNote && el) {
          line += ` content="${escapeXml(el.name)}"`;
        }
        if (isGroup && el) {
          line += ` name="${escapeXml(el.name)}"`;
        }
        line += styleAttrs(vn.style);

        // Children of this node
        const nestedChildren = childrenByParent.get(vn.id) ?? [];
        // Source connections from this node's element
        const nodeConnections = connectionsBySourceNodeId.get(vn.id) ?? [];

        const hasChildren = nestedChildren.length > 0 || nodeConnections.length > 0;

        if (hasChildren) {
          line += `>\n`;
          line += `${indent}  <bounds x="${Math.round(vn.x)}" y="${Math.round(vn.y)}" width="${Math.round(vn.width)}" height="${Math.round(vn.height)}"/>\n`;

          for (const conn of nodeConnections) {
            line += serializeConnection(conn, indent + '  ');
          }
          for (const child of nestedChildren) {
            line += serializeViewNode(child, indent + '  ');
          }
          line += `${indent}</children>\n`;
        } else {
          line += `>\n`;
          line += `${indent}  <bounds x="${Math.round(vn.x)}" y="${Math.round(vn.y)}" width="${Math.round(vn.width)}" height="${Math.round(vn.height)}"/>\n`;
          line += `${indent}</children>\n`;
        }

        return line;
      }

      function serializeConnection(vc: CanonicalViewConnection, indent: string): string {
        const rel = model.relationships.find(r => r.id === vc.relationshipId);
        let line = `${indent}<sourceConnections xsi:type="archimate:DiagramModelArchimateConnection"`;
        line += ` id="${escapeXml(vc.id)}"`;
        // Source and target diagram node references
        const srcNode = (vc.sourceNodeId && viewNodes.find(vn => vn.id === vc.sourceNodeId))
          || viewNodes.find(vn => vn.elementId === rel?.sourceId);
        const tgtNode = (vc.targetNodeId && viewNodes.find(vn => vn.id === vc.targetNodeId))
          || viewNodes.find(vn => vn.elementId === rel?.targetId);
        if (srcNode) line += ` source="${escapeXml(srcNode.id)}"`;
        if (tgtNode) line += ` target="${escapeXml(tgtNode.id)}"`;
        line += ` archimateRelationship="${escapeXml(vc.relationshipId)}"`;
        line += styleAttrs(vc.style);

        // Bendpoints
        const bendpoints = vc.relativeBendpoints ?? [];
        if (bendpoints.length > 0) {
          line += `>\n`;
          for (const bp of bendpoints) {
            line += `${indent}  <bendpoints startX="${Math.round(bp.startX)}" startY="${Math.round(bp.startY)}" endX="${Math.round(bp.endX)}" endY="${Math.round(bp.endY)}"/>\n`;
          }
          line += `${indent}</sourceConnections>\n`;
        } else {
          line += `/>\n`;
        }

        return line;
      }

      // Build the view XML
      let xml = XML_HEADER +
        `<archimate:ArchimateDiagramModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
        `    xmlns:archimate="${ARCHIMATE_NS}"\n` +
        `    name="${escapeXml(view.name)}"\n` +
        `    id="${escapeXml(view.id)}">\n`;

      if (view.documentation) {
        xml += `  <documentation>${escapeXml(view.documentation)}</documentation>\n`;
      }
      xml += propertiesXml(view.properties, '  ');

      // Serialize top-level nodes (no parent)
      const topLevel = childrenByParent.get(undefined) ?? [];
      for (const vn of topLevel) {
        xml += serializeViewNode(vn, '  ');
      }

      xml += `</archimate:ArchimateDiagramModel>\n`;

      files.push({
        relativePath: viewPath,
        content: xml,
      });
    }
  }

  for (const folder of [...requiredFolders.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    files.push({
      relativePath: folder.path,
      content: XML_HEADER +
        `<archimate:Folder xmlns:archimate="${ARCHIMATE_NS}"\n` +
        `    name="${escapeXml(folder.name || 'Folder')}"\n` +
        `    id="${escapeXml(folder.id || `folder-${folder.type || 'default'}`)}"\n` +
        (folder.type ? `    type="${escapeXml(folder.type)}">\n` : '>\n') +
        `</archimate:Folder>\n`,
    });
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return { files, diagnostics, document: model };
}

export const coArchiXmlAdapter: ModelFormatAdapter = {
  id: 'coarchi-xml',
  label: 'coArchi XML',
  extensions: ['xml', 'coarchi'],
  mimeTypes: ['application/xml', 'text/xml'],
  parse: parseCoArchiXml,
  serialize: serializeCoArchiXml,
};
