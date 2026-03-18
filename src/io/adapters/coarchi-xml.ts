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

function extractTypeName(rawType: string | undefined): string {
  if (!rawType) return '';
  const noPrefix = rawType.includes(':') ? rawType.split(':').pop() || '' : rawType;
  return noPrefix.trim();
}

function toCamelLower(name: string): string {
  if (!name) return '';
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function mapElementType(rawType: string | undefined): string | undefined {
  const base = extractTypeName(rawType).replace(/Element$/, '');
  if (!base || /relationship$/i.test(base)) return undefined;
  if (/diagrammodel|diagramobject|diagramconnection|diagramreference/i.test(base)) return undefined;

  const candidate = toCamelLower(base);
  if (ELEMENT_TYPE_KEYS.has(candidate)) return candidate;

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
          code: 'COARCHI_RELATIONSHIP_SKIPPED_MISSING_ENDPOINTS',
          message: `Skipping relationship '${id}' because source/target is missing.`,
          path: id,
        });
        continue;
      }

      const mappedType = mapRelationshipType(rawType);
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

    const mappedType = mapElementType(rawType);
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

    const tag = localName(node).toLowerCase();
    const rawType = getAttr(node, ['xsi:type', 'type']);
    const typeName = extractTypeName(rawType);

    return tag === 'view' || /diagrammodel/i.test(typeName);
  });

  for (const viewNode of viewCandidates) {
    const id = getAttr(viewNode, ['identifier', 'id']);
    if (!id || viewIds.has(id)) continue;

    views.push({
      id,
      name: getName(viewNode) || id,
      childViewIds: [],
    });
    viewIds.add(id);

    let fallbackIndex = 0;
    const descendants = Array.from(viewNode.querySelectorAll('*'));
    for (const child of descendants) {
      const elementId = getAttr(child, ['archimateElement', 'elementRef', 'modelElement', 'conceptRef']);
      if (elementId && elementIds.has(elementId)) {
        const key = `${id}::${elementId}`;
        if (!viewNodeKeys.has(key)) {
          const bounds = parseBounds(child);
          viewNodes.push({
            id: getAttr(child, ['identifier', 'id']) || key,
            viewId: id,
            elementId,
            x: bounds?.x ?? 140 + (fallbackIndex % 10) * 180,
            y: bounds?.y ?? 100 + Math.floor(fallbackIndex / 10) * 120,
            width: bounds?.width ?? 160,
            height: bounds?.height ?? 72,
          });
          viewNodeKeys.add(key);
          fallbackIndex += 1;
        }
      }

      const relationshipId = getAttr(child, ['archimateRelationship', 'relationshipRef', 'relationship']);
      if (relationshipId && relationshipIds.has(relationshipId)) {
        const key = `${id}::${relationshipId}`;
        if (!viewConnectionKeys.has(key)) {
          const rawBendpoints = parseRawBendpoints(child);

          // Resolve relative bendpoints using source/target element centers
          const rel = semanticRelationships.find(r => r.id === relationshipId);
          let sourceCenter: { x: number; y: number } | null = null;
          let targetCenter: { x: number; y: number } | null = null;
          if (rel) {
            const srcNode = viewNodes.find(vn => vn.viewId === id && vn.elementId === rel.sourceId);
            const tgtNode = viewNodes.find(vn => vn.viewId === id && vn.elementId === rel.targetId);
            if (srcNode) sourceCenter = { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height / 2 };
            if (tgtNode) targetCenter = { x: tgtNode.x + tgtNode.width / 2, y: tgtNode.y + tgtNode.height / 2 };
          }

          viewConnections.push({
            id: getAttr(child, ['identifier', 'id']) || key,
            viewId: id,
            relationshipId,
            waypoints: resolveBendpoints(rawBendpoints, sourceCenter, targetCenter),
            labelPosition: asNumber(getAttr(child, ['labelPos', 'labelPosition'])) ?? 0.5,
          });
          viewConnectionKeys.add(key);
        }
      }
    }
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

  const model: CanonicalModelDocument = {
    version: 'openarchi-0.1',
    elements,
    relationships,
    views,
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
 */
export function parseCoArchiFragments(xmlContents: string[]): ParseResult {
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

  for (const raw of xmlContents) {
    const doc = new DOMParser().parseFromString(raw, 'application/xml');
    if (doc.querySelector('parsererror')) continue;

    const allNodes = Array.from(doc.querySelectorAll('*'));

    // Extract elements and relationships
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
        if (!sourceId || !targetId) continue;

        const mappedType = mapRelationshipType(rawType);
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

      // Check if it's a view/diagram
      if (tag === 'view' || /diagrammodel/i.test(typeName)) {
        if (viewIds.has(id)) continue;

        allViews.push({
          id,
          name: getName(node) || id,
          childViewIds: [],
        });
        viewIds.add(id);

        // Extract view nodes and connections from this view
        let fallbackIndex = 0;
        const descendants = Array.from(node.querySelectorAll('*'));
        for (const child of descendants) {
          const elementId = getAttr(child, ['archimateElement', 'elementRef', 'modelElement', 'conceptRef']);
          if (elementId) {
            const key = `${id}::${elementId}`;
            if (!viewNodeKeys.has(key)) {
              const bounds = parseBounds(child);
              allViewNodes.push({
                id: getAttr(child, ['identifier', 'id']) || key,
                viewId: id,
                elementId,
                x: bounds?.x ?? 140 + (fallbackIndex % 10) * 180,
                y: bounds?.y ?? 100 + Math.floor(fallbackIndex / 10) * 120,
                width: bounds?.width ?? 160,
                height: bounds?.height ?? 72,
              });
              viewNodeKeys.add(key);
              fallbackIndex += 1;
            }
          }

          const relId = getAttr(child, ['archimateRelationship', 'relationshipRef', 'relationship']);
          if (relId) {
            const key = `${id}::${relId}`;
            if (!viewConnectionKeys.has(key)) {
              const rawBendpoints = parseRawBendpoints(child);
              const rel = allRelationships.find(r => r.id === relId);
              let sourceCenter: { x: number; y: number } | null = null;
              let targetCenter: { x: number; y: number } | null = null;
              if (rel) {
                const srcNode = allViewNodes.find(vn => vn.viewId === id && vn.elementId === rel.sourceId);
                const tgtNode = allViewNodes.find(vn => vn.viewId === id && vn.elementId === rel.targetId);
                if (srcNode) sourceCenter = { x: srcNode.x + srcNode.width / 2, y: srcNode.y + srcNode.height / 2 };
                if (tgtNode) targetCenter = { x: tgtNode.x + tgtNode.width / 2, y: tgtNode.y + tgtNode.height / 2 };
              }

              allViewConnections.push({
                id: getAttr(child, ['identifier', 'id']) || key,
                viewId: id,
                relationshipId: relId,
                waypoints: resolveBendpoints(rawBendpoints, sourceCenter, targetCenter),
                labelPosition: asNumber(getAttr(child, ['labelPos', 'labelPosition'])) ?? 0.5,
              });
              viewConnectionKeys.add(key);
            }
          }
        }
        continue;
      }

      // Regular element
      const mappedType = mapElementType(rawType);
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

  if (allElements.length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'COARCHI_NO_ELEMENTS_FOUND',
        message: 'No ArchiMate elements were found in the directory.',
      }],
    };
  }

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
