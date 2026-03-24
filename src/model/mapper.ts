import type {
  ModelElement,
  ModelRelationship,
  ModelView,
  OpenArchiModel,
} from '../types';
import type {
  CanonicalElement,
  CanonicalModelDocument,
  CanonicalRelationship,
  CanonicalView,
  CanonicalViewConnection,
  CanonicalViewNode,
} from './canonical';

const DEFAULT_ELEMENT_WIDTH = 120;
const DEFAULT_ELEMENT_HEIGHT = 55;

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
  }));

  const relationships: CanonicalRelationship[] = model.relationships.map(relationship => ({
    id: relationship.id,
    type: relationship.type,
    sourceId: relationship.sourceId,
    targetId: relationship.targetId,
    name: relationship.name,
  }));

  const canonicalViews: CanonicalView[] = views.map(view => ({
    id: view.id,
    name: view.name,
    childViewIds: view.childViewIds || [],
  }));

  const elementById = new Map(model.elements.map(element => [element.id, element]));

  const viewNodes: CanonicalViewNode[] = [];
  for (const view of views) {
    const memberIds = new Set(view.elementIds || []);
    for (const elementId of memberIds) {
      const element = elementById.get(elementId);
      if (!element) continue;
      viewNodes.push({
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

  const viewConnections: CanonicalViewConnection[] = [];
  for (const view of views) {
    const memberIds = new Set(view.elementIds || []);
    for (const relationship of model.relationships) {
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      viewConnections.push({
        id: `${view.id}::${relationship.id}`,
        viewId: view.id,
        relationshipId: relationship.id,
        waypoints: relationship.waypoints || [],
        labelPosition: relationship.labelPos ?? 0.5,
      });
    }
  }

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

  const relationships: ModelRelationship[] = document.relationships.map(relationship => {
    const connection = firstConnectionByRelationship.get(relationship.id);
    return {
      id: relationship.id,
      type: relationship.type,
      sourceId: relationship.sourceId,
      targetId: relationship.targetId,
      name: relationship.name,
      waypoints: connection?.waypoints || [],
      labelPos: connection?.labelPosition ?? 0.5,
      relativeBendpoints: connection?.relativeBendpoints,
    };
  });

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
  };
}
