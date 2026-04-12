import { ELEMENT_TYPES, RELATIONSHIP_TYPES } from '../core';
import type { CanonicalModelDocument } from './canonical';
import type { ModelDiagnostic } from './diagnostics';
import { isElementTypeAllowedInViewpoint } from './viewpoints';

function pushDuplicateDiagnostics(
  diagnostics: ModelDiagnostic[],
  entries: { id: string }[],
  code: string,
  label: string,
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) duplicates.add(entry.id);
    else seen.add(entry.id);
  }

  for (const id of duplicates) {
    diagnostics.push({
      severity: 'error',
      code,
      message: `Duplicate ${label} id '${id}'.`,
      path: id,
    });
  }
}

export function validateCanonicalDocument(document: CanonicalModelDocument): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];

  pushDuplicateDiagnostics(diagnostics, document.elements, 'VALIDATION_DUPLICATE_ELEMENT_ID', 'element');
  pushDuplicateDiagnostics(diagnostics, document.relationships, 'VALIDATION_DUPLICATE_RELATIONSHIP_ID', 'relationship');
  pushDuplicateDiagnostics(diagnostics, document.views, 'VALIDATION_DUPLICATE_VIEW_ID', 'view');
  pushDuplicateDiagnostics(diagnostics, document.viewNodes, 'VALIDATION_DUPLICATE_VIEW_NODE_ID', 'view node');
  pushDuplicateDiagnostics(diagnostics, document.viewConnections, 'VALIDATION_DUPLICATE_VIEW_CONNECTION_ID', 'view connection');

  const elementById = new Map(document.elements.map(element => [element.id, element]));
  const relationshipById = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const viewById = new Map(document.views.map(view => [view.id, view]));
  const nodeById = new Map(document.viewNodes.map(node => [node.id, node]));

  for (const element of document.elements) {
    if (!ELEMENT_TYPES[element.type]) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_UNKNOWN_ELEMENT_TYPE',
        message: `Element '${element.id}' uses unknown type '${element.type}'.`,
        path: element.id,
      });
    }
  }

  for (const relationship of document.relationships) {
    if (!RELATIONSHIP_TYPES[relationship.type]) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_UNKNOWN_RELATIONSHIP_TYPE',
        message: `Relationship '${relationship.id}' uses unknown type '${relationship.type}'.`,
        path: relationship.id,
      });
    }

    if (!elementById.has(relationship.sourceId) || !elementById.has(relationship.targetId)) {
      diagnostics.push({
        severity: 'error',
        code: 'VALIDATION_RELATIONSHIP_MISSING_ENDPOINT',
        message: `Relationship '${relationship.id}' references a missing source or target element.`,
        path: relationship.id,
      });
    }
  }

  for (const view of document.views) {
    const viewNodes = document.viewNodes.filter(node => node.viewId === view.id);
    const nodeCount = viewNodes.length;
    if (nodeCount === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_EMPTY_VIEW',
        message: `View '${view.name || view.id}' has no nodes.`,
        path: view.id,
      });
    }

    if (view.viewpoint) {
      for (const node of viewNodes) {
        const element = elementById.get(node.elementId);
        if (!element || isElementTypeAllowedInViewpoint(element.type, view.viewpoint)) continue;
        diagnostics.push({
          severity: 'warning',
          code: 'VALIDATION_VIEWPOINT_DISALLOWED_ELEMENT',
          message: `View '${view.name || view.id}' has viewpoint '${view.viewpoint}' but contains '${element.name || element.id}' of type '${element.type}'.`,
          path: node.id,
        });
      }
    }

    for (const childViewId of view.childViewIds || []) {
      if (!viewById.has(childViewId)) {
        diagnostics.push({
          severity: 'warning',
          code: 'VALIDATION_MISSING_CHILD_VIEW',
          message: `View '${view.id}' references missing child view '${childViewId}'.`,
          path: view.id,
        });
      }
    }
  }

  for (const node of document.viewNodes) {
    if (!viewById.has(node.viewId)) {
      diagnostics.push({
        severity: 'error',
        code: 'VALIDATION_VIEW_NODE_MISSING_VIEW',
        message: `View node '${node.id}' references missing view '${node.viewId}'.`,
        path: node.id,
      });
    }
    if (!elementById.has(node.elementId)) {
      diagnostics.push({
        severity: 'error',
        code: 'VALIDATION_VIEW_NODE_MISSING_ELEMENT',
        message: `View node '${node.id}' references missing element '${node.elementId}'.`,
        path: node.id,
      });
    }
    if (node.parentNodeId && !nodeById.has(node.parentNodeId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_VIEW_NODE_MISSING_PARENT',
        message: `View node '${node.id}' references missing parent node '${node.parentNodeId}'.`,
        path: node.id,
      });
    }
  }

  for (const connection of document.viewConnections) {
    if (!viewById.has(connection.viewId)) {
      diagnostics.push({
        severity: 'error',
        code: 'VALIDATION_VIEW_CONNECTION_MISSING_VIEW',
        message: `View connection '${connection.id}' references missing view '${connection.viewId}'.`,
        path: connection.id,
      });
    }

    const relationship = relationshipById.get(connection.relationshipId);
    if (!relationship) {
      diagnostics.push({
        severity: 'error',
        code: 'VALIDATION_VIEW_CONNECTION_MISSING_RELATIONSHIP',
        message: `View connection '${connection.id}' references missing relationship '${connection.relationshipId}'.`,
        path: connection.id,
      });
      continue;
    }

    const sourceNode = connection.sourceNodeId ? nodeById.get(connection.sourceNodeId) : undefined;
    const targetNode = connection.targetNodeId ? nodeById.get(connection.targetNodeId) : undefined;

    if (connection.sourceNodeId && !sourceNode) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_VIEW_CONNECTION_MISSING_SOURCE_NODE',
        message: `View connection '${connection.id}' references missing source node '${connection.sourceNodeId}'.`,
        path: connection.id,
      });
    }
    if (connection.targetNodeId && !targetNode) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_VIEW_CONNECTION_MISSING_TARGET_NODE',
        message: `View connection '${connection.id}' references missing target node '${connection.targetNodeId}'.`,
        path: connection.id,
      });
    }

    const sourceInView = document.viewNodes.some(node => node.viewId === connection.viewId && node.elementId === relationship.sourceId);
    const targetInView = document.viewNodes.some(node => node.viewId === connection.viewId && node.elementId === relationship.targetId);
    if (!sourceInView || !targetInView) {
      diagnostics.push({
        severity: 'warning',
        code: 'VALIDATION_VIEW_CONNECTION_ENDPOINTS_NOT_IN_VIEW',
        message: `View connection '${connection.id}' has a relationship whose endpoints are not both present in view '${connection.viewId}'.`,
        path: connection.id,
      });
    }
  }

  const elementIdsInViews = new Set(document.viewNodes.map(node => node.elementId));
  for (const element of document.elements) {
    if (!elementIdsInViews.has(element.id) && element.type !== 'note' && element.type !== 'grouping') {
      diagnostics.push({
        severity: 'info',
        code: 'VALIDATION_ORPHAN_ELEMENT',
        message: `Element '${element.name || element.id}' is not placed in any view.`,
        path: element.id,
      });
    }
  }

  return diagnostics;
}
