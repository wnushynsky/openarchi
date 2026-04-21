import type {
  CanonicalModelDocument,
  CanonicalRelationship,
  CanonicalViewConnection,
  CanonicalViewNode,
  DiagramStyle,
} from './canonical';
import type { ModelDiagnostic } from './diagnostics';

const DEFAULT_NODE_WIDTH = 160;
const DEFAULT_NODE_HEIGHT = 72;
const DEFAULT_START_X = 120;
const DEFAULT_START_Y = 120;
const DEFAULT_X_GAP = 180;
const DEFAULT_Y_GAP = 110;
const DEFAULT_COLUMNS = 3;

export interface ViewCompileLayoutHints {
  strategy?: 'preserve-existing' | 'auto-place-new' | 'reset-all';
  columns?: number;
  startX?: number;
  startY?: number;
  xGap?: number;
  yGap?: number;
}

export interface ViewCompilePlan {
  viewId: string;
  elementIds: string[];
  relationshipIds: string[];
  layout?: ViewCompileLayoutHints;
}

function findAnyNodeForElement(document: CanonicalModelDocument, elementId: string, excludedViewId?: string): CanonicalViewNode | undefined {
  return document.viewNodes.find(node => node.elementId === elementId && node.viewId !== excludedViewId);
}

function findAnyConnectionForRelationship(
  document: CanonicalModelDocument,
  relationshipId: string,
  excludedViewId?: string,
): CanonicalViewConnection | undefined {
  return document.viewConnections.find(connection =>
    connection.relationshipId === relationshipId && connection.viewId !== excludedViewId,
  );
}

function buildNodeId(viewId: string, elementId: string): string {
  return `${viewId}::${elementId}`;
}

function buildConnectionId(viewId: string, relationshipId: string): string {
  return `${viewId}::${relationshipId}`;
}

function nextPlacementOrigin(nodes: CanonicalViewNode[], layout?: ViewCompileLayoutHints): { startX: number; startY: number } {
  const hasExisting = nodes.length > 0;
  const startX = layout?.startX
    ?? (hasExisting ? Math.max(...nodes.map(node => node.x + node.width)) + (layout?.xGap ?? DEFAULT_X_GAP) : DEFAULT_START_X);
  const startY = layout?.startY
    ?? (hasExisting ? Math.min(...nodes.map(node => node.y)) : DEFAULT_START_Y);

  return { startX, startY };
}

function buildPlacedNode(
  document: CanonicalModelDocument,
  viewId: string,
  elementId: string,
  index: number,
  existingNodes: CanonicalViewNode[],
  layout?: ViewCompileLayoutHints,
): CanonicalViewNode {
  const template = findAnyNodeForElement(document, elementId, viewId);
  const columns = Math.max(1, layout?.columns ?? DEFAULT_COLUMNS);
  const xGap = layout?.xGap ?? DEFAULT_X_GAP;
  const yGap = layout?.yGap ?? DEFAULT_Y_GAP;
  const { startX, startY } = nextPlacementOrigin(existingNodes, layout);
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    id: buildNodeId(viewId, elementId),
    viewId,
    elementId,
    x: startX + column * xGap,
    y: startY + row * yGap,
    width: template?.width ?? DEFAULT_NODE_WIDTH,
    height: template?.height ?? DEFAULT_NODE_HEIGHT,
    linkedViewId: template?.linkedViewId,
    style: template?.style ? { ...template.style } : undefined,
    nestingDepth: template?.nestingDepth,
  };
}

function cloneStyle(style: DiagramStyle | undefined): DiagramStyle | undefined {
  return style ? { ...style } : undefined;
}

function isRelationshipInView(
  relationship: CanonicalRelationship,
  elementIds: Set<string>,
): boolean {
  return elementIds.has(relationship.sourceId) && elementIds.has(relationship.targetId);
}

export function compileViewPlans(
  document: CanonicalModelDocument,
  plans: ViewCompilePlan[],
): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  const viewById = new Map(document.views.map(view => [view.id, view]));
  const relationshipById = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const existingNodesByView = new Map<string, CanonicalViewNode[]>();
  const existingConnectionsByView = new Map<string, CanonicalViewConnection[]>();

  for (const node of document.viewNodes) {
    const group = existingNodesByView.get(node.viewId);
    if (group) group.push(node);
    else existingNodesByView.set(node.viewId, [node]);
  }

  for (const connection of document.viewConnections) {
    const group = existingConnectionsByView.get(connection.viewId);
    if (group) group.push(connection);
    else existingConnectionsByView.set(connection.viewId, [connection]);
  }

  const touchedViewIds = new Set(plans.map(plan => plan.viewId));
  document.viewNodes = document.viewNodes.filter(node => !touchedViewIds.has(node.viewId));
  document.viewConnections = document.viewConnections.filter(connection => !touchedViewIds.has(connection.viewId));

  for (const plan of plans) {
    if (!viewById.has(plan.viewId)) {
      diagnostics.push({
        severity: 'error',
        code: 'VIEW_COMPILE_UNKNOWN_VIEW',
        message: `Cannot compile unknown view '${plan.viewId}'.`,
      });
      continue;
    }

    const originalNodes = existingNodesByView.get(plan.viewId) || [];
    const originalConnections = existingConnectionsByView.get(plan.viewId) || [];
    const preserveExisting = plan.layout?.strategy !== 'reset-all';
    const validElementIds = new Set(plan.elementIds);
    const compiledNodes: CanonicalViewNode[] = [];
    const nodesByElementId = new Map<string, CanonicalViewNode>();

    for (const node of originalNodes) {
      if (!preserveExisting) break;
      if (!validElementIds.has(node.elementId)) continue;
      const clonedNode: CanonicalViewNode = {
        ...node,
        style: cloneStyle(node.style),
      };
      compiledNodes.push(clonedNode);
      nodesByElementId.set(clonedNode.elementId, clonedNode);
    }

    let placedCount = 0;
    for (const elementId of plan.elementIds) {
      if (nodesByElementId.has(elementId)) continue;
      const newNode = buildPlacedNode(document, plan.viewId, elementId, placedCount, compiledNodes, plan.layout);
      compiledNodes.push(newNode);
      nodesByElementId.set(elementId, newNode);
      placedCount += 1;
    }

    const validRelationshipIds = new Set<string>();
    for (const relationshipId of plan.relationshipIds) {
      const relationship = relationshipById.get(relationshipId);
      if (!relationship) {
        diagnostics.push({
          severity: 'warning',
          code: 'VIEW_COMPILE_MISSING_RELATIONSHIP',
          message: `Skipping missing relationship '${relationshipId}' in view '${plan.viewId}'.`,
        });
        continue;
      }
      if (!isRelationshipInView(relationship, validElementIds)) {
        diagnostics.push({
          severity: 'warning',
          code: 'VIEW_COMPILE_RELATIONSHIP_OUTSIDE_VIEW',
          message: `Skipping relationship '${relationshipId}' in view '${plan.viewId}' because one or both endpoints are not present in the view.`,
        });
        continue;
      }
      validRelationshipIds.add(relationshipId);
    }

    const compiledConnections: CanonicalViewConnection[] = [];
    for (const connection of originalConnections) {
      if (!preserveExisting) break;
      if (!validRelationshipIds.has(connection.relationshipId)) continue;
      const sourceNodeId = connection.sourceNodeId;
      const targetNodeId = connection.targetNodeId;
      if (sourceNodeId && !compiledNodes.some(node => node.id === sourceNodeId)) continue;
      if (targetNodeId && !compiledNodes.some(node => node.id === targetNodeId)) continue;
      compiledConnections.push({
        ...connection,
        style: cloneStyle(connection.style),
        waypoints: connection.waypoints.map(waypoint => ({ ...waypoint })),
        relativeBendpoints: connection.relativeBendpoints?.map(bendpoint => ({ ...bendpoint })),
      });
    }

    const hasConnectionForRelationship = new Set(compiledConnections.map(connection => connection.relationshipId));
    for (const relationshipId of validRelationshipIds) {
      if (hasConnectionForRelationship.has(relationshipId)) continue;
      const relationship = relationshipById.get(relationshipId);
      if (!relationship) continue;
      const template = findAnyConnectionForRelationship(document, relationshipId, plan.viewId);
      const sourceNodeId = nodesByElementId.get(relationship.sourceId)?.id;
      const targetNodeId = nodesByElementId.get(relationship.targetId)?.id;
      compiledConnections.push({
        id: buildConnectionId(plan.viewId, relationshipId),
        viewId: plan.viewId,
        relationshipId,
        sourceNodeId,
        targetNodeId,
        waypoints: template?.waypoints.map(waypoint => ({ ...waypoint })) || [],
        labelPosition: template?.labelPosition ?? 0.5,
        style: cloneStyle(template?.style),
        relativeBendpoints: template?.relativeBendpoints?.map(bendpoint => ({ ...bendpoint })),
      });
    }

    document.viewNodes.push(...compiledNodes);
    document.viewConnections.push(...compiledConnections);
  }

  return diagnostics;
}
