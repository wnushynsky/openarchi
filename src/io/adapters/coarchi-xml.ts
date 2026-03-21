import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../../core';
import type {
  CanonicalElement,
  CanonicalModelDocument,
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
  return raw.flatMap(bp => {
    if (bp.x !== undefined && bp.y !== undefined) {
      return [{ x: bp.x, y: bp.y }];
    }
    if (sourceCenter && targetCenter) {
      const fromSource = { x: sourceCenter.x + (bp.startX ?? 0), y: sourceCenter.y + (bp.startY ?? 0) };
      const fromTarget = { x: targetCenter.x + (bp.endX ?? 0), y: targetCenter.y + (bp.endY ?? 0) };
      return [{ x: (fromSource.x + fromTarget.x) / 2, y: (fromSource.y + fromTarget.y) / 2 }];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Recursive view tree walker — handles nested children with relative coords
// ---------------------------------------------------------------------------

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
        });
        ctx.viewNodeKeys.add(nodeId);
        ctx.fallbackIndex += 1;
      }
    }

    // Check if this node is a connection
    const relId = getRef(child,
      ['archimateRelationship', 'relationshipRef', 'relationship'],
      ['archimateRelationship', 'relationshipRef']);
    if (relId && ctx.relationshipIds.has(relId)) {
      const connId = getAttr(child, ['identifier', 'id'])
        || `${ctx.viewId}::${relId}::${ctx.fallbackIndex}`;
      if (!ctx.viewConnectionKeys.has(connId)) {
        const rawBendpoints = parseRawBendpoints(child);
        const rel = ctx.relationships.find(r => r.id === relId);
        let sourceCenter: { x: number; y: number } | null = null;
        let targetCenter: { x: number; y: number } | null = null;
        if (rel) {
          const srcNode = ctx.viewNodes.find(vn => vn.viewId === ctx.viewId && vn.elementId === rel.sourceId);
          const tgtNode = ctx.viewNodes.find(vn => vn.viewId === ctx.viewId && vn.elementId === rel.targetId);
          if (srcNode) sourceCenter = { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height / 2 };
          if (tgtNode) targetCenter = { x: tgtNode.x + tgtNode.width / 2, y: tgtNode.y + tgtNode.height / 2 };
        }

        ctx.viewConnections.push({
          id: connId,
          viewId: ctx.viewId,
          relationshipId: relId,
          waypoints: resolveBendpoints(rawBendpoints, sourceCenter, targetCenter),
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

      if (typeLower.includes('diagrammodelreference') && diagramObjectId) {
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
            });
            ctx.viewNodeKeys.add(diagramObjectId);
            ctx.fallbackIndex += 1;
          }
        }
      } else if (typeLower.includes('diagrammodelnote') && diagramObjectId) {
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
          });
          ctx.viewNodeKeys.add(diagramObjectId);
          ctx.fallbackIndex += 1;
        }
      } else if (typeLower.includes('diagrammodelgroup') && diagramObjectId) {
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
          });
          ctx.viewNodeKeys.add(diagramObjectId);
          ctx.fallbackIndex += 1;
        }
      }
    }

    // Recurse into nested children (they'll be offset relative to this node)
    walkViewChildren(child, absX, absY, ctx);
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
        const rawBendpoints = parseRawBendpoints(conn);
        const rel = ctx.relationships.find(r => r.id === relId);
        let sourceCenter: { x: number; y: number } | null = null;
        let targetCenter: { x: number; y: number } | null = null;
        if (rel) {
          const srcNode = ctx.viewNodes.find(vn => vn.viewId === ctx.viewId && vn.elementId === rel.sourceId);
          const tgtNode = ctx.viewNodes.find(vn => vn.viewId === ctx.viewId && vn.elementId === rel.targetId);
          if (srcNode) sourceCenter = { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height / 2 };
          if (tgtNode) targetCenter = { x: tgtNode.x + tgtNode.width / 2, y: tgtNode.y + tgtNode.height / 2 };
        }

        ctx.viewConnections.push({
          id: connId,
          viewId: ctx.viewId,
          relationshipId: relId,
          waypoints: resolveBendpoints(rawBendpoints, sourceCenter, targetCenter),
          labelPosition: asNumber(getAttr(conn, ['labelPos', 'labelPosition'])) ?? 0.5,
          style: parseStyle(conn),
        });
        ctx.viewConnectionKeys.add(connId);
      }
    }
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
      });
      relationshipIds.add(id);
      continue;
    }

    const mappedType = mapElementType(rawType, node);
    if (!mappedType) continue;
    if (elementIds.has(id)) continue;

    semanticElements.push({
      id,
      type: mappedType,
      name: getName(node) || id,
      documentation: getDocumentation(node),
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
    };
    walkViewChildren(viewNode, 0, 0, walkCtx);
  }

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

  // Normalize coordinates per view: shift so the top-left of content starts near (50, 50)
  const ORIGIN_PADDING = 50;
  const viewIdSet = new Set(views.map(v => v.id));
  for (const viewId of viewIdSet) {
    const nodesInView = viewNodes.filter(n => n.viewId === viewId);
    if (nodesInView.length === 0) continue;

    const minX = Math.min(...nodesInView.map(n => n.x));
    const minY = Math.min(...nodesInView.map(n => n.y));
    const dx = ORIGIN_PADDING - minX;
    const dy = ORIGIN_PADDING - minY;

    // Skip if already near origin
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

    for (const node of nodesInView) {
      node.x += dx;
      node.y += dy;
    }

    // Shift waypoints for connections in this view by the same offset
    const connectionsInView = viewConnections.filter(c => c.viewId === viewId);
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
    },
  };

  return { model, diagnostics };
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

  const elementIds = new Set<string>();
  const relationshipIds = new Set<string>();
  const viewIds = new Set<string>();
  const viewNodeKeys = new Set<string>();
  const viewConnectionKeys = new Set<string>();

  // Two-pass approach: first collect all elements and relationships across all
  // files, then process views. This ensures that element/relationship IDs are
  // fully known before views reference them via walkViewChildren.

  // Collect parsed documents and deferred view candidates
  const parsedDocs: Document[] = [];
  const deferredViews: { doc: Document; node: Element; id: string; path?: string }[] = [];
  let skippedRelCount = 0;
  const skippedRelSample: { id: string; tag: string; sourceId: string; targetId: string; attrs: string }[] = [];

  // Pass 1: collect elements, relationships, and identify views
  for (let fileIdx = 0; fileIdx < xmlContents.length; fileIdx++) {
    const raw = xmlContents[fileIdx];
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    if (doc.querySelector('parsererror')) continue;
    parsedDocs.push(doc);

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
        if (relationshipIds.has(id)) continue;

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

        allRelationships.push({
          id,
          type: mappedType || 'association',
          sourceId,
          targetId,
          name: getName(node),
        });
        relationshipIds.add(id);
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
      if (elementIds.has(id)) continue;

      allElements.push({
        id,
        type: mappedType,
        name: getName(node) || id,
        documentation: getDocumentation(node),
      });
      elementIds.add(id);
    }
  }

  // Log skipped relationships (missing source/target) for diagnostics
  if (skippedRelCount > 0) {
    console.warn('[OpenArchi] Skipped', skippedRelCount, 'relationships with missing source/target. Sample:', skippedRelSample);
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_REL_MISSING_ENDPOINTS',
      message: `${skippedRelCount} relationships skipped (missing source/target ref). First: ${skippedRelSample[0]?.attrs || 'n/a'}`,
    });
  }

  // Pass 2: process views now that all elements and relationships are known
  // Build view name lookup for view references
  const viewNameById = new Map<string, string>();
  for (const dv of deferredViews) {
    viewNameById.set(dv.id, getName(dv.node) || dv.id);
  }

  // Log deferred views for debugging
  if (deferredViews.length > 0) {
    const sample = deferredViews.slice(0, 10).map(dv => ({
      id: dv.id,
      tag: localName(dv.node),
      name: getName(dv.node),
      type: getAttr(dv.node, ['xsi:type', 'type']),
      path: dv.path,
    }));
    console.log('[OpenArchi] Deferred view candidates:', deferredViews.length, 'total. Sample:', sample);
  }

  for (const { node, id } of deferredViews) {
    allViews.push({
      id,
      name: getName(node) || id,
      childViewIds: [],
    });

    const walkCtx: ViewWalkContext = {
      viewId: id,
      elementIds,
      relationshipIds,
      viewNodeKeys,
      viewConnectionKeys,
      viewNodes: allViewNodes,
      viewConnections: allViewConnections,
      relationships: allRelationships,
      elements: allElements,
      viewNameById,
      fallbackIndex: 0,
    };
    walkViewChildren(node, 0, 0, walkCtx);
  }

  // Build folder hierarchy from file paths (if available)
  if (filePaths) {
    const viewPathById = new Map<string, string>();
    for (const dv of deferredViews) {
      if (dv.path) viewPathById.set(dv.id, dv.path);
    }

    // For each view, find views whose path is a direct child directory
    const viewById = new Map(allViews.map(v => [v.id, v]));
    for (const parentView of allViews) {
      const parentPath = viewPathById.get(parentView.id);
      if (!parentPath) continue;
      // Parent directory of this view file
      const parentDir = parentPath.replace(/\/[^/]+$/, '');

      for (const childView of allViews) {
        if (childView.id === parentView.id) continue;
        const childPath = viewPathById.get(childView.id);
        if (!childPath) continue;
        // Child's grandparent directory should match parent's directory
        const childDir = childPath.replace(/\/[^/]+$/, '');
        const childGrandDir = childDir.replace(/\/[^/]+$/, '');
        if (childGrandDir === parentDir && childDir !== parentDir) {
          parentView.childViewIds.push(childView.id);
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
  const orphanedRels = allRelationships.filter(r => !elementIds.has(r.sourceId) || !elementIds.has(r.targetId));
  if (orphanedRels.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_ORPHANED_RELATIONSHIPS',
      message: `${orphanedRels.length} of ${allRelationships.length} relationships reference elements not found in the model.`,
    });
  }

  // Diagnostic: verify view node integrity
  const viewNodesWithoutElement = allViewNodes.filter(vn => !elementIds.has(vn.elementId));
  if (viewNodesWithoutElement.length > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'COARCHI_VIEWNODE_MISSING_ELEMENT',
      message: `${viewNodesWithoutElement.length} view nodes reference elements not in the model (synthetic diagram objects are expected).`,
    });
  }

  // Build per-view element sets to check relationship coverage
  const viewElementSets = new Map<string, Set<string>>();
  for (const vn of allViewNodes) {
    if (!viewElementSets.has(vn.viewId)) viewElementSets.set(vn.viewId, new Set());
    viewElementSets.get(vn.viewId)!.add(vn.elementId);
  }
  const firstViewId = allViews[0]?.id;
  const firstViewElSet = firstViewId ? viewElementSets.get(firstViewId) : undefined;
  const relsInFirstView = firstViewElSet
    ? allRelationships.filter(r => firstViewElSet.has(r.sourceId) && firstViewElSet.has(r.targetId)).length
    : 0;

  console.log('[OpenArchi] coArchi parse summary:', {
    elements: allElements.length,
    relationships: allRelationships.length,
    views: allViews.length,
    viewNodes: allViewNodes.length,
    viewConnections: allViewConnections.length,
    orphanedRelationships: orphanedRels.length,
    deferredViewCount: deferredViews.length,
    firstViewName: allViews[0]?.name,
    firstViewElementCount: firstViewElSet?.size ?? 0,
    relsFullyInFirstView: relsInFirstView,
    elementIdsSample: Array.from(elementIds).slice(0, 5),
    firstViewElementIdsSample: firstViewElSet ? Array.from(firstViewElSet).slice(0, 5) : [],
    relEndpointsSample: allRelationships.slice(0, 5).map(r => ({
      src: r.sourceId, tgt: r.targetId,
      srcIsElement: elementIds.has(r.sourceId),
      tgtIsElement: elementIds.has(r.targetId),
      srcInFirstView: firstViewElSet?.has(r.sourceId) ?? false,
      tgtInFirstView: firstViewElSet?.has(r.targetId) ?? false,
    })),
  });

  return finalizeCoArchiModel(allElements, allRelationships, allViews, allViewNodes, allViewConnections, diagnostics);
}

function serializeCoArchiXml(): SerializeResult {
  return {
    content: '',
    diagnostics: [
      {
        severity: 'error',
        code: 'COARCHI_SERIALIZE_NOT_IMPLEMENTED',
        message: 'coArchi XML export is not implemented yet.',
      },
    ],
    mimeType: 'application/xml',
    suggestedFileName: 'model.coarchi.xml',
  };
}

export const coArchiXmlAdapter: ModelFormatAdapter = {
  id: 'coarchi-xml',
  label: 'coArchi XML',
  extensions: ['xml', 'coarchi'],
  mimeTypes: ['application/xml', 'text/xml'],
  parse: parseCoArchiXml,
  serialize: serializeCoArchiXml,
};
