import type {
  ModelElement,
  ModelRelationship,
  ModelView,
  OpenArchiModel,
  ElementStyle,
  RelativeBendpoint,
  DiagramNodeRecord,
  DiagramConnectionRecord,
} from '../types';
import type {
  CanonicalElement,
  CanonicalModelDocument,
  CanonicalRelationship,
  CanonicalView,
  CanonicalViewConnection,
  CanonicalViewNode,
} from './canonical';

export interface ElementViewLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  linkedViewId?: string;
  zIndex?: number;
  isParent?: boolean;
  style?: ElementStyle;
}

export interface RelationshipViewLayout {
  waypoints: { x: number; y: number }[];
  labelPos: number;
  relativeBendpoints?: RelativeBendpoint[];
}

export type ElementLayoutsByView = Record<string, Record<string, ElementViewLayout>>;
export type RelationshipLayoutsByView = Record<string, Record<string, RelationshipViewLayout>>;

const DEFAULT_ELEMENT_WIDTH = 120;
const DEFAULT_ELEMENT_HEIGHT = 55;

function buildSemanticRelationships(
  document: CanonicalModelDocument,
  fallbackConnections?: Map<string, CanonicalViewConnection>,
): ModelRelationship[] {
  const hasExplicitDiagramConnections = document.viewConnections.length > 0;

  return document.relationships.map(relationship => {
    const fallbackConnection = hasExplicitDiagramConnections
      ? undefined
      : fallbackConnections?.get(relationship.id);

    return {
      id: relationship.id,
      type: relationship.type,
      sourceId: relationship.sourceId,
      targetId: relationship.targetId,
      name: relationship.name,
      documentation: relationship.documentation || '',
      properties: relationship.properties?.map(property => ({ ...property })),
      sourcePath: relationship.sourcePath,
      waypoints: fallbackConnection?.waypoints || [],
      labelPos: fallbackConnection?.labelPosition ?? 0.5,
      relativeBendpoints: fallbackConnection?.relativeBendpoints,
    };
  });
}

function ensureViews(model: OpenArchiModel): ModelView[] {
  if (model.views.length > 0) return model.views;
  return [
    {
      id: 'v1',
      name: 'Default View',
      elementIds: model.elements.map(element => element.id),
      childViewIds: [],
    },
  ];
}

export function editorToCanonicalModel(model: OpenArchiModel): CanonicalModelDocument {
  const views = ensureViews(model);

  const elements: CanonicalElement[] = model.elements.map(element => ({
    id: element.id,
    type: element.type,
    name: element.name,
    documentation: element.documentation || '',
    properties: element.properties?.map(property => ({ ...property })),
    sourcePath: element.sourcePath,
  }));

  const relationships: CanonicalRelationship[] = model.relationships.map(relationship => ({
    id: relationship.id,
    type: relationship.type,
    sourceId: relationship.sourceId,
    targetId: relationship.targetId,
    name: relationship.name,
    documentation: relationship.documentation || '',
    properties: relationship.properties?.map(property => ({ ...property })),
    sourcePath: relationship.sourcePath,
  }));

  const canonicalViews: CanonicalView[] = views.map(view => ({
    id: view.id,
    name: view.name,
    childViewIds: view.childViewIds || [],
    documentation: view.documentation || '',
    purpose: view.purpose,
    viewpoint: view.viewpoint,
    properties: view.properties?.map(property => ({ ...property })),
    sourcePath: view.sourcePath,
  }));

  const elementById = new Map(model.elements.map(element => [element.id, element]));

  const viewNodes: CanonicalViewNode[] = Array.isArray(model.diagramNodes) && model.diagramNodes.length > 0
    ? model.diagramNodes.map(node => ({
      id: node.id,
      viewId: node.viewId,
      elementId: node.elementId,
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      linkedViewId: node.linkedViewId,
      style: node.style ? {
        fillColor: node.style.fillColor,
        lineColor: node.style.lineColor,
        fontColor: node.style.fontColor,
      } : undefined,
      parentNodeId: node.parentNodeId,
      nestingDepth: node.nestingDepth ?? node.zIndex,
    }))
    : (() => {
      const synthesizedNodes: CanonicalViewNode[] = [];
      for (const view of views) {
        const memberIds = new Set(view.elementIds || []);
        for (const elementId of memberIds) {
          const element = elementById.get(elementId);
          if (!element) continue;
          synthesizedNodes.push({
            id: `${view.id}::${element.id}`,
            viewId: view.id,
            elementId: element.id,
            x: element.x,
            y: element.y,
            width: element.w,
            height: element.h,
            linkedViewId: element.linkedViewId,
          });
        }
      }
      return synthesizedNodes;
    })();

  const viewConnections: CanonicalViewConnection[] = Array.isArray(model.diagramConnections) && model.diagramConnections.length > 0
    ? model.diagramConnections.map(connection => ({
      id: connection.id,
      viewId: connection.viewId,
      relationshipId: connection.relationshipId,
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      waypoints: connection.waypoints || [],
      labelPosition: connection.labelPos ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    }))
    : (() => {
      const synthesizedConnections: CanonicalViewConnection[] = [];
      for (const view of views) {
        const memberIds = new Set(view.elementIds || []);
        for (const relationship of model.relationships) {
          if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
          synthesizedConnections.push({
            id: `${view.id}::${relationship.id}`,
            viewId: view.id,
            relationshipId: relationship.id,
            waypoints: relationship.waypoints || [],
            labelPosition: relationship.labelPos ?? 0.5,
          });
        }
      }
      return synthesizedConnections;
    })();

  return {
    version: model.version,
    elements,
    relationships,
    views: canonicalViews,
    viewNodes,
    viewConnections,
    metadata: {
      sourceFormat: 'openarchi-json',
    },
  };
}

export function canonicalToEditorModel(document: CanonicalModelDocument): OpenArchiModel {
  const nodesByElement = new Map<string, CanonicalViewNode>();
  for (const node of document.viewNodes) {
    if (!nodesByElement.has(node.elementId)) {
      nodesByElement.set(node.elementId, node);
    }
  }

  const elements: ModelElement[] = document.elements.map((element, index) => {
    const node = nodesByElement.get(element.id);
    return {
      id: element.id,
      type: element.type,
      name: element.name,
      x: node?.x ?? 100 + index * 30,
      y: node?.y ?? 100 + index * 20,
      w: node?.width ?? DEFAULT_ELEMENT_WIDTH,
      h: node?.height ?? DEFAULT_ELEMENT_HEIGHT,
      documentation: element.documentation || '',
      properties: element.properties?.map(property => ({ ...property })),
      sourcePath: element.sourcePath,
      linkedViewId: node?.linkedViewId,
      zIndex: node?.nestingDepth ?? 0,
      style: node?.style ? {
        fillColor: node.style.fillColor,
        lineColor: node.style.lineColor,
        fontColor: node.style.fontColor,
      } : undefined,
    };
  });

  const firstConnectionByRelationship = new Map<string, CanonicalViewConnection>();
  for (const connection of document.viewConnections) {
    if (!firstConnectionByRelationship.has(connection.relationshipId)) {
      firstConnectionByRelationship.set(connection.relationshipId, connection);
    }
  }

  const relationships = buildSemanticRelationships(document, firstConnectionByRelationship);

  const nodeIdsByView = new Map<string, Set<string>>();
  for (const node of document.viewNodes) {
    let nodeIds = nodeIdsByView.get(node.viewId);
    if (!nodeIds) {
      nodeIds = new Set<string>();
      nodeIdsByView.set(node.viewId, nodeIds);
    }
    nodeIds.add(node.elementId);
  }

  const mappedViews: ModelView[] = document.views.map(view => ({
    id: view.id,
    name: view.name,
    elementIds: [...(nodeIdsByView.get(view.id) || [])],
    childViewIds: view.childViewIds || [],
    documentation: view.documentation || '',
    purpose: view.purpose,
    viewpoint: view.viewpoint,
    properties: view.properties?.map(property => ({ ...property })),
    sourcePath: view.sourcePath,
  }));

  const views: ModelView[] = mappedViews.length > 0
    ? mappedViews
    : [{
      id: 'v1',
      name: 'Default View',
      elementIds: elements.map(element => element.id),
      childViewIds: [],
    }];

  return {
    version: document.version || 'openarchi-0.1',
    elements,
    relationships,
    views,
    diagramNodes: document.viewNodes.map<DiagramNodeRecord>(node => ({
      id: node.id,
      viewId: node.viewId,
      elementId: node.elementId,
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      linkedViewId: node.linkedViewId,
      zIndex: node.nestingDepth,
      style: node.style ? {
        fillColor: node.style.fillColor,
        lineColor: node.style.lineColor,
        fontColor: node.style.fontColor,
      } : undefined,
      parentNodeId: node.parentNodeId,
      nestingDepth: node.nestingDepth,
    })),
    diagramConnections: document.viewConnections.map<DiagramConnectionRecord>(connection => ({
      id: connection.id,
      viewId: connection.viewId,
      relationshipId: connection.relationshipId,
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPosition ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    })),
  };
}

/**
 * Combined conversion: produces both the editor model and per-view layout maps
 * in a single pass over viewNodes/viewConnections, avoiding the redundant
 * iteration that buildLayoutsFromCanonicalDocument would perform separately.
 */
export function canonicalToEditorModelWithLayouts(document: CanonicalModelDocument): {
  model: OpenArchiModel;
  elementLayouts: ElementLayoutsByView;
  relationshipLayouts: RelationshipLayoutsByView;
} {
  // --- Build element position from first viewNode ---
  const nodesByElement = new Map<string, CanonicalViewNode>();
  const nodeIdsByView = new Map<string, Set<string>>();
  const elementLayouts: ElementLayoutsByView = {};
  const relationshipLayouts: RelationshipLayoutsByView = {};

  // Build a map from viewNode ID to elementId for parent resolution
  const viewNodeIdToElementId = new Map<string, string>();

  for (const view of document.views) {
    elementLayouts[view.id] = {};
    relationshipLayouts[view.id] = {};
  }

  // Single pass over viewNodes: build layouts + element lookup + view membership
  for (const node of document.viewNodes) {
    if (!nodesByElement.has(node.elementId)) {
      nodesByElement.set(node.elementId, node);
    }

    let nodeIds = nodeIdsByView.get(node.viewId);
    if (!nodeIds) {
      nodeIds = new Set<string>();
      nodeIdsByView.set(node.viewId, nodeIds);
    }
    nodeIds.add(node.elementId);

    viewNodeIdToElementId.set(node.id, node.elementId);

    if (!elementLayouts[node.viewId]) elementLayouts[node.viewId] = {};
    elementLayouts[node.viewId][node.elementId] = {
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      linkedViewId: node.linkedViewId,
      zIndex: node.nestingDepth ?? 0,
      style: node.style ? { fillColor: node.style.fillColor, lineColor: node.style.lineColor, fontColor: node.style.fontColor } : undefined,
    };
  }

  // Mark parent nodes (second mini-pass over viewNodes — only for parent flagging)
  for (const node of document.viewNodes) {
    if (node.parentNodeId) {
      const parentElementId = viewNodeIdToElementId.get(node.parentNodeId);
      if (parentElementId && elementLayouts[node.viewId]?.[parentElementId]) {
        elementLayouts[node.viewId][parentElementId].isParent = true;
      }
    }
  }

  // --- Elements ---
  const elements: ModelElement[] = document.elements.map((element, index) => {
    const node = nodesByElement.get(element.id);
    return {
      id: element.id,
      type: element.type,
      name: element.name,
      x: node?.x ?? 100 + index * 30,
      y: node?.y ?? 100 + index * 20,
      w: node?.width ?? DEFAULT_ELEMENT_WIDTH,
      h: node?.height ?? DEFAULT_ELEMENT_HEIGHT,
      documentation: element.documentation || '',
      properties: element.properties?.map(property => ({ ...property })),
      sourcePath: element.sourcePath,
      linkedViewId: node?.linkedViewId,
      zIndex: node?.nestingDepth ?? 0,
      style: node?.style ? {
        fillColor: node.style.fillColor,
        lineColor: node.style.lineColor,
        fontColor: node.style.fontColor,
      } : undefined,
    };
  });

  // --- Relationships + connection layouts ---
  const firstConnectionByRelationship = new Map<string, CanonicalViewConnection>();
  for (const connection of document.viewConnections) {
    if (!firstConnectionByRelationship.has(connection.relationshipId)) {
      firstConnectionByRelationship.set(connection.relationshipId, connection);
    }

    if (!relationshipLayouts[connection.viewId]) relationshipLayouts[connection.viewId] = {};
    relationshipLayouts[connection.viewId][connection.relationshipId] = {
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPosition ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    };
  }

  const relationships = buildSemanticRelationships(document, firstConnectionByRelationship);

  // --- Views ---
  const mappedViews: ModelView[] = document.views.map(view => ({
    id: view.id,
    name: view.name,
    elementIds: [...(nodeIdsByView.get(view.id) || [])],
    childViewIds: view.childViewIds || [],
    documentation: view.documentation || '',
    purpose: view.purpose,
    viewpoint: view.viewpoint,
    properties: view.properties?.map(property => ({ ...property })),
    sourcePath: view.sourcePath,
  }));

  const views: ModelView[] = mappedViews.length > 0
    ? mappedViews
    : [{
      id: 'v1',
      name: 'Default View',
      elementIds: elements.map(element => element.id),
      childViewIds: [],
    }];

  return {
    model: {
      version: document.version || 'openarchi-0.1',
      elements,
      relationships,
      views,
      diagramNodes: document.viewNodes.map<DiagramNodeRecord>(node => ({
        id: node.id,
        viewId: node.viewId,
        elementId: node.elementId,
        x: node.x,
        y: node.y,
        w: node.width,
        h: node.height,
        linkedViewId: node.linkedViewId,
        zIndex: node.nestingDepth,
        style: node.style ? {
          fillColor: node.style.fillColor,
          lineColor: node.style.lineColor,
          fontColor: node.style.fontColor,
        } : undefined,
        parentNodeId: node.parentNodeId,
        nestingDepth: node.nestingDepth,
      })),
      diagramConnections: document.viewConnections.map<DiagramConnectionRecord>(connection => ({
        id: connection.id,
        viewId: connection.viewId,
        relationshipId: connection.relationshipId,
        sourceNodeId: connection.sourceNodeId,
        targetNodeId: connection.targetNodeId,
        waypoints: connection.waypoints || [],
        labelPos: connection.labelPosition ?? 0.5,
        relativeBendpoints: connection.relativeBendpoints,
      })),
    },
    elementLayouts,
    relationshipLayouts,
  };
}
