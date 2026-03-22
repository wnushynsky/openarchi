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
import type { ModelFormatAdapter, ParseResult, SerializeContext, SerializeResult } from '../adapter';

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

function getName(node: Element): string {
  const byAttr = getAttr(node, ['name']);
  if (byAttr) return byAttr;

  const nameChild = Array.from(node.children).find(child => localName(child).toLowerCase() === 'name');
  return nameChild?.textContent?.trim() || '';
}

function getDocumentation(node: Element): string {
  const byAttr = getAttr(node, ['documentation']);
  if (byAttr) return byAttr;

  const documentationChild = Array.from(node.children).find(child => localName(child).toLowerCase() === 'documentation');
  return documentationChild?.textContent?.trim() || '';
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

function mapElementType(node: Element, rawType: string | undefined): string | undefined {
  const base = extractTypeName(rawType).replace(/Element$/, '');
  if (!base || /relationship$/i.test(base)) return undefined;
  if (/diagrammodel|diagramobject|diagramconnection/i.test(base)) return undefined;

  const candidate = toCamelLower(base);
  if (ELEMENT_TYPE_KEYS.has(candidate)) return candidate;

  if (candidate === 'junction') {
    const junctionType = (getAttr(node, ['junctionType']) || '').toLowerCase();
    if (junctionType === 'or' && ELEMENT_TYPE_KEYS.has('orJunction')) return 'orJunction';
    if (junctionType === 'and' && ELEMENT_TYPE_KEYS.has('andJunction')) return 'andJunction';
    if (ELEMENT_TYPE_KEYS.has('andJunction')) return 'andJunction';
  }

  return undefined;
}

function mapRelationshipType(rawType: string | undefined): string | undefined {
  const base = extractTypeName(rawType).replace(/Relationship$/, '');
  if (!base) return undefined;

  const candidate = toCamelLower(base);
  if (RELATIONSHIP_TYPE_KEYS.has(candidate)) return candidate;

  const aliases: Record<string, string> = {
    usedBy: 'serving',
  };

  if (aliases[candidate]) return aliases[candidate];

  return undefined;
}

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  /** Absolute x (ArchiMate Exchange format) */
  x?: number;
  /** Absolute y (ArchiMate Exchange format) */
  y?: number;
  /** Offset from source center (Archi native format) */
  startX?: number;
  startY?: number;
  /** Offset from target center (Archi native format) */
  endX?: number;
  endY?: number;
}

function parseRawBendpoints(node: Element): RawBendpoint[] {
  const bendpoints: RawBendpoint[] = [];

  for (const child of Array.from(node.querySelectorAll('*'))) {
    const childName = localName(child).toLowerCase();
    if (!childName.includes('bendpoint') && childName !== 'point') continue;

    const bp: RawBendpoint = {};

    // Check absolute coords first (Exchange format)
    const absX = asNumber(child.getAttribute('x') ?? undefined);
    const absY = asNumber(child.getAttribute('y') ?? undefined);

    // Check relative coords (Archi native format)
    const sX = asNumber(child.getAttribute('startX') ?? undefined);
    const sY = asNumber(child.getAttribute('startY') ?? undefined);
    const eX = asNumber(child.getAttribute('endX') ?? undefined);
    const eY = asNumber(child.getAttribute('endY') ?? undefined);

    const hasRelative = sX !== undefined || sY !== undefined || eX !== undefined || eY !== undefined;

    if (hasRelative) {
      // Archi native format — store relative offsets
      bp.startX = sX ?? 0;
      bp.startY = sY ?? 0;
      bp.endX = eX ?? 0;
      bp.endY = eY ?? 0;
    } else if (absX !== undefined && absY !== undefined) {
      // Exchange format — absolute coordinates
      bp.x = absX;
      bp.y = absY;
    } else {
      continue;
    }

    bendpoints.push(bp);
  }

  return bendpoints;
}

/** Resolve raw bendpoints to absolute coordinates */
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

    // Relative bendpoints — resolve using source/target centers
    // Archi uses weighted interpolation: weight = (i+1) / (N+1)
    if (sourceCenter && targetCenter) {
      const weight = (i + 1) / (total + 1);
      const fromSource = { x: sourceCenter.x + (bp.startX ?? 0), y: sourceCenter.y + (bp.startY ?? 0) };
      const fromTarget = { x: targetCenter.x + (bp.endX ?? 0), y: targetCenter.y + (bp.endY ?? 0) };
      return [{
        x: fromSource.x * (1 - weight) + fromTarget.x * weight,
        y: fromSource.y * (1 - weight) + fromTarget.y * weight,
      }];
    }

    // Can't resolve — skip
    return [];
  });
}

function isDiagramObjectNode(node: Element): boolean {
  const childName = localName(node).toLowerCase();
  if (childName === 'node') return true;
  if (childName.includes('diagramobject')) return true;

  const rawType = extractTypeName(getAttr(node, ['xsi:type', 'type'])).toLowerCase();
  return rawType.includes('diagramobject');
}

function isConnectionNode(node: Element): boolean {
  const childName = localName(node).toLowerCase();
  if (childName === 'connection' || childName === 'sourceconnection') return true;
  if (childName.includes('diagramconnection')) return true;

  const rawType = extractTypeName(getAttr(node, ['xsi:type', 'type'])).toLowerCase();
  return rawType.includes('connection');
}

function isDiagramReferenceNode(node: Element): boolean {
  const childName = localName(node).toLowerCase();
  if (childName.includes('diagrammodelreference')) return true;

  const rawType = extractTypeName(getAttr(node, ['xsi:type', 'type'])).toLowerCase();
  return rawType.includes('diagrammodelreference');
}

function isDiagramNoteNode(node: Element): boolean {
  const childName = localName(node).toLowerCase();
  if (childName.includes('diagrammodelnote') || childName === 'note') return true;

  const rawType = extractTypeName(getAttr(node, ['xsi:type', 'type'])).toLowerCase();
  return rawType.includes('diagrammodelnote') || rawType === 'note';
}

function isDiagramGroupNode(node: Element): boolean {
  const childName = localName(node).toLowerCase();
  if (childName.includes('diagrammodelgroup') || childName === 'group') return true;

  const rawType = extractTypeName(getAttr(node, ['xsi:type', 'type'])).toLowerCase();
  return rawType.includes('diagrammodelgroup') || rawType === 'group';
}

/** Extract text from a <content> child element */
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

/** Pending connection collected during tree walk, resolved after all nodes are known */
interface PendingConnection {
  id: string;
  viewId: string;
  relationshipId: string;
  /** Diagram object ID of source (from connection's source attribute) */
  sourceDiagramId: string;
  /** Diagram object ID of target (from connection's target attribute) */
  targetDiagramId: string;
  rawBendpoints: RawBendpoint[];
  labelPosition: number;
}

interface ViewWalkState {
  viewId: string;
  elements: CanonicalElement[];
  viewNameById: Map<string, string>;
  elementIds: Set<string>;
  relationshipIds: Set<string>;
  viewNodeKeys: Set<string>;
  viewConnectionKeys: Set<string>;
  viewNodes: CanonicalViewNode[];
  viewConnections: CanonicalViewConnection[];
  /** Map from diagram object ID → absolute center position */
  diagramObjectCenters: Map<string, { x: number; y: number }>;
  /** Connections deferred until all nodes are collected */
  pendingConnections: PendingConnection[];
  fallbackIndex: number;
}

function walkViewTree(node: Element, offsetX: number, offsetY: number, state: ViewWalkState, parentNodeId?: string, depth: number = 0): void {
  let nextOffsetX = offsetX;
  let nextOffsetY = offsetY;
  let currentNodeId: string | undefined = parentNodeId;

  if (isDiagramObjectNode(node)) {
    const bounds = parseBounds(node);
    const hasBounds = !!bounds;
    if (bounds) {
      nextOffsetX = offsetX + bounds.x;
      nextOffsetY = offsetY + bounds.y;
    }

    const diagramObjectId = getAttr(node, ['identifier', 'id']);

    const elementId = getAttr(node, ['elementRef', 'archimateElement', 'modelElement', 'conceptRef']);
    if (elementId && state.elementIds.has(elementId)) {
      const key = `${state.viewId}::${elementId}`;
      if (!state.viewNodeKeys.has(key)) {
        const x = hasBounds ? nextOffsetX : (140 + (state.fallbackIndex % 10) * 180) + offsetX;
        const y = hasBounds ? nextOffsetY : (100 + Math.floor(state.fallbackIndex / 10) * 120) + offsetY;
        const width = bounds?.width ?? 160;
        const height = bounds?.height ?? 72;

        const nodeId = diagramObjectId || key;
        state.viewNodes.push({
          id: nodeId,
          viewId: state.viewId,
          elementId,
          x,
          y,
          width,
          height,
          parentNodeId,
          nestingDepth: depth,
        });
        state.viewNodeKeys.add(key);
        state.fallbackIndex += 1;
        currentNodeId = nodeId;

        // Record absolute center for bendpoint resolution
        if (diagramObjectId) {
          state.diagramObjectCenters.set(diagramObjectId, { x: x + width / 2, y: y + height / 2 });
        }

        nextOffsetX = x;
        nextOffsetY = y;
      } else {
        const existing = state.viewNodes.find(viewNode => viewNode.viewId === state.viewId && viewNode.elementId === elementId);
        if (existing) {
          nextOffsetX = existing.x;
          nextOffsetY = existing.y;
          currentNodeId = existing.id;
        }
      }
    } else if (diagramObjectId && hasBounds) {
      // Non-element diagram objects (e.g. groupings without archimateElement) — still track position for bendpoint resolution
      const x = nextOffsetX;
      const y = nextOffsetY;
      const width = bounds?.width ?? 160;
      const height = bounds?.height ?? 72;
      state.diagramObjectCenters.set(diagramObjectId, { x: x + width / 2, y: y + height / 2 });
      currentNodeId = diagramObjectId;
    }
  }

  if (isDiagramReferenceNode(node)) {
    const diagramObjectId = getAttr(node, ['identifier', 'id']);
    const targetViewId = getAttr(node, ['model', 'viewRef', 'targetView']);
    if (targetViewId) {
      const referenceId = diagramObjectId || `${state.viewId}::viewref::${targetViewId}`;
      if (!state.elementIds.has(referenceId)) {
        const targetName = state.viewNameById.get(targetViewId) || 'View';
        state.elements.push({
          id: referenceId,
          type: 'viewReference',
          name: targetName,
          documentation: `Navigation reference to view '${targetViewId}'.`,
        });
        state.elementIds.add(referenceId);
      }

      const key = `${state.viewId}::${referenceId}`;
      if (!state.viewNodeKeys.has(key)) {
        const bounds = parseBounds(node);
        const x = (bounds?.x ?? 140 + (state.fallbackIndex % 10) * 180) + offsetX;
        const y = (bounds?.y ?? 100 + Math.floor(state.fallbackIndex / 10) * 120) + offsetY;
        const width = bounds?.width ?? 180;
        const height = bounds?.height ?? 60;

        state.viewNodes.push({
          id: referenceId,
          viewId: state.viewId,
          elementId: referenceId,
          x,
          y,
          width,
          height,
          linkedViewId: targetViewId,
          parentNodeId,
          nestingDepth: depth,
        });
        state.viewNodeKeys.add(key);
        state.fallbackIndex += 1;
        currentNodeId = referenceId;

        if (diagramObjectId) {
          state.diagramObjectCenters.set(diagramObjectId, { x: x + width / 2, y: y + height / 2 });
        }
      }
    }
  }

  if (isDiagramNoteNode(node)) {
    const diagramObjectId = getAttr(node, ['identifier', 'id']);
    if (diagramObjectId) {
      const noteText = getContentText(node) || getName(node) || 'Note';
      if (!state.elementIds.has(diagramObjectId)) {
        state.elements.push({
          id: diagramObjectId,
          type: 'note',
          name: noteText,
          documentation: '',
        });
        state.elementIds.add(diagramObjectId);
      }
      const key = `${state.viewId}::${diagramObjectId}`;
      if (!state.viewNodeKeys.has(key)) {
        const bounds = parseBounds(node);
        const x = (bounds?.x ?? 140 + (state.fallbackIndex % 10) * 180) + offsetX;
        const y = (bounds?.y ?? 100 + Math.floor(state.fallbackIndex / 10) * 120) + offsetY;
        const width = bounds?.width ?? 200;
        const height = bounds?.height ?? 60;
        state.viewNodes.push({
          id: diagramObjectId,
          viewId: state.viewId,
          elementId: diagramObjectId,
          x, y, width, height,
          parentNodeId,
          nestingDepth: depth,
        });
        state.viewNodeKeys.add(key);
        state.fallbackIndex += 1;
        state.diagramObjectCenters.set(diagramObjectId, { x: x + width / 2, y: y + height / 2 });
        currentNodeId = diagramObjectId;
      }
    }
  }

  if (isDiagramGroupNode(node)) {
    const diagramObjectId = getAttr(node, ['identifier', 'id']);
    if (diagramObjectId) {
      const groupName = getName(node) || 'Group';
      if (!state.elementIds.has(diagramObjectId)) {
        state.elements.push({
          id: diagramObjectId,
          type: 'grouping',
          name: groupName,
          documentation: getDocumentation(node),
        });
        state.elementIds.add(diagramObjectId);
      }
      const key = `${state.viewId}::${diagramObjectId}`;
      if (!state.viewNodeKeys.has(key)) {
        const bounds = parseBounds(node);
        const x = (bounds?.x ?? 140 + (state.fallbackIndex % 10) * 180) + offsetX;
        const y = (bounds?.y ?? 100 + Math.floor(state.fallbackIndex / 10) * 120) + offsetY;
        const width = bounds?.width ?? 300;
        const height = bounds?.height ?? 200;
        state.viewNodes.push({
          id: diagramObjectId,
          viewId: state.viewId,
          elementId: diagramObjectId,
          x, y, width, height,
          parentNodeId,
          nestingDepth: depth,
        });
        state.viewNodeKeys.add(key);
        state.fallbackIndex += 1;
        state.diagramObjectCenters.set(diagramObjectId, { x: x + width / 2, y: y + height / 2 });
        currentNodeId = diagramObjectId;
      }
    }
  }

  if (isConnectionNode(node)) {
    const relationshipId = getAttr(node, ['relationshipRef', 'archimateRelationship', 'relationship']);
    if (relationshipId && state.relationshipIds.has(relationshipId)) {
      const key = `${state.viewId}::${relationshipId}`;
      if (!state.viewConnectionKeys.has(key)) {
        const sourceDiagramId = getAttr(node, ['source']) || '';
        const targetDiagramId = getAttr(node, ['target']) || '';

        state.pendingConnections.push({
          id: getAttr(node, ['identifier', 'id']) || key,
          viewId: state.viewId,
          relationshipId,
          sourceDiagramId,
          targetDiagramId,
          rawBendpoints: parseRawBendpoints(node),
          labelPosition: asNumber(getAttr(node, ['labelPos', 'labelPosition'])) ?? 0.5,
        });
        state.viewConnectionKeys.add(key);
      }
    }
  }

  for (const child of Array.from(node.children)) {
    walkViewTree(child, nextOffsetX, nextOffsetY, state, currentNodeId, depth + 1);
  }
}

/** Resolve all pending connections now that every diagram object position is known */
function resolvePendingConnections(state: ViewWalkState): void {
  for (const conn of state.pendingConnections) {
    const sourceCenter = state.diagramObjectCenters.get(conn.sourceDiagramId) || null;
    const targetCenter = state.diagramObjectCenters.get(conn.targetDiagramId) || null;

    state.viewConnections.push({
      id: conn.id,
      viewId: conn.viewId,
      relationshipId: conn.relationshipId,
      waypoints: resolveBendpoints(conn.rawBendpoints, sourceCenter, targetCenter),
      labelPosition: conn.labelPosition,
    });
  }
}

function parseArchiMateExchangeXml(raw: string): ParseResult {
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
        code: 'EXCHANGE_XML_PARSE_FAILED',
        message: 'Invalid XML document.',
      }],
    };
  }

  const root = document.documentElement;
  if (!root || localName(root).toLowerCase() !== 'model') {
    diagnostics.push({
      severity: 'warning',
      code: 'EXCHANGE_ROOT_UNEXPECTED',
      message: 'XML root is not model; attempting best-effort import.',
    });
  }

  const elements: CanonicalElement[] = [];
  const relationships: CanonicalRelationship[] = [];
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

    const tag = localName(node).toLowerCase();
    const rawType = getAttr(node, ['xsi:type', 'type']);
    const typeName = extractTypeName(rawType).toLowerCase();

    const isRelationshipByTag = tag === 'relationship';
    const isRelationshipByType = typeName.endsWith('relationship');

    if (isRelationshipByTag || isRelationshipByType) {
      if (relationshipIds.has(id)) continue;

      const sourceId = getAttr(node, ['source', 'sourceRef']);
      const targetId = getAttr(node, ['target', 'targetRef']);
      if (!sourceId || !targetId) {
        diagnostics.push({
          severity: 'warning',
          code: 'EXCHANGE_RELATIONSHIP_SKIPPED_MISSING_ENDPOINTS',
          message: `Skipping relationship '${id}' because source/target is missing.`,
          path: id,
        });
        continue;
      }

      const mappedType = mapRelationshipType(rawType);
      if (!mappedType) {
        diagnostics.push({
          severity: 'warning',
          code: 'EXCHANGE_RELATIONSHIP_TYPE_FALLBACK',
          message: `Relationship '${id}' uses unknown type '${rawType || 'unknown'}'; mapped to association.`,
          path: id,
        });
      }

      relationships.push({
        id,
        type: mappedType || 'association',
        sourceId,
        targetId,
        name: getName(node),
      });
      relationshipIds.add(id);
      continue;
    }

    const mappedType = mapElementType(node, rawType);
    if (!mappedType) continue;
    if (elementIds.has(id)) continue;

    elements.push({
      id,
      type: mappedType,
      name: getName(node) || id,
      documentation: getDocumentation(node),
    });
    elementIds.add(id);
  }

  const viewCandidates = allNodes.filter(node => {
    const tag = localName(node).toLowerCase();
    const rawType = getAttr(node, ['xsi:type', 'type']);
    const typeName = extractTypeName(rawType);

    return tag === 'view' || /diagrammodel/i.test(typeName);
  });
  const viewNameById = new Map<string, string>();
  for (const candidate of viewCandidates) {
    const candidateId = getAttr(candidate, ['identifier', 'id']);
    if (!candidateId) continue;
    viewNameById.set(candidateId, getName(candidate) || candidateId);
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

    const state: ViewWalkState = {
      viewId: id,
      elements,
      viewNameById,
      elementIds,
      relationshipIds,
      viewNodeKeys,
      viewConnectionKeys,
      viewNodes,
      viewConnections,
      diagramObjectCenters: new Map(),
      pendingConnections: [],
      fallbackIndex: 0,
    };

    // Pass 1: collect all nodes and diagram object positions
    for (const child of Array.from(viewNode.children)) {
      walkViewTree(child, 0, 0, state, undefined, 0);
    }

    // Pass 2: resolve connections now that all positions are known
    resolvePendingConnections(state);
  }

  // Build folder hierarchy from <folder> elements in the diagrams section
  const viewIdSet = new Set(views.map(v => v.id));
  const viewByIdMapLocal = new Map(views.map(v => [v.id, v]));

  function walkFolderHierarchy(folderEl: Element): string[] {
    const directChildIds: string[] = [];
    for (const child of Array.from(folderEl.children)) {
      const tag = localName(child).toLowerCase();
      if (tag === 'folder') {
        const folderId = getAttr(child, ['id', 'identifier']);
        const folderName = getName(child) || getAttr(child, ['name']) || 'Folder';
        if (!folderId) continue;
        const subChildIds = walkFolderHierarchy(child);
        if (subChildIds.length > 0) {
          if (!viewIdSet.has(folderId)) {
            views.push({ id: folderId, name: folderName, childViewIds: subChildIds });
            viewIdSet.add(folderId);
            viewByIdMapLocal.set(folderId, views[views.length - 1]);
          } else {
            const existing = viewByIdMapLocal.get(folderId);
            if (existing) existing.childViewIds = subChildIds;
          }
          directChildIds.push(folderId);
        }
      } else {
        const childId = getAttr(child, ['id', 'identifier']);
        if (childId && viewIdSet.has(childId)) {
          directChildIds.push(childId);
        }
      }
    }
    return directChildIds;
  }

  const diagramsFolders = allNodes.filter(n => {
    const tag = localName(n).toLowerCase();
    return tag === 'folder' && getAttr(n, ['type']) === 'diagrams';
  });
  for (const df of diagramsFolders) {
    walkFolderHierarchy(df);
  }

  if (elements.length === 0) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'EXCHANGE_NO_ELEMENTS_FOUND',
          message: 'No ArchiMate elements were found in the XML file.',
        },
      ],
    };
  }

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
      code: 'EXCHANGE_VIEW_NODES_FALLBACK',
      message: 'No diagram node coordinates found; generated default layout for imported elements.',
    });
  }

  const model: CanonicalModelDocument = {
    version: 'openarchi-0.1',
    elements,
    relationships,
    views,
    viewNodes,
    viewConnections,
    metadata: {
      sourceFormat: 'archimate-exchange-xml',
    },
  };

  return { model, diagnostics };
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Reverse map: camelCase element type → PascalCase ArchiMate type name */
function toArchiMateElementType(type: string): string {
  // Special cases
  if (type === 'andJunction') return 'Junction';
  if (type === 'orJunction') return 'Junction';
  if (type === 'viewReference') return 'DiagramModelReference';
  if (type === 'note') return 'DiagramModelNote';
  // General: businessActor → BusinessActor
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Reverse map: camelCase relationship type → PascalCase ArchiMate relationship name */
function toArchiMateRelationshipType(type: string): string {
  // General: assignment → AssignmentRelationship
  return type.charAt(0).toUpperCase() + type.slice(1) + 'Relationship';
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeArchiMateExchangeXml(
  model: CanonicalModelDocument,
  context?: import('../adapter').SerializeContext,
): SerializeResult {
  const diagnostics: ModelDiagnostic[] = [];
  const lines: string[] = [];

  const modelId = `model-${(context?.fileNameBase || 'openarchi').replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<archimate:model xmlns:archimate="http://www.opengroup.org/xsd/archimate/3.0/"`);
  lines.push(`                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"`);
  lines.push(`                 identifier="${escapeXml(modelId)}"`);
  lines.push(`                 version="1.0">`);
  lines.push(`  <archimate:name>OpenArchi Model</archimate:name>`);

  // --- Elements ---
  lines.push('');
  lines.push('  <archimate:elements>');
  for (const element of model.elements) {
    if (element.type === 'viewReference' || element.type === 'note') continue;

    const xmlType = `archimate:${toArchiMateElementType(element.type)}`;
    const junctionAttr = element.type === 'orJunction' ? ' junctionType="or"' : '';

    if (element.documentation) {
      lines.push(`    <archimate:element identifier="${escapeXml(element.id)}" xsi:type="${xmlType}"${junctionAttr}>`);
      lines.push(`      <archimate:name>${escapeXml(element.name)}</archimate:name>`);
      lines.push(`      <archimate:documentation>${escapeXml(element.documentation)}</archimate:documentation>`);
      lines.push(`    </archimate:element>`);
    } else {
      lines.push(`    <archimate:element identifier="${escapeXml(element.id)}" xsi:type="${xmlType}"${junctionAttr}><archimate:name>${escapeXml(element.name)}</archimate:name></archimate:element>`);
    }
  }
  lines.push('  </archimate:elements>');

  // --- Relationships ---
  lines.push('');
  lines.push('  <archimate:relationships>');
  for (const rel of model.relationships) {
    const xmlType = `archimate:${toArchiMateRelationshipType(rel.type)}`;
    const nameAttr = rel.name ? ` name="${escapeXml(rel.name)}"` : '';
    lines.push(`    <archimate:relationship identifier="${escapeXml(rel.id)}" xsi:type="${xmlType}" source="${escapeXml(rel.sourceId)}" target="${escapeXml(rel.targetId)}"${nameAttr}/>`);
  }
  lines.push('  </archimate:relationships>');

  // --- Views (diagrams) ---
  if (model.views.length > 0) {
    const viewNodesByView = new Map<string, CanonicalViewNode[]>();
    const viewConnectionsByView = new Map<string, CanonicalViewConnection[]>();
    for (const vn of model.viewNodes) {
      if (!viewNodesByView.has(vn.viewId)) viewNodesByView.set(vn.viewId, []);
      viewNodesByView.get(vn.viewId)!.push(vn);
    }
    for (const vc of model.viewConnections) {
      if (!viewConnectionsByView.has(vc.viewId)) viewConnectionsByView.set(vc.viewId, []);
      viewConnectionsByView.get(vc.viewId)!.push(vc);
    }

    // Build a lookup of relationship by id for connections
    const relById = new Map(model.relationships.map(r => [r.id, r]));

    lines.push('');
    lines.push('  <archimate:views>');
    for (const view of model.views) {
      lines.push(`    <archimate:view identifier="${escapeXml(view.id)}" xsi:type="archimate:Diagram">`);
      lines.push(`      <archimate:name>${escapeXml(view.name)}</archimate:name>`);

      // Nodes
      const nodes = viewNodesByView.get(view.id) || [];
      for (const node of nodes) {
        lines.push(`      <archimate:node identifier="${escapeXml(node.id)}" elementRef="${escapeXml(node.elementId)}" x="${Math.round(node.x)}" y="${Math.round(node.y)}" w="${Math.round(node.width)}" h="${Math.round(node.height)}"/>`);
      }

      // Connections
      const connections = viewConnectionsByView.get(view.id) || [];
      for (const conn of connections) {
        const rel = relById.get(conn.relationshipId);
        if (!rel) continue;

        if (conn.waypoints.length > 0) {
          lines.push(`      <archimate:connection identifier="${escapeXml(conn.id)}" relationshipRef="${escapeXml(conn.relationshipId)}" source="${escapeXml(rel.sourceId)}" target="${escapeXml(rel.targetId)}">`);
          for (const wp of conn.waypoints) {
            lines.push(`        <archimate:bendpoint x="${Math.round(wp.x)}" y="${Math.round(wp.y)}"/>`);
          }
          lines.push(`      </archimate:connection>`);
        } else {
          lines.push(`      <archimate:connection identifier="${escapeXml(conn.id)}" relationshipRef="${escapeXml(conn.relationshipId)}" source="${escapeXml(rel.sourceId)}" target="${escapeXml(rel.targetId)}"/>`);
        }
      }

      lines.push(`    </archimate:view>`);
    }
    lines.push('  </archimate:views>');
  }

  lines.push('</archimate:model>');

  return {
    content: lines.join('\n'),
    diagnostics,
    mimeType: 'application/xml',
    suggestedFileName: `${context?.fileNameBase || 'model'}.archimate`,
  };
}

export const archiMateExchangeXmlAdapter: ModelFormatAdapter = {
  id: 'archimate-exchange-xml',
  label: 'ArchiMate Exchange XML',
  extensions: ['xml', 'archimate'],
  mimeTypes: ['application/xml', 'text/xml'],
  parse: parseArchiMateExchangeXml,
  serialize: serializeArchiMateExchangeXml,
};
