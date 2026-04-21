import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  ModelElement, ModelRelationship, ModelView,
  Camera, DragState, PanState, DrawingRelState, DragWPState, DragEndpointState, DragLabelState, DragSegmentState,
  RelPickerState, CtxMenuState, CtxMenuItem, GridType, SelectionType, ResizeState,
  OpenArchiModel,
} from './types';
import type { CanonicalModelDocument } from './model/canonical';
import {
  LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, FONT,
  snap, uid, GRID,
  nearestAnchor, getRelPoints, nearestTOnPath,
  hitTestElement, hitTestAnchor, hitTestWaypoint, hitTestEndpoint, hitTestRelationship, hitTestLabel, hitTestPopout, getSegmentOrientation,
  hitTestResizeHandle, HANDLE_CURSORS,
  SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS,
  snapToElements, type SnapGuide,
} from './core';
import { drawDotGrid, drawLineGrid, drawElement, drawRelationship, drawSnapGuides, getRelSegments, exportViewToSvg, type RelSegments } from './canvas';
import { RelPicker, CtxMenu, SearchPanel, ViewNav, PropertyPanel, ModelTree, Btn, CanvasIcon, FloatingToolbar } from './components';
import {
  detectModelFormatByFileName,
  exportEditorModelToText,
  exportFragmentedEditorModel,
  importEditorModelFromText,
  importFragmentedModel,
  isFragmentedModelDirectory,
  listModelFormats,
} from './model/service';
import { serializeCoArchiFragmented } from './io/adapters/coarchi-xml';
import { buildOrganizationTree } from './model/organization';
import {
  getAllowedElementTypesForViewpoint,
  getAllowedLayersForViewpoint,
  getSuggestedPurposeForViewpoint,
  getViewpointDefinition,
  isElementTypeAllowedInViewpoint,
} from './model/viewpoints';
import {
  VIEW_TEMPLATES,
  createCustomViewTemplate,
  instantiateViewTemplate,
  type ViewTemplateDefinition,
} from './model/view-templates';
import {
  isSameOrDescendantFolder,
  getDefaultElementFolder,
  getDefaultRelationshipFolder,
  getDefaultViewFolder,
  getRelativeFolderPathFromSourcePath,
  moveElementSourcePath,
  moveRelationshipSourcePath,
  moveViewSourcePath,
  normalizeRelativeFolderPath,
  rebaseRelativeFolderPath,
  removeCoArchiFolderEntry,
  upsertCoArchiFolderEntry,
  renameCoArchiFolderEntries,
} from './model/source-paths';
import {
  type OpenFileEntry,
} from './io/filesystem';
import { isTauriRuntime } from './platform/tauri';
import { useWorkspace } from './workspace';
import type { GitHistoryEntry } from './workspace';
import type { ModelDiagnostic } from './model/diagnostics';

const getLayer = (type: string) => ELEMENT_TYPES[type]?.layer;
const isNote = (type: string) => !!ELEMENT_TYPES[type]?.isNote;
const CUSTOM_VIEW_TEMPLATES_STORAGE_KEY = 'openarchi.customViewTemplates';

interface ElementViewLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  linkedViewId?: string;
  zIndex?: number;
  isParent?: boolean;
  style?: import('./types').ElementStyle;
}

interface RelationshipViewLayout {
  waypoints: { x: number; y: number }[];
  labelPos: number;
  relativeBendpoints?: import('./types').RelativeBendpoint[];
}

type ElementLayoutsByView = Record<string, Record<string, ElementViewLayout>>;
type RelationshipLayoutsByView = Record<string, Record<string, RelationshipViewLayout>>;

interface DuplicateTraceEntry {
  id: string;
  occurrences: Array<{
    name?: string;
    type?: string;
    sourcePath?: string;
  }>;
  placements: Array<{
    viewId: string;
    nodeId: string;
  }>;
}

interface AffectedViewInfo {
  viewId: string;
  viewName: string;
  reasons: string[];
}

interface CommitCompareState {
  commit: GitHistoryEntry;
  viewId: string;
  viewName: string;
  currentSvg: string;
  previousSvg: string;
  currentElementCount: number;
  currentRelationshipCount: number;
  previousElementCount: number;
  previousRelationshipCount: number;
  snapshotMissing: boolean;
}

interface DiagramNodeState {
  id: string;
  viewId: string;
  elementId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  linkedViewId?: string;
  zIndex?: number;
  style?: import('./types').ElementStyle;
  parentNodeId?: string;
  nestingDepth?: number;
}

interface DiagramConnectionState {
  id: string;
  viewId: string;
  relationshipId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  waypoints: { x: number; y: number }[];
  labelPos: number;
  relativeBendpoints?: import('./types').RelativeBendpoint[];
}

type DiagramNodesByView = Record<string, DiagramNodeState[]>;
type DiagramConnectionsByView = Record<string, DiagramConnectionState[]>;

type DiagramElementInstance = ModelElement & { elementId: string };
type DiagramRelationshipInstance = ModelRelationship & {
  relationshipId: string;
  sourceNodeId: string;
  targetNodeId: string;
};

function collectDuplicateTrace(
  document: CanonicalModelDocument | null | undefined,
): DuplicateTraceEntry[] {
  if (!document) return [];

  const elementBuckets = new Map<string, CanonicalModelDocument['elements']>();
  for (const element of document.elements) {
    const bucket = elementBuckets.get(element.id) || [];
    bucket.push(element);
    elementBuckets.set(element.id, bucket);
  }

  return [...elementBuckets.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({
      id,
      occurrences: entries.map(entry => ({
        name: entry.name,
        type: entry.type,
        sourcePath: entry.sourcePath,
      })),
      placements: document.viewNodes
        .filter(node => node.elementId === id)
        .map(node => ({
          viewId: node.viewId,
          nodeId: node.id,
        })),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function formatDuplicateTrace(trace: DuplicateTraceEntry[]): string {
  if (trace.length === 0) return 'No duplicate element traces found.';

  return trace.map(entry => {
    const occurrences = entry.occurrences
      .map((occurrence, index) =>
        `  [${index + 1}] ${occurrence.type || 'unknown'} | ${occurrence.name || '(unnamed)'} | ${occurrence.sourcePath || '(no sourcePath)'}`)
      .join('\n');
    const placements = entry.placements.length > 0
      ? entry.placements.map(placement => `  -> view=${placement.viewId}, node=${placement.nodeId}`).join('\n')
      : '  -> no view placements';
    return `Duplicate element '${entry.id}'\n${occurrences}\n${placements}`;
  }).join('\n\n');
}

function buildViewElementsForRender(
  viewId: string,
  views: ModelView[],
  elements: ModelElement[],
  diagramNodesByView: DiagramNodesByView,
): DiagramElementInstance[] {
  const view = views.find(candidate => candidate.id === viewId) || null;
  const visibleElementIds = view
    ? new Set(view.elementIds || [])
    : new Set(elements.map(element => element.id));
  const visibleElements = elements.filter(element => visibleElementIds.has(element.id));
  const nodes = diagramNodesByView[viewId] || [];

  if (nodes.length === 0) {
    return visibleElements.map(element => ({ ...element, elementId: element.id }));
  }

  const elementById = new Map(elements.map(element => [element.id, element]));
  const diagramElements: DiagramElementInstance[] = [];
  for (const node of nodes) {
    const element = elementById.get(node.elementId);
    if (!element) continue;
    diagramElements.push({
      ...element,
      id: node.id,
      elementId: node.elementId,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      linkedViewId: node.linkedViewId ?? element.linkedViewId,
      zIndex: node.zIndex ?? node.nestingDepth ?? element.zIndex,
      style: node.style ?? element.style,
    });
  }
  return diagramElements;
}

function buildViewRelationshipsForRender(
  viewId: string,
  views: ModelView[],
  elements: ModelElement[],
  relationships: ModelRelationship[],
  diagramNodesByView: DiagramNodesByView,
  diagramConnectionsByView: DiagramConnectionsByView,
): DiagramRelationshipInstance[] {
  const view = views.find(candidate => candidate.id === viewId) || null;
  const visibleElementIds = view
    ? new Set(view.elementIds || [])
    : new Set(elements.map(element => element.id));
  const visibleElements = buildViewElementsForRender(viewId, views, elements, diagramNodesByView);
  const visibleElementMap = new Map(visibleElements.map(element => [element.id, element]));
  const visibleNodeIdsByElementId = new Map<string, string[]>();
  for (const element of visibleElements) {
    const ids = visibleNodeIdsByElementId.get(element.elementId) || [];
    ids.push(element.id);
    visibleNodeIdsByElementId.set(element.elementId, ids);
  }

  const semanticRelationshipsById = new Map(relationships.map(relationship => [relationship.id, relationship]));
  const elementById = new Map(elements.map(element => [element.id, element]));
  const visibleSemanticRelationships = relationships.filter(relationship => {
    if (!visibleElementIds.has(relationship.sourceId) || !visibleElementIds.has(relationship.targetId)) return false;
    const source = elementById.get(relationship.sourceId);
    const target = elementById.get(relationship.targetId);
    if (source && target) {
      const sourceContainsTarget = target.x >= source.x && target.y >= source.y &&
        target.x + target.w <= source.x + source.w && target.y + target.h <= source.y + source.h;
      const targetContainsSource = source.x >= target.x && source.y >= target.y &&
        source.x + source.w <= target.x + target.w && source.y + source.h <= target.y + target.h;
      if (sourceContainsTarget || targetContainsSource) return false;
    }
    return true;
  });

  const connections = diagramConnectionsByView[viewId] || [];
  const nextRelationships: DiagramRelationshipInstance[] = [];

  for (const connection of connections) {
    const semanticRelationship = semanticRelationshipsById.get(connection.relationshipId);
    if (!semanticRelationship) continue;
    const sourceNodeId = connection.sourceNodeId || visibleNodeIdsByElementId.get(semanticRelationship.sourceId)?.[0];
    const targetNodeId = connection.targetNodeId || visibleNodeIdsByElementId.get(semanticRelationship.targetId)?.[0];
    if (!sourceNodeId || !targetNodeId) continue;

    const sourceElement = visibleElementMap.get(sourceNodeId);
    const targetElement = visibleElementMap.get(targetNodeId);
    if (!sourceElement || !targetElement) continue;

    const sourceContainsTarget = targetElement.x >= sourceElement.x && targetElement.y >= sourceElement.y &&
      targetElement.x + targetElement.w <= sourceElement.x + sourceElement.w &&
      targetElement.y + targetElement.h <= sourceElement.y + sourceElement.h;
    const targetContainsSource = sourceElement.x >= targetElement.x && sourceElement.y >= targetElement.y &&
      sourceElement.x + sourceElement.w <= targetElement.x + targetElement.w &&
      sourceElement.y + sourceElement.h <= targetElement.y + targetElement.h;
    if (sourceContainsTarget || targetContainsSource) continue;

    nextRelationships.push({
      ...semanticRelationship,
      id: connection.id,
      relationshipId: semanticRelationship.id,
      sourceId: sourceNodeId,
      targetId: targetNodeId,
      sourceNodeId,
      targetNodeId,
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPos ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    });
  }

  if (nextRelationships.length > 0 || connections.length > 0) return nextRelationships;

  return visibleSemanticRelationships.flatMap(relationship => {
    const sourceNodeId = visibleNodeIdsByElementId.get(relationship.sourceId)?.[0];
    const targetNodeId = visibleNodeIdsByElementId.get(relationship.targetId)?.[0];
    if (!sourceNodeId || !targetNodeId) return [];
    return [{
      ...relationship,
      id: `${viewId}::${relationship.id}`,
      relationshipId: relationship.id,
      sourceId: sourceNodeId,
      targetId: targetNodeId,
      sourceNodeId,
      targetNodeId,
    }];
  });
}

function buildViewSvgSnapshot(
  viewId: string,
  views: ModelView[],
  elements: ModelElement[],
  relationships: ModelRelationship[],
  diagramNodesByView: DiagramNodesByView,
  diagramConnectionsByView: DiagramConnectionsByView,
): {
  svg: string;
  elementCount: number;
  relationshipCount: number;
} {
  const viewElements = buildViewElementsForRender(viewId, views, elements, diagramNodesByView);
  const viewRelationships = buildViewRelationshipsForRender(
    viewId,
    views,
    elements,
    relationships,
    diagramNodesByView,
    diagramConnectionsByView,
  );

  return {
    svg: exportViewToSvg(
      viewElements as ModelElement[],
      viewRelationships as ModelRelationship[],
    ),
    elementCount: viewElements.length,
    relationshipCount: viewRelationships.length,
  };
}

function nodeContainsNode(parent: DiagramNodeState, child: DiagramNodeState): boolean {
  return child.x >= parent.x
    && child.y >= parent.y
    && child.x + child.w <= parent.x + parent.w
    && child.y + child.h <= parent.y + parent.h;
}

function normalizeDiagramNodeHierarchy(nodes: DiagramNodeState[]): DiagramNodeState[] {
  const normalizedNodes = nodes.map(node => ({ ...node }));
  const nodeById = new Map(normalizedNodes.map(node => [node.id, node]));
  const resolvedDepths = new Map<string, number>();

  const resolveDepth = (nodeId: string, stack: Set<string> = new Set()): number => {
    const cached = resolvedDepths.get(nodeId);
    if (cached !== undefined) return cached;

    const node = nodeById.get(nodeId);
    if (!node) return 0;

    const parentId = node.parentNodeId;
    if (!parentId || parentId === node.id || stack.has(node.id)) {
      node.parentNodeId = undefined;
      node.nestingDepth = 0;
      resolvedDepths.set(node.id, 0);
      return 0;
    }

    const parentNode = nodeById.get(parentId);
    if (!parentNode || !nodeContainsNode(parentNode, node)) {
      node.parentNodeId = undefined;
      node.nestingDepth = 0;
      resolvedDepths.set(node.id, 0);
      return 0;
    }

    const nextStack = new Set(stack);
    nextStack.add(node.id);
    const parentDepth = resolveDepth(parentNode.id, nextStack);
    const depth = parentDepth + 1;
    node.nestingDepth = depth;
    resolvedDepths.set(node.id, depth);
    return depth;
  };

  for (const node of normalizedNodes) {
    resolveDepth(node.id);
    node.zIndex = node.nestingDepth ?? node.zIndex ?? 0;
  }

  return normalizedNodes;
}

function buildLayoutsFromEditorModel(
  elements: ModelElement[],
  relationships: ModelRelationship[],
  views: ModelView[],
): { elementLayouts: ElementLayoutsByView; relationshipLayouts: RelationshipLayoutsByView } {
  const elementLayouts: ElementLayoutsByView = {};
  const relationshipLayouts: RelationshipLayoutsByView = {};

  for (const view of views) {
    const memberIds = new Set(view.elementIds || []);
    elementLayouts[view.id] = {};
    relationshipLayouts[view.id] = {};

    for (const element of elements) {
      if (!memberIds.has(element.id)) continue;
      elementLayouts[view.id][element.id] = {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        linkedViewId: element.linkedViewId,
        zIndex: element.zIndex,
        style: element.style,
      };
    }

    for (const relationship of relationships) {
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      relationshipLayouts[view.id][relationship.id] = {
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
        relativeBendpoints: relationship.relativeBendpoints,
      };
    }
  }

  return { elementLayouts, relationshipLayouts };
}

function buildLayoutsFromCanonicalDocument(
  document: CanonicalModelDocument,
): { elementLayouts: ElementLayoutsByView; relationshipLayouts: RelationshipLayoutsByView } {
  const elementLayouts: ElementLayoutsByView = {};
  const relationshipLayouts: RelationshipLayoutsByView = {};

  for (const view of document.views) {
    elementLayouts[view.id] = {};
    relationshipLayouts[view.id] = {};
  }

  // Build a map from viewNode ID to elementId for parent resolution
  const viewNodeIdToElementId = new Map<string, string>();
  for (const node of document.viewNodes) {
    viewNodeIdToElementId.set(node.id, node.elementId);
  }

  for (const node of document.viewNodes) {
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

  // Mark elements that are structural parents (have children nested inside them)
  for (const node of document.viewNodes) {
    if (node.parentNodeId) {
      const parentElementId = viewNodeIdToElementId.get(node.parentNodeId);
      if (parentElementId && elementLayouts[node.viewId]?.[parentElementId]) {
        elementLayouts[node.viewId][parentElementId].isParent = true;
      }
    }
  }

  for (const connection of document.viewConnections) {
    if (!relationshipLayouts[connection.viewId]) relationshipLayouts[connection.viewId] = {};
    relationshipLayouts[connection.viewId][connection.relationshipId] = {
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPosition ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    };
  }

  return { elementLayouts, relationshipLayouts };
}

function buildDiagramStateFromEditorModel(
  elements: ModelElement[],
  relationships: ModelRelationship[],
  views: ModelView[],
): { diagramNodesByView: DiagramNodesByView; diagramConnectionsByView: DiagramConnectionsByView } {
  const diagramNodesByView: DiagramNodesByView = {};
  const diagramConnectionsByView: DiagramConnectionsByView = {};
  const elementById = new Map(elements.map(element => [element.id, element]));

  for (const view of views) {
    const memberIds = new Set(view.elementIds || []);
    const nodes: DiagramNodeState[] = [];
    for (const elementId of memberIds) {
      const element = elementById.get(elementId);
      if (!element) continue;
      nodes.push({
          id: `${view.id}::${element.id}`,
          viewId: view.id,
          elementId: element.id,
          x: element.x,
          y: element.y,
          w: element.w,
          h: element.h,
          linkedViewId: element.linkedViewId,
          zIndex: element.zIndex,
          style: element.style,
      });
    }
    diagramNodesByView[view.id] = nodes;

    diagramConnectionsByView[view.id] = relationships
      .filter(relationship => memberIds.has(relationship.sourceId) && memberIds.has(relationship.targetId))
      .map(relationship => ({
        id: `${view.id}::${relationship.id}`,
        viewId: view.id,
        relationshipId: relationship.id,
        sourceNodeId: `${view.id}::${relationship.sourceId}`,
        targetNodeId: `${view.id}::${relationship.targetId}`,
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
        relativeBendpoints: relationship.relativeBendpoints,
      }));
  }

  return { diagramNodesByView, diagramConnectionsByView };
}

function buildDiagramStateFromCanonicalDocument(
  document: CanonicalModelDocument,
): { diagramNodesByView: DiagramNodesByView; diagramConnectionsByView: DiagramConnectionsByView } {
  const diagramNodesByView: DiagramNodesByView = {};
  const diagramConnectionsByView: DiagramConnectionsByView = {};

  for (const view of document.views) {
    diagramNodesByView[view.id] = [];
    diagramConnectionsByView[view.id] = [];
  }

  for (const node of document.viewNodes) {
    if (!diagramNodesByView[node.viewId]) diagramNodesByView[node.viewId] = [];
    diagramNodesByView[node.viewId].push({
      id: node.id,
      viewId: node.viewId,
      elementId: node.elementId,
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      linkedViewId: node.linkedViewId,
      zIndex: node.nestingDepth ?? 0,
      style: node.style ? {
        fillColor: node.style.fillColor,
        lineColor: node.style.lineColor,
        fontColor: node.style.fontColor,
      } : undefined,
      parentNodeId: node.parentNodeId,
      nestingDepth: node.nestingDepth,
    });
  }

  for (const connection of document.viewConnections) {
    if (!diagramConnectionsByView[connection.viewId]) diagramConnectionsByView[connection.viewId] = [];
    diagramConnectionsByView[connection.viewId].push({
      id: connection.id,
      viewId: connection.viewId,
      relationshipId: connection.relationshipId,
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPosition ?? 0.5,
      relativeBendpoints: connection.relativeBendpoints,
    });
  }

  return { diagramNodesByView, diagramConnectionsByView };
}

function cloneDiagramNodesByView(source: DiagramNodesByView): DiagramNodesByView {
  const cloned: DiagramNodesByView = {};
  for (const [viewId, nodes] of Object.entries(source)) {
    cloned[viewId] = nodes.map(node => ({ ...node }));
  }
  return cloned;
}

function cloneDiagramConnectionsByView(source: DiagramConnectionsByView): DiagramConnectionsByView {
  const cloned: DiagramConnectionsByView = {};
  for (const [viewId, connections] of Object.entries(source)) {
    cloned[viewId] = connections.map(connection => ({
      ...connection,
      waypoints: connection.waypoints.map(waypoint => ({ ...waypoint })),
      relativeBendpoints: connection.relativeBendpoints?.map(bendpoint => ({ ...bendpoint })),
    }));
  }
  return cloned;
}

function cloneCanonicalDocument(document: CanonicalModelDocument | null): CanonicalModelDocument | null {
  if (!document) return null;
  return JSON.parse(JSON.stringify(document)) as CanonicalModelDocument;
}

function buildFragmentedSavePreview(changeSet: {
  createdPaths: string[];
  deletedPaths: string[];
  createdFolderPaths: string[];
  deletedFolderPaths: string[];
}): string | null {
  const sections: string[] = [];
  const appendPreview = (title: string, paths: string[]) => {
    if (paths.length === 0) return;
    const preview = paths.slice(0, 6).map(path => `- ${path}`).join('\n');
    const suffix = paths.length > 6 ? `\n- ...and ${paths.length - 6} more` : '';
    sections.push(`${title} (${paths.length})\n${preview}${suffix}`);
  };

  appendPreview('Create files', changeSet.createdPaths);
  appendPreview('Delete files', changeSet.deletedPaths.filter(path => !changeSet.deletedFolderPaths.includes(path)));
  appendPreview('Create folder manifests', changeSet.createdFolderPaths);
  appendPreview('Delete folder manifests', changeSet.deletedFolderPaths);

  if (sections.length === 0) return null;
  return `Fragmented save will make these path changes:\n\n${sections.join('\n\n')}\n\nContinue?`;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [views, setViews] = useState<ModelView[]>(SAMPLE_VIEWS);
  const [currentViewId, setCurrentViewId] = useState('v1');
  const [elements, setElements] = useState<ModelElement[]>(SAMPLE_ELEMENTS);
  const [relationships, setRelationships] = useState<ModelRelationship[]>(SAMPLE_RELATIONSHIPS);

  const [importDiag, setImportDiag] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ phase: string; pct: number } | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selType, setSelType] = useState<SelectionType>(null);
  const [activeLayer, setActiveLayer] = useState('business');
  const [gridType, setGridType] = useState<GridType>('dot');

  const [dragging, setDragging] = useState<DragState | null>(null);
  const [panning, setPanning] = useState<PanState | null>(null);
  const [hovElId, setHovElId] = useState<string | null>(null);
  const [hovRelId, setHovRelId] = useState<string | null>(null);
  const [drawingRel, setDrawingRel] = useState<DrawingRelState | null>(null);
  const [dragWP, setDragWP] = useState<DragWPState | null>(null);
  const [dragEndpoint, setDragEndpoint] = useState<DragEndpointState | null>(null);
  const [dragLabel, setDragLabel] = useState<DragLabelState | null>(null);
  const [dragSegment, setDragSegment] = useState<DragSegmentState | null>(null);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [relPicker, setRelPicker] = useState<RelPickerState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [ioFormatId, setIoFormatId] = useState<string>('auto');
  const [leftPanelWidth, setLeftPanelWidth] = useState(244);
  const [leftNavMode, setLeftNavMode] = useState<'views' | 'model'>('views');
  const [propSide, setPropSide] = useState<'left' | 'right'>('left');
  const [openTabIds, setOpenTabIds] = useState<string[]>(['v1']);
  const [editingElId, setEditingElId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'view' | 'edit'>('edit');
  const [editingName, setEditingName] = useState('');
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const [createViewDraft, setCreateViewDraft] = useState<{
    parentViewId?: string;
    mode: 'choice' | 'empty' | 'template';
    viewpoint: string;
    templateId: string;
    name: string;
  } | null>(null);
  const [customViewTemplates, setCustomViewTemplates] = useState<ViewTemplateDefinition[]>([]);
  const [showLegend, setShowLegend] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [diagramStateVersion, setDiagramStateVersion] = useState(0);
  const [organizationBaseDocument, setOrganizationBaseDocument] = useState<CanonicalModelDocument | null>(null);
  const [saveNotice, setSaveNotice] = useState<{
    kind: 'saving' | 'success' | 'error';
    message: string;
  } | null>(null);
  const [gitHistory, setGitHistory] = useState<GitHistoryEntry[]>([]);
  const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState<string | null>(null);
  const [selectedHistoryCommit, setSelectedHistoryCommit] = useState<GitHistoryEntry | null>(null);
  const [commitChangedFiles, setCommitChangedFiles] = useState<string[]>([]);
  const [commitAffectedViews, setCommitAffectedViews] = useState<AffectedViewInfo[]>([]);
  const [commitDetailsLoading, setCommitDetailsLoading] = useState(false);
  const [commitDetailsError, setCommitDetailsError] = useState<string | null>(null);
  const [commitCompareState, setCommitCompareState] = useState<CommitCompareState | null>(null);
  const [commitCompareLoading, setCommitCompareLoading] = useState(false);
  const [commitCompareError, setCommitCompareError] = useState<string | null>(null);
  const saveViewLayoutSnapshotRef = useRef<(viewId: string) => void>(() => {});
  const autoLoadedWorkspaceRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_VIEW_TEMPLATES_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      setCustomViewTemplates(parsed.filter(template => template && typeof template.id === 'string'));
    } catch {
      // Ignore invalid local template storage and continue with built-ins.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_VIEW_TEMPLATES_STORAGE_KEY, JSON.stringify(customViewTemplates));
    } catch {
      // Ignore storage write failures.
    }
  }, [customViewTemplates]);

  // Workspace (directory, file, dirty, git branch – persisted to IndexedDB)
  const {
    workspace, openDirectory: wsOpenDirectory, setActiveFile: wsSetActiveFile,
    markDirty, markClean, saveFile: wsSaveFile, saveFragmented: wsSaveFragmented, saveSingleFragment: wsSaveSingleFragment, seedContentHashes: wsSeedContentHashes,
    getFile: wsGetFile, getActiveFile,
    closeWorkspace,
    restorePending, restoreDirectoryName, requestPermissionAndRestore,
    getGitHistory: wsGetGitHistory,
    getGitChangedFiles: wsGetGitChangedFiles,
    getGitModelSnapshot: wsGetGitModelSnapshot,
  } = useWorkspace();
  const {
    isDirty,
    gitBranch,
    directoryName: wsDirName,
    files: wsFiles,
    activeFilePath: wsActiveFilePath,
    format: wsFormat,
    kind: wsKind,
  } = workspace;

  const showTransientDiagnostic = useCallback((message: string, timeoutMs: number = 8000) => {
    setImportDiag(message);
    setTimeout(() => {
      setImportDiag(current => (current === message ? null : current));
    }, timeoutMs);
  }, []);

  const showSaveNotice = useCallback((
    kind: 'saving' | 'success' | 'error',
    message: string,
    timeoutMs: number = kind === 'error' ? 12000 : 4000,
  ) => {
    setSaveNotice({ kind, message });
    if (timeoutMs > 0) {
      setTimeout(() => {
        setSaveNotice(current => (current?.message === message ? null : current));
      }, timeoutMs);
    }
  }, []);

  const summarizeDiagnostics = useCallback((scope: string, diagnostics: ModelDiagnostic[]) => {
    if (diagnostics.length === 0) return;
    const errors = diagnostics.filter(diagnostic => diagnostic.severity === 'error');
    const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 'warning');
    const first = diagnostics[0];
    const summary = `${scope}: ${first.message}`
      + (errors.length > 0 ? ` | errors=${errors.length}` : '')
      + (warnings.length > 0 ? ` | warnings=${warnings.length}` : '');
    showTransientDiagnostic(summary);
  }, [showTransientDiagnostic]);

  // Undo/Redo history — snapshots are pushed explicitly at interaction boundaries
  interface HistorySnapshot {
    elements: ModelElement[];
    relationships: ModelRelationship[];
    views: ModelView[];
    diagramNodesByView: DiagramNodesByView;
    diagramConnectionsByView: DiagramConnectionsByView;
    organizationBaseDocument: CanonicalModelDocument | null;
  }
  const historyRef = useRef<HistorySnapshot[]>([{
    elements: SAMPLE_ELEMENTS.map(e => ({ ...e })),
    relationships: SAMPLE_RELATIONSHIPS.map(r => ({ ...r, waypoints: [...r.waypoints] })),
    views: SAMPLE_VIEWS.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
    diagramNodesByView: cloneDiagramNodesByView(buildDiagramStateFromEditorModel(SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS).diagramNodesByView),
    diagramConnectionsByView: cloneDiagramConnectionsByView(buildDiagramStateFromEditorModel(SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS).diagramConnectionsByView),
    organizationBaseDocument: null,
  }]);
  const historyIndexRef = useRef(0);

  // Snapshot the current state into the refs so pushHistory can read it synchronously
  const elementsRef = useRef(elements);
  const relationshipsRef = useRef(relationships);
  const viewsRef = useRef(views);
  const organizationBaseDocumentRef = useRef<CanonicalModelDocument | null>(null);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { relationshipsRef.current = relationships; }, [relationships]);
  useEffect(() => { viewsRef.current = views; }, [views]);
  useEffect(() => { organizationBaseDocumentRef.current = organizationBaseDocument; }, [organizationBaseDocument]);

  /** Call BEFORE a mutation to save the current state as an undo point */
  const pushHistory = useCallback(() => {
    saveViewLayoutSnapshotRef.current(currentViewId);
    const snapshot: HistorySnapshot = {
      elements: elementsRef.current.map(e => ({ ...e })),
      relationships: relationshipsRef.current.map(r => ({ ...r, waypoints: [...r.waypoints] })),
      views: viewsRef.current.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
      diagramNodesByView: cloneDiagramNodesByView(diagramNodesByViewRef.current),
      diagramConnectionsByView: cloneDiagramConnectionsByView(diagramConnectionsByViewRef.current),
      organizationBaseDocument: cloneCanonicalDocument(organizationBaseDocumentRef.current),
    };
    // Trim forward history
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    historyIndexRef.current = historyRef.current.length - 1;
    // Bound history
    if (historyRef.current.length > 100) {
      historyRef.current = historyRef.current.slice(-80);
      historyIndexRef.current = historyRef.current.length - 1;
    }
  }, [currentViewId]);

  const applySnapshot = useCallback((snap: HistorySnapshot) => {
    setElements(snap.elements.map(e => ({ ...e })));
    setRelationships(snap.relationships.map(r => ({ ...r, waypoints: [...r.waypoints] })));
    setViews(snap.views.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })));
    diagramNodesByViewRef.current = cloneDiagramNodesByView(snap.diagramNodesByView);
    diagramConnectionsByViewRef.current = cloneDiagramConnectionsByView(snap.diagramConnectionsByView);
    setOrganizationBaseDocument(cloneCanonicalDocument(snap.organizationBaseDocument));
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    // Save current state as the "redo" point if we're at the tip
    if (historyIndexRef.current === historyRef.current.length - 1) {
      saveViewLayoutSnapshotRef.current(currentViewId);
      const current: HistorySnapshot = {
        elements: elementsRef.current.map(e => ({ ...e })),
        relationships: relationshipsRef.current.map(r => ({ ...r, waypoints: [...r.waypoints] })),
        views: viewsRef.current.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
        diagramNodesByView: cloneDiagramNodesByView(diagramNodesByViewRef.current),
        diagramConnectionsByView: cloneDiagramConnectionsByView(diagramConnectionsByViewRef.current),
        organizationBaseDocument: cloneCanonicalDocument(organizationBaseDocumentRef.current),
      };
      historyRef.current.push(current);
    }
    historyIndexRef.current -= 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
  }, [applySnapshot, currentViewId]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
  }, [applySnapshot]);

  const initialLayouts = useMemo(
    () => buildLayoutsFromEditorModel(SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS),
    [],
  );
  const initialDiagramState = useMemo(
    () => buildDiagramStateFromEditorModel(SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS),
    [],
  );
  const elementLayoutsByViewRef = useRef<ElementLayoutsByView>(initialLayouts.elementLayouts);
  const relationshipLayoutsByViewRef = useRef<RelationshipLayoutsByView>(initialLayouts.relationshipLayouts);
  const diagramNodesByViewRef = useRef<DiagramNodesByView>(initialDiagramState.diagramNodesByView);
  const diagramConnectionsByViewRef = useRef<DiagramConnectionsByView>(initialDiagramState.diagramConnectionsByView);
  const fragmentedSourceDocumentRef = useRef<CanonicalModelDocument | null>(null);

  const modelFormats = useMemo(() => listModelFormats(), []);
  const viewTemplates = useMemo(
    () => [...customViewTemplates, ...VIEW_TEMPLATES],
    [customViewTemplates],
  );

  const selectedFormatId = ioFormatId === 'auto' ? 'openarchi-json' : ioFormatId;
  const activeView = useMemo(() => {
    if (views.length === 0) return null;
    return views.find(view => view.id === currentViewId) || views[0];
  }, [views, currentViewId]);
  const activeViewpoint = activeView?.viewpoint;
  const allowedLayersForActiveView = useMemo(() => getAllowedLayersForViewpoint(activeViewpoint), [activeViewpoint]);
  const allowedElementTypesForActiveView = useMemo(() => getAllowedElementTypesForViewpoint(activeViewpoint), [activeViewpoint]);

  useEffect(() => {
    if (allowedLayersForActiveView.includes(activeLayer)) return;
    setActiveLayer(allowedLayersForActiveView[0] || 'business');
  }, [activeLayer, allowedLayersForActiveView]);

  const visibleElementIds = useMemo(() => {
    if (!activeView) {
      return new Set(elements.map(element => element.id));
    }
    return new Set(activeView.elementIds || []);
  }, [activeView, elements]);

  const visibleElements = useMemo(
    () => elements.filter(element => visibleElementIds.has(element.id)),
    [elements, visibleElementIds],
  );

  const visibleDiagramElements = useMemo<DiagramElementInstance[]>(() => {
    const nodes = diagramNodesByViewRef.current[currentViewId] || [];
    if (nodes.length === 0) {
      return visibleElements.map(element => ({ ...element, elementId: element.id }));
    }

    const elementById = new Map(elements.map(element => [element.id, element]));
    const diagramElements: DiagramElementInstance[] = [];
    for (const node of nodes) {
      const element = elementById.get(node.elementId);
      if (!element) continue;
      diagramElements.push({
          ...element,
          id: node.id,
          elementId: node.elementId,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          linkedViewId: node.linkedViewId ?? element.linkedViewId,
          zIndex: node.zIndex ?? node.nestingDepth ?? element.zIndex,
          style: node.style ?? element.style,
        });
    }
    return diagramElements;
  }, [currentViewId, elements, visibleElements, diagramStateVersion]);

  const visibleSemanticRelationships = useMemo(
    () => {
      // Build element lookup for containment checks
      const elMap = new Map(elements.map(e => [e.id, e]));

      const visible = relationships.filter(relationship => {
        if (!visibleElementIds.has(relationship.sourceId) || !visibleElementIds.has(relationship.targetId)) return false;

        // Hide connections between parent and child when one visually contains the other.
        // This matches Archi's behavior of hiding nested connections for composition/aggregation.
        const src = elMap.get(relationship.sourceId);
        const tgt = elMap.get(relationship.targetId);
        if (src && tgt) {
          const srcContainsTgt = tgt.x >= src.x && tgt.y >= src.y &&
            tgt.x + tgt.w <= src.x + src.w && tgt.y + tgt.h <= src.y + src.h;
          const tgtContainsSrc = src.x >= tgt.x && src.y >= tgt.y &&
            src.x + src.w <= tgt.x + tgt.w && src.y + src.h <= tgt.y + tgt.h;
          if (srcContainsTgt || tgtContainsSrc) return false;
        }

        return true;
      });
      return visible;
    },
    [relationships, visibleElementIds, elements],
  );

  useEffect(() => {
    if (relationships.length > 0 && visibleSemanticRelationships.length === 0 && visibleElementIds.size > 0) {
      const sample = relationships.slice(0, 3);
      const elSample = Array.from(visibleElementIds).slice(0, 3);
      showTransientDiagnostic(
        `${relationships.length} relationships loaded but none visible in current view (${visibleElementIds.size} elements). `
        + `Sample endpoints: ${sample.map(relationship => `${relationship.sourceId}->${relationship.targetId}`).join(', ')}. `
        + `Sample view element IDs: ${elSample.join(', ')}`,
      );
    }
  }, [relationships, visibleSemanticRelationships, visibleElementIds, showTransientDiagnostic]);

  const visibleElementMap = useMemo(
    () => new Map(visibleDiagramElements.map(element => [element.id, element])),
    [visibleDiagramElements],
  );

  const visibleNodeIdsByElementId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const element of visibleDiagramElements) {
      const ids = map.get(element.elementId) || [];
      ids.push(element.id);
      map.set(element.elementId, ids);
    }
    return map;
  }, [visibleDiagramElements]);

  const visibleRelationships = useMemo<DiagramRelationshipInstance[]>(() => {
    const semanticRelationshipsById = new Map(relationships.map(relationship => [relationship.id, relationship]));
    const connections = diagramConnectionsByViewRef.current[currentViewId] || [];
    const nextRelationships: DiagramRelationshipInstance[] = [];

    for (const connection of connections) {
      const semanticRelationship = semanticRelationshipsById.get(connection.relationshipId);
      if (!semanticRelationship) continue;
      const sourceNodeId = connection.sourceNodeId || visibleNodeIdsByElementId.get(semanticRelationship.sourceId)?.[0];
      const targetNodeId = connection.targetNodeId || visibleNodeIdsByElementId.get(semanticRelationship.targetId)?.[0];
      if (!sourceNodeId || !targetNodeId) continue;

      const sourceElement = visibleElementMap.get(sourceNodeId);
      const targetElement = visibleElementMap.get(targetNodeId);
      if (!sourceElement || !targetElement) continue;

      const srcContainsTgt = targetElement.x >= sourceElement.x && targetElement.y >= sourceElement.y &&
        targetElement.x + targetElement.w <= sourceElement.x + sourceElement.w &&
        targetElement.y + targetElement.h <= sourceElement.y + sourceElement.h;
      const tgtContainsSrc = sourceElement.x >= targetElement.x && sourceElement.y >= targetElement.y &&
        sourceElement.x + sourceElement.w <= targetElement.x + targetElement.w &&
        sourceElement.y + sourceElement.h <= targetElement.y + targetElement.h;
      if (srcContainsTgt || tgtContainsSrc) continue;

      nextRelationships.push({
        ...semanticRelationship,
        id: connection.id,
        relationshipId: semanticRelationship.id,
        sourceId: sourceNodeId,
        targetId: targetNodeId,
        sourceNodeId,
        targetNodeId,
        waypoints: connection.waypoints || [],
        labelPos: connection.labelPos ?? 0.5,
        relativeBendpoints: connection.relativeBendpoints,
      });
    }

    if (nextRelationships.length > 0 || connections.length > 0) return nextRelationships;

    return visibleSemanticRelationships.flatMap(relationship => {
      const sourceNodeId = visibleNodeIdsByElementId.get(relationship.sourceId)?.[0];
      const targetNodeId = visibleNodeIdsByElementId.get(relationship.targetId)?.[0];
      if (!sourceNodeId || !targetNodeId) return [];
      return [{
        ...relationship,
        id: `${currentViewId}::${relationship.id}`,
        relationshipId: relationship.id,
        sourceId: sourceNodeId,
        targetId: targetNodeId,
        sourceNodeId,
        targetNodeId,
      }];
    });
  }, [currentViewId, relationships, visibleSemanticRelationships, visibleElementMap, visibleNodeIdsByElementId, diagramStateVersion]);

  const saveViewLayoutSnapshot = useCallback((viewId: string) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;

    const memberIds = new Set(view.elementIds || []);
    const elementById = new Map(elements.map(element => [element.id, element]));
    const relationshipById = new Map(relationships.map(relationship => [relationship.id, relationship]));
    const existingNodes = diagramNodesByViewRef.current[viewId] || [];
    const nextNodes: DiagramNodeState[] = [];
    const representedElementIds = new Set<string>();

    for (const node of existingNodes) {
      if (!memberIds.has(node.elementId)) continue;
      const element = elementById.get(node.elementId);
      if (!element) continue;
      nextNodes.push({
        ...node,
        linkedViewId: node.linkedViewId ?? element.linkedViewId,
        zIndex: node.zIndex ?? element.zIndex,
        nestingDepth: node.nestingDepth ?? node.zIndex ?? element.zIndex ?? 0,
        style: node.style ?? element.style,
      });
      representedElementIds.add(node.elementId);
    }

    for (const element of elements) {
      if (!memberIds.has(element.id) || representedElementIds.has(element.id)) continue;
      nextNodes.push({
        id: `${viewId}::${element.id}`,
        viewId,
        elementId: element.id,
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        linkedViewId: element.linkedViewId,
        zIndex: element.zIndex,
        nestingDepth: element.zIndex ?? 0,
        style: element.style,
      });
    }

    const normalizedNodes = normalizeDiagramNodeHierarchy(nextNodes);

    const existingConnections = diagramConnectionsByViewRef.current[viewId] || [];
    const nextConnections: DiagramConnectionState[] = [];
    const representedRelationshipIds = new Set<string>();
    const nodeIdsByElementId = new Map<string, string[]>();

    for (const node of normalizedNodes) {
      const nodeIds = nodeIdsByElementId.get(node.elementId) || [];
      nodeIds.push(node.id);
      nodeIdsByElementId.set(node.elementId, nodeIds);
      elementLayoutsByViewRef.current[viewId] = {
        ...(elementLayoutsByViewRef.current[viewId] || {}),
        [node.elementId]: {
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          linkedViewId: node.linkedViewId,
          zIndex: node.zIndex,
          style: node.style,
        },
      };
    }

    for (const connection of existingConnections) {
      const relationship = relationshipById.get(connection.relationshipId);
      if (!relationship) continue;
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      nextConnections.push({
        ...connection,
        sourceNodeId: connection.sourceNodeId || nodeIdsByElementId.get(relationship.sourceId)?.[0],
        targetNodeId: connection.targetNodeId || nodeIdsByElementId.get(relationship.targetId)?.[0],
      });
      representedRelationshipIds.add(connection.relationshipId);
      relationshipLayoutsByViewRef.current[viewId] = {
        ...(relationshipLayoutsByViewRef.current[viewId] || {}),
        [connection.relationshipId]: {
          waypoints: connection.waypoints || [],
          labelPos: connection.labelPos ?? 0.5,
          relativeBendpoints: connection.relativeBendpoints,
        },
      };
    }

    for (const relationship of relationships) {
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      if (representedRelationshipIds.has(relationship.id)) continue;
      nextConnections.push({
        id: `${viewId}::${relationship.id}`,
        viewId,
        relationshipId: relationship.id,
        sourceNodeId: nodeIdsByElementId.get(relationship.sourceId)?.[0],
        targetNodeId: nodeIdsByElementId.get(relationship.targetId)?.[0],
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
        relativeBendpoints: relationship.relativeBendpoints,
      });
      relationshipLayoutsByViewRef.current[viewId] = {
        ...(relationshipLayoutsByViewRef.current[viewId] || {}),
        [relationship.id]: {
          waypoints: relationship.waypoints || [],
          labelPos: relationship.labelPos ?? 0.5,
          relativeBendpoints: relationship.relativeBendpoints,
        },
      };
    }

    elementLayoutsByViewRef.current = {
      ...elementLayoutsByViewRef.current,
      [viewId]: Object.fromEntries(normalizedNodes.map(node => [node.elementId, {
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        linkedViewId: node.linkedViewId,
        zIndex: node.zIndex,
        style: node.style,
      }])),
    };
    relationshipLayoutsByViewRef.current = {
      ...relationshipLayoutsByViewRef.current,
      [viewId]: Object.fromEntries(nextConnections.map(connection => [connection.relationshipId, {
        waypoints: connection.waypoints || [],
        labelPos: connection.labelPos ?? 0.5,
        relativeBendpoints: connection.relativeBendpoints,
      }])),
    };
    diagramNodesByViewRef.current = {
      ...diagramNodesByViewRef.current,
      [viewId]: normalizedNodes,
    };
    diagramConnectionsByViewRef.current = {
      ...diagramConnectionsByViewRef.current,
      [viewId]: nextConnections,
    };
  }, [views, elements, relationships]);
  saveViewLayoutSnapshotRef.current = saveViewLayoutSnapshot;

  const applyViewLayout = useCallback((viewId: string) => {
    const elementLayout = elementLayoutsByViewRef.current[viewId] || {};

    setElements(prev => prev.map(element => {
      const layout = elementLayout[element.id];
      if (!layout) return element;
      return {
        ...element,
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        linkedViewId: layout.linkedViewId,
        zIndex: layout.zIndex ?? element.zIndex ?? 0,
        style: layout.style ?? element.style,
      };
    }));
  }, []);

  const buildFragmentedSaveDocument = useCallback((): CanonicalModelDocument | null => {
    const base = fragmentedSourceDocumentRef.current;
    if (!base) return null;

    const normalizedNodesByView = Object.fromEntries(
      Object.entries(diagramNodesByViewRef.current).map(([viewId, nodes]) => [viewId, normalizeDiagramNodeHierarchy(nodes)]),
    );

    return {
      ...base,
      viewNodes: Object.values(normalizedNodesByView).flat().map(node => ({
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
        nestingDepth: node.nestingDepth ?? node.zIndex ?? 0,
      })),
      viewConnections: Object.values(diagramConnectionsByViewRef.current).flat().map(connection => ({
        id: connection.id,
        viewId: connection.viewId,
        relationshipId: connection.relationshipId,
        sourceNodeId: connection.sourceNodeId,
        targetNodeId: connection.targetNodeId,
        waypoints: connection.waypoints,
        labelPosition: connection.labelPos,
        relativeBendpoints: connection.relativeBendpoints,
      })),
    };
  }, []);

  const buildEditorModelForExport = useCallback((): OpenArchiModel => ({
    version: 'openarchi-0.1',
    elements,
    relationships,
    views,
    diagramNodes: Object.values(diagramNodesByViewRef.current).flat().map(node => ({
      id: node.id,
      viewId: node.viewId,
      elementId: node.elementId,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      linkedViewId: node.linkedViewId,
      zIndex: node.zIndex,
      style: node.style,
      parentNodeId: node.parentNodeId,
      nestingDepth: node.nestingDepth,
    })),
    diagramConnections: Object.values(diagramConnectionsByViewRef.current).flat().map(connection => ({
      id: connection.id,
      viewId: connection.viewId,
      relationshipId: connection.relationshipId,
      sourceNodeId: connection.sourceNodeId,
      targetNodeId: connection.targetNodeId,
      waypoints: connection.waypoints,
      labelPos: connection.labelPos,
      relativeBendpoints: connection.relativeBendpoints,
    })),
  }), [elements, relationships, views]);

  const organizationTree = useMemo(() => buildOrganizationTree({
    document: organizationBaseDocument,
    elements,
    relationships,
    views,
  }), [organizationBaseDocument, elements, relationships, views]);

  useEffect(() => {
    if (!organizationTree && leftNavMode === 'model') setLeftNavMode('views');
  }, [organizationTree, leftNavMode]);

  const currentNodeElementIdById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of diagramNodesByViewRef.current[currentViewId] || []) {
      map.set(node.id, node.elementId);
    }
    return map;
  }, [currentViewId, visibleDiagramElements]);

  const updateCurrentDiagramNode = useCallback((nodeId: string, updater: (node: DiagramNodeState) => DiagramNodeState) => {
    const nodes = diagramNodesByViewRef.current[currentViewId] || [];
    diagramNodesByViewRef.current = {
      ...diagramNodesByViewRef.current,
      [currentViewId]: nodes.map(node => node.id === nodeId ? updater(node) : node),
    };
    setDiagramStateVersion(version => version + 1);
  }, [currentViewId]);

  const appendCurrentDiagramNode = useCallback((node: DiagramNodeState) => {
    const nodes = diagramNodesByViewRef.current[currentViewId] || [];
    diagramNodesByViewRef.current = {
      ...diagramNodesByViewRef.current,
      [currentViewId]: [...nodes, node],
    };
    setDiagramStateVersion(version => version + 1);
  }, [currentViewId]);

  const removeDiagramNodesForElement = useCallback((elementId: string) => {
    let changed = false;
    const next: DiagramNodesByView = {};
    for (const [viewId, nodes] of Object.entries(diagramNodesByViewRef.current)) {
      const filtered = nodes.filter(node => node.elementId !== elementId);
      next[viewId] = filtered;
      if (filtered.length !== nodes.length) changed = true;
    }
    if (!changed) return;
    diagramNodesByViewRef.current = next;
    setDiagramStateVersion(version => version + 1);
  }, []);

  const updateCurrentDiagramConnection = useCallback((connectionId: string, updater: (connection: DiagramConnectionState) => DiagramConnectionState) => {
    const connections = diagramConnectionsByViewRef.current[currentViewId] || [];
    diagramConnectionsByViewRef.current = {
      ...diagramConnectionsByViewRef.current,
      [currentViewId]: connections.map(connection => connection.id === connectionId ? updater(connection) : connection),
    };
    setDiagramStateVersion(version => version + 1);
  }, [currentViewId]);

  const appendCurrentDiagramConnection = useCallback((connection: DiagramConnectionState) => {
    const connections = diagramConnectionsByViewRef.current[currentViewId] || [];
    diagramConnectionsByViewRef.current = {
      ...diagramConnectionsByViewRef.current,
      [currentViewId]: [...connections, connection],
    };
    setDiagramStateVersion(version => version + 1);
  }, [currentViewId]);

  const removeDiagramConnectionsForRelationship = useCallback((relationshipId: string) => {
    let changed = false;
    const next: DiagramConnectionsByView = {};
    for (const [viewId, connections] of Object.entries(diagramConnectionsByViewRef.current)) {
      const filtered = connections.filter(connection => connection.relationshipId !== relationshipId);
      next[viewId] = filtered;
      if (filtered.length !== connections.length) changed = true;
    }
    if (!changed) return;
    diagramConnectionsByViewRef.current = next;
    setDiagramStateVersion(version => version + 1);
  }, []);

  const removeDiagramConnectionsForElement = useCallback((elementId: string) => {
    const relationshipIds = new Set(
      relationshipsRef.current
        .filter(relationship => relationship.sourceId === elementId || relationship.targetId === elementId)
        .map(relationship => relationship.id),
    );
    if (relationshipIds.size === 0) return;

    let changed = false;
    const next: DiagramConnectionsByView = {};
    for (const [viewId, connections] of Object.entries(diagramConnectionsByViewRef.current)) {
      const filtered = connections.filter(connection => !relationshipIds.has(connection.relationshipId));
      next[viewId] = filtered;
      if (filtered.length !== connections.length) changed = true;
    }
    if (!changed) return;
    diagramConnectionsByViewRef.current = next;
    setDiagramStateVersion(version => version + 1);
  }, []);

  // ==================== CAMERA ====================
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, s: 1 });
  const camRef = useRef<Camera>(cam);
  const [cSize, setCSize] = useState({ w: 800, h: 600 });

  // Keep camRef in sync when React state updates (e.g. fitToContent, view switch)
  useEffect(() => { camRef.current = cam; }, [cam]);

  // rAF-throttled camera updates — bypasses React during pan/zoom for performance.
  // Updates camRef immediately (for drawing) and batches a single setCam per frame
  // (so React state stays in sync for non-draw consumers).
  const camRafRef = useRef(0);
  const setCamThrottled = useCallback((next: Camera | ((prev: Camera) => Camera)) => {
    const resolved = typeof next === 'function' ? next(camRef.current) : next;
    camRef.current = resolved;
    if (!camRafRef.current) {
      camRafRef.current = requestAnimationFrame(() => {
        camRafRef.current = 0;
        setCam(camRef.current);
        drawCanvasRef.current();
      });
    }
  }, []);

  // Fit camera to show all elements with padding
  const fitToContent = useCallback((els?: ModelElement[]) => {
    const targets = els ?? elements;
    if (targets.length === 0) return;

    const minX = Math.min(...targets.map(e => e.x));
    const minY = Math.min(...targets.map(e => e.y));
    const maxX = Math.max(...targets.map(e => e.x + e.w));
    const maxY = Math.max(...targets.map(e => e.y + e.h));

    const contentW = maxX - minX;
    const contentH = maxY - minY;
    if (contentW < 1 || contentH < 1) return;

    const pad = 60;
    const canvasW = cSize.w;
    const canvasH = cSize.h;

    const scaleX = canvasW / (contentW + pad * 2);
    const scaleY = canvasH / (contentH + pad * 2);
    const s = Math.min(scaleX, scaleY, 1.5);

    const cx = minX + contentW / 2;
    const cy = minY + contentH / 2;

    setCam({
      s,
      x: canvasW / 2 - cx * s,
      y: canvasH / 2 - cy * s,
    });
  }, [elements, cSize]);

  // ==================== BACK / FORWARD NAVIGATION ====================
  const viewHistory = useRef<string[]>(['v1']);
  const historyIdx = useRef(0);
  const isNavAction = useRef(false);

  const navigateToView = useCallback((id: string) => {
    if (id !== currentViewId) {
      saveViewLayoutSnapshot(currentViewId);
      applyViewLayout(id);
    }

    if (!isNavAction.current) {
      // Trim forward history and push
      viewHistory.current = viewHistory.current.slice(0, historyIdx.current + 1);
      viewHistory.current.push(id);
      historyIdx.current = viewHistory.current.length - 1;
    }
    isNavAction.current = false;
    setCurrentViewId(id);
    setOpenTabIds(prev => prev.includes(id) ? prev : [...prev, id]);

    // Fit camera to the new view's content using layout data
    const layoutEls = elementLayoutsByViewRef.current[id];
    if (layoutEls) {
      const laidOut = elements
        .filter(e => layoutEls[e.id])
        .map(e => ({ ...e, ...layoutEls[e.id], w: layoutEls[e.id].w, h: layoutEls[e.id].h }));
      if (laidOut.length > 0) fitToContent(laidOut);
    }
  }, [currentViewId, saveViewLayoutSnapshot, applyViewLayout, elements, fitToContent]);

  const canGoBack = historyIdx.current > 0;
  const canGoForward = historyIdx.current < viewHistory.current.length - 1;

  const goBack = useCallback(() => {
    if (historyIdx.current > 0) {
      historyIdx.current--;
      isNavAction.current = true;
      navigateToView(viewHistory.current[historyIdx.current]);
    }
  }, [navigateToView]);

  const goForward = useCallback(() => {
    if (historyIdx.current < viewHistory.current.length - 1) {
      historyIdx.current++;
      isNavAction.current = true;
      navigateToView(viewHistory.current[historyIdx.current]);
    }
  }, [navigateToView]);

  const closeTab = useCallback((id: string) => {
    setOpenTabIds(prev => {
      const next = prev.filter(t => t !== id);
      if (next.length === 0) return prev;
      if (id === currentViewId) {
        const nextViewId = next[next.length - 1];
        saveViewLayoutSnapshot(currentViewId);
        applyViewLayout(nextViewId);
        setCurrentViewId(nextViewId);
      }
      return next;
    });
  }, [currentViewId, saveViewLayoutSnapshot, applyViewLayout]);

  const deleteViewById = useCallback((viewId: string) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;
    if (views.length <= 1) {
      alert('At least one view must remain in the model.');
      return;
    }
    if (!window.confirm(`Delete view "${view.name}"? This removes the diagram only and keeps the concepts in the model.`)) return;

    const parentView = views.find(candidate => (candidate.childViewIds || []).includes(viewId));
    const siblingViews = views.filter(candidate => candidate.id !== viewId);
    const nextViewId = currentViewId === viewId
      ? (view.childViewIds?.[0] || parentView?.id || siblingViews[0]?.id || currentViewId)
      : currentViewId;

    pushHistory();

    setViews(prev => prev
      .filter(candidate => candidate.id !== viewId)
      .map(candidate => {
        const withoutDeleted = (candidate.childViewIds || []).filter(childId => childId !== viewId);
        if (candidate.id !== parentView?.id) {
          return withoutDeleted.length === (candidate.childViewIds || []).length
            ? candidate
            : { ...candidate, childViewIds: withoutDeleted };
        }
        const reparented = [...withoutDeleted];
        for (const childId of view.childViewIds || []) {
          if (!reparented.includes(childId)) reparented.push(childId);
        }
        return { ...candidate, childViewIds: reparented };
      }));

    setElements(prev => prev.map(element => (
      element.linkedViewId === viewId ? { ...element, linkedViewId: undefined } : element
    )));

    delete elementLayoutsByViewRef.current[viewId];
    delete relationshipLayoutsByViewRef.current[viewId];
    delete diagramNodesByViewRef.current[viewId];
    delete diagramConnectionsByViewRef.current[viewId];

    for (const [otherViewId, layouts] of Object.entries(elementLayoutsByViewRef.current)) {
      let changed = false;
      const nextLayouts: Record<string, ElementViewLayout> = {};
      for (const [elementId, layout] of Object.entries(layouts)) {
        if (layout.linkedViewId === viewId) {
          nextLayouts[elementId] = { ...layout, linkedViewId: undefined };
          changed = true;
        } else {
          nextLayouts[elementId] = layout;
        }
      }
      if (changed) elementLayoutsByViewRef.current[otherViewId] = nextLayouts;
    }

    for (const [otherViewId, nodes] of Object.entries(diagramNodesByViewRef.current)) {
      let changed = false;
      const nextNodes = nodes.map(node => {
        if (node.linkedViewId !== viewId) return node;
        changed = true;
        return { ...node, linkedViewId: undefined };
      });
      if (changed) diagramNodesByViewRef.current[otherViewId] = nextNodes;
    }

    viewHistory.current = viewHistory.current.filter(id => id !== viewId);
    if (!viewHistory.current.includes(nextViewId)) viewHistory.current.push(nextViewId);
    historyIdx.current = Math.max(0, viewHistory.current.lastIndexOf(nextViewId));

    setOpenTabIds(prev => {
      const next = prev.filter(id => id !== viewId);
      return next.includes(nextViewId) ? next : [...next, nextViewId];
    });

    if (currentViewId === viewId) {
      applyViewLayout(nextViewId);
      setCurrentViewId(nextViewId);
    }

    if (selectedId === viewId) {
      setSelectedId(null);
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
      setSelType(null);
    }

    if (editingTabId === viewId) setEditingTabId(null);
    setDiagramStateVersion(version => version + 1);
  }, [applyViewLayout, currentViewId, editingTabId, pushHistory, selectedId, views]);

  // Resize observer
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setCSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const s2w = useCallback((sx: number, sy: number) => ({
    x: (sx - camRef.current.x) / camRef.current.s,
    y: (sy - camRef.current.y) / camRef.current.s,
  }), []);

  // Pre-compute parent IDs — prefer structural data from import, fall back to spatial detection.
  // The spatial fallback is O(n^2) so we cache it and only recompute when elements are
  // added/removed/resized (not when they move during drag).
  const spatialParentCacheRef = useRef<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });

  const parentIds = useMemo(() => {
    const ids = new Set<string>();

    const currentNodes = diagramNodesByViewRef.current[currentViewId] || [];
    for (const node of currentNodes) {
      if (node.parentNodeId) ids.add(node.parentNodeId);
    }

    // If structural data exists, use it directly (fast path)
    if (ids.size > 0) return ids;

    // Spatial fallback — cache key is element IDs + sizes (position changes don't affect containment during drag)
    if (visibleDiagramElements.length > 0) {
      const cacheKey = visibleDiagramElements.map(el => `${el.id}:${el.w}:${el.h}`).join(',');
      if (spatialParentCacheRef.current.key === cacheKey) {
        return spatialParentCacheRef.current.ids;
      }

      const n = visibleDiagramElements.length;
      if (n < 200) {
        for (const outer of visibleDiagramElements) {
          for (const inner of visibleDiagramElements) {
            if (inner.id === outer.id) continue;
            if (inner.x >= outer.x && inner.y >= outer.y &&
                inner.x + inner.w <= outer.x + outer.w &&
                inner.y + inner.h <= outer.y + outer.h) {
              ids.add(outer.id);
              break;
            }
          }
        }
      } else {
        const byArea = [...visibleDiagramElements].sort((a, b) => (b.w * b.h) - (a.w * a.h));
        for (let i = 0; i < byArea.length && !ids.has(byArea[i].id); i++) {
          const outer = byArea[i];
          for (let j = i + 1; j < byArea.length; j++) {
            const inner = byArea[j];
            if (inner.x >= outer.x && inner.y >= outer.y &&
                inner.x + inner.w <= outer.x + outer.w &&
                inner.y + inner.h <= outer.y + outer.h) {
              ids.add(outer.id);
              break;
            }
          }
        }
      }
      spatialParentCacheRef.current = { key: cacheKey, ids };
    }
    return ids;
  }, [currentViewId, visibleDiagramElements]);

  // Archi draw order: containers behind children, composites behind non-composites.
  // Sort by: 1) nesting depth (zIndex), 2) composites → regular → viewRefs, 3) area descending
  const sortedElements = useMemo(() => {
    const sortKey = (el: ModelElement): number => {
      if (el.type === 'viewReference') return 2; // on top of siblings
      const layer = ELEMENT_TYPES[el.type]?.layer;
      if (layer === 'composite' && el.type !== 'note') return 0; // behind everything
      return 1; // regular elements
    };
    return [...visibleDiagramElements].sort((a, b) => {
      // Primary: lower zIndex draws first (parents behind children)
      const za = a.zIndex ?? 0, zb = b.zIndex ?? 0;
      if (za !== zb) return za - zb;
      // Secondary: composites first, then regular, then view references (on top)
      const ka = sortKey(a), kb = sortKey(b);
      if (ka !== kb) return ka - kb;
      // Tertiary: larger elements draw first (behind smaller ones)
      return (b.w * b.h) - (a.w * a.h);
    });
  }, [visibleDiagramElements]);

  // Track canvas dimensions to avoid unnecessary reallocation
  const canvasDimsRef = useRef({ w: 0, h: 0 });

  // ==================== RENDER LOOP (ref-based for performance) ====================
  // Data refs — shadowed from memos so the draw function is stable and reads latest values
  const sortedElementsRef = useRef(sortedElements);
  const parentIdsRef = useRef(parentIds);
  const visibleDiagramElementsRef = useRef(visibleDiagramElements);
  const visibleRelationshipsRef = useRef(visibleRelationships);
  const visibleElementMapRef = useRef(visibleElementMap);
  const selectedConnectionIdRef = useRef(selectedConnectionId);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const selTypeRef = useRef(selType);
  const hovElIdRef = useRef(hovElId);
  const hovRelIdRef = useRef(hovRelId);
  const drawingRelRef = useRef(drawingRel);
  const gridTypeRef = useRef(gridType);
  const snapGuidesRef = useRef(snapGuides);
  const cSizeRef = useRef(cSize);

  // Keep data refs in sync
  useEffect(() => { sortedElementsRef.current = sortedElements; }, [sortedElements]);
  useEffect(() => { parentIdsRef.current = parentIds; }, [parentIds]);
  useEffect(() => { visibleDiagramElementsRef.current = visibleDiagramElements; }, [visibleDiagramElements]);
  useEffect(() => { visibleRelationshipsRef.current = visibleRelationships; }, [visibleRelationships]);
  useEffect(() => { visibleElementMapRef.current = visibleElementMap; }, [visibleElementMap]);
  useEffect(() => { selectedConnectionIdRef.current = selectedConnectionId; }, [selectedConnectionId]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);
  useEffect(() => { selTypeRef.current = selType; }, [selType]);
  useEffect(() => { hovElIdRef.current = hovElId; }, [hovElId]);
  useEffect(() => { hovRelIdRef.current = hovRelId; }, [hovRelId]);
  useEffect(() => { drawingRelRef.current = drawingRel; }, [drawingRel]);
  useEffect(() => { gridTypeRef.current = gridType; }, [gridType]);
  useEffect(() => { snapGuidesRef.current = snapGuides; }, [snapGuides]);
  useEffect(() => { cSizeRef.current = cSize; }, [cSize]);

  // Cached crossing segments — recomputed only when data changes, reused during pan
  const crossingSegsRef = useRef<{ relId: string; x1: number; y1: number; x2: number; y2: number }[]>([]);
  const crossingSegsVersionRef = useRef(-1);

  // Stable draw function — reads everything from refs, callable from RAF or React effects
  const drawCanvasRef = useRef(() => {});
  drawCanvasRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const _cam = camRef.current;
    const _cSize = cSizeRef.current;
    const _sortedElements = sortedElementsRef.current;
    const _parentIds = parentIdsRef.current;
    const _visibleDiagramElements = visibleDiagramElementsRef.current;
    const _visibleRelationships = visibleRelationshipsRef.current;
    const _visibleElementMap = visibleElementMapRef.current;
    const _selectedConnectionId = selectedConnectionIdRef.current;
    const _selectedNodeId = selectedNodeIdRef.current;
    const _selType = selTypeRef.current;
    const _hovElId = hovElIdRef.current;
    const _hovRelId = hovRelIdRef.current;
    const _drawingRel = drawingRelRef.current;
    const _gridType = gridTypeRef.current;
    const _snapGuides = snapGuidesRef.current;

    const dpr = window.devicePixelRatio || 1;
    const pw = _cSize.w * dpr, ph = _cSize.h * dpr;
    if (canvasDimsRef.current.w !== pw || canvasDimsRef.current.h !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = _cSize.w + 'px';
      canvas.style.height = _cSize.h + 'px';
      canvasDimsRef.current = { w: pw, h: ph };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#f5f6f8';
    ctx.fillRect(0, 0, _cSize.w, _cSize.h);
    ctx.save();
    ctx.translate(_cam.x, _cam.y);
    ctx.scale(_cam.s, _cam.s);

    // Grid
    if (_gridType === 'dot') drawDotGrid(ctx, _cSize.w, _cSize.h, _cam.x, _cam.y, _cam.s);
    else drawLineGrid(ctx, _cSize.w, _cSize.h, _cam.x, _cam.y, _cam.s);

    // Viewport culling
    const vpMargin = 100;
    const vpLeft = -_cam.x / _cam.s - vpMargin;
    const vpTop = -_cam.y / _cam.s - vpMargin;
    const vpRight = vpLeft + _cSize.w / _cam.s + vpMargin * 2;
    const vpBottom = vpTop + _cSize.h / _cam.s + vpMargin * 2;

    const inViewport = (el: { x: number; y: number; w: number; h: number }) =>
      el.x + el.w >= vpLeft && el.x <= vpRight && el.y + el.h >= vpTop && el.y <= vpBottom;

    const culledElements = _sortedElements.filter(inViewport);

    // Elements
    for (const el of culledElements) {
      drawElement(
        ctx,
        el,
        _selType === 'element' && _selectedNodeId === el.id,
        (_selType === 'element' && _selectedNodeId === el.id) || _hovElId === el.id,
        _parentIds.has(el.id),
      );
    }

    // Relationships — with cached crossing hops
    const skipCrossings = _visibleRelationships.length > 200;

    if (skipCrossings) {
      for (const r of _visibleRelationships) {
        drawRelationship(ctx, r, _visibleDiagramElements, _selType === 'relationship' && _selectedConnectionId === r.id, _hovRelId === r.id, [], _visibleElementMap);
      }
    } else {
      // Recompute crossing segments only when data version changes
      const currentVersion = diagramStateVersion;
      if (crossingSegsVersionRef.current !== currentVersion) {
        const allRelSegs: RelSegments[] = _visibleRelationships
          .map(r => getRelSegments(r, _visibleDiagramElements, _visibleElementMap))
          .filter((s): s is RelSegments => s !== null);
        crossingSegsRef.current = allRelSegs.flatMap(s => s.segments.map(seg => ({ ...seg, relId: s.relId })));
        crossingSegsVersionRef.current = currentVersion;
      }
      const allFlatSegs = crossingSegsRef.current;

      for (const r of _visibleRelationships) {
        const otherSegs = allFlatSegs.filter(s => s.relId !== r.id);
        drawRelationship(ctx, r, _visibleDiagramElements, _selType === 'relationship' && _selectedConnectionId === r.id, _hovRelId === r.id, otherSegs, _visibleElementMap);
      }
    }

    // Snap guide lines
    if (_snapGuides.length > 0) {
      drawSnapGuides(ctx, _snapGuides, _cSize.w, _cSize.h, _cam.x, _cam.y, _cam.s);
    }

    // Drawing-in-progress relationship
    if (_drawingRel) {
      const src = _drawingRel.sourceNodeId
        ? _visibleDiagramElements.find(element => element.id === _drawingRel.sourceNodeId)
        : _visibleDiagramElements.find(element => element.elementId === _drawingRel.sourceId);
      if (src) {
        const wps = _drawingRel.waypoints;
        const startPt = wps.length > 0 ? wps[0] : null;
        const a = nearestAnchor(src, startPt?.x ?? _drawingRel.mx, startPt?.y ?? _drawingRel.my);
        const col = '#4a5568';
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (const wp of wps) ctx.lineTo(wp.x, wp.y);
        ctx.lineTo(_drawingRel.mx, _drawingRel.my);
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
        const prevPt = wps.length > 0 ? wps[wps.length - 1] : a;
        const dx = _drawingRel.mx - prevPt.x;
        const dy = _drawingRel.my - prevPt.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const angle = Math.atan2(dy, dx);
          const aLen = 11;
          const aSpread = 0.45;
          ctx.beginPath();
          ctx.moveTo(_drawingRel.mx - aLen * Math.cos(angle - aSpread), _drawingRel.my - aLen * Math.sin(angle - aSpread));
          ctx.lineTo(_drawingRel.mx, _drawingRel.my);
          ctx.lineTo(_drawingRel.mx - aLen * Math.cos(angle + aSpread), _drawingRel.my - aLen * Math.sin(angle + aSpread));
          ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        }
        for (const wp of wps) {
          ctx.beginPath(); ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  };

  // Trigger redraw when data changes (NOT camera — that's handled by setCamThrottled's RAF)
  useEffect(() => {
    drawCanvasRef.current();
  }, [visibleDiagramElements, visibleElementMap, visibleRelationships, sortedElements, parentIds, selectedConnectionId, selectedNodeId, selType, cam, cSize, hovElId, hovRelId, drawingRel, gridType, snapGuides]);

  // ==================== MOUSE HANDLERS ====================
  const isViewMode = interactionMode === 'view';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (relPicker || ctxMenu) { setRelPicker(null); setCtxMenu(null); setShowChangelog(false); return; }
    if (editingElId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    // View mode: only allow selection (inspect), panning, and view navigation
    if (isViewMode) {
      const linked = hitTestPopout(visibleDiagramElements, wx, wy);
      if (linked) { navigateToView(linked); return; }

      const el = hitTestElement(visibleDiagramElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
      if (el) {
        setSelectedNodeId(el.id); setSelectedConnectionId(null); setSelectedId(el.elementId); setSelType('element');
      } else {
        const rh = hitTestRelationship(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
        if (rh) { setSelectedNodeId(null); setSelectedConnectionId(rh.rel.id); setSelectedId((rh.rel as DiagramRelationshipInstance).relationshipId); setSelType('relationship'); }
        else { setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null); setPanning({ sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y }); }
      }
      return;
    }

    // During relationship drawing: click on element = complete, click on empty = add waypoint
    if (drawingRel) {
      const tgtEl = hitTestElement(sortedElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
      if (tgtEl && tgtEl.id !== drawingRel.sourceNodeId) {
        // Clicked on target element — complete the connection (handled in mouseUp)
        // Let it fall through to normal handling
      } else {
        // Clicked on empty space or same element — add waypoint
        setDrawingRel(prev => prev ? { ...prev, waypoints: [...prev.waypoints, { x: snap(wx), y: snap(wy) }] } : null);
        return;
      }
    }

    const linked = hitTestPopout(visibleDiagramElements, wx, wy);
    if (linked) { navigateToView(linked); return; }

    // Resize handles take priority over everything (they overlap anchor zones at corners)
    if (selType === 'element' && selectedNodeId) {
      const selEl = visibleDiagramElements.find(e => e.id === selectedNodeId);
      if (selEl) {
        const handle = hitTestResizeHandle(selEl, wx, wy);
        if (handle) {
          pushHistory();
          setResizing({ id: selEl.id, handle, startWx: wx, startWy: wy, origX: selEl.x, origY: selEl.y, origW: selEl.w, origH: selEl.h });
          return;
        }
      }
    }

    const anch = hitTestAnchor(sortedElements, wx, wy, getLayer, isNote);
    if (anch) {
      setDrawingRel({ sourceId: currentNodeElementIdById.get(anch.elId) || anch.elId, sourceNodeId: anch.elId, mx: wx, my: wy, waypoints: [] });
      return;
    }

    // Endpoint dragging — only when a relationship is selected
    if (selType === 'relationship' && selectedConnectionId) {
      const selRel = visibleRelationships.find(r => r.id === selectedConnectionId);
      if (selRel) {
        const ep = hitTestEndpoint(selRel, visibleDiagramElements, wx, wy, camRef.current.s);
        if (ep) { pushHistory(); setDragEndpoint({ relId: selRel.id, endpoint: ep }); return; }
      }
    }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy, camRef.current.s);
    if (wp) { pushHistory(); setDragWP({ ...wp, startX: wx, startY: wy }); return; }

    const lbl = hitTestLabel(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
    if (lbl) {
      const relationship = visibleRelationships.find(candidate => candidate.id === lbl.id);
      pushHistory();
      setDragLabel({ relId: lbl.id });
      setSelectedNodeId(null);
      setSelectedConnectionId(lbl.id);
      setSelectedId(relationship?.relationshipId || null);
      setSelType('relationship');
      return;
    }

    const el = hitTestElement(sortedElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
    if (el) {
      setSelectedNodeId(el.id); setSelectedConnectionId(null); setSelectedId(el.elementId); setSelType('element');
      pushHistory();
      setDragging({ id: el.id, ox: wx - el.x, oy: wy - el.y });
    } else {
      const rh = hitTestRelationship(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
      if (rh) {
        setSelectedNodeId(null); setSelectedConnectionId(rh.rel.id); setSelectedId((rh.rel as DiagramRelationshipInstance).relationshipId); setSelType('relationship');
        // If already selected, start segment drag
        if (selType === 'relationship' && selectedConnectionId === rh.rel.id) {
          const orient = getSegmentOrientation(rh.rel, visibleDiagramElements, rh.segIdx, visibleElementMap);
          if (orient) {
            pushHistory();
            setDragSegment({ relId: rh.rel.id, segIdx: rh.segIdx, orientation: orient, startWx: wx, startWy: wy });
          }
        }
      }
      else { setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null); setPanning({ sx: e.clientX, sy: e.clientY, cx: camRef.current.x, cy: camRef.current.y }); }
    }
  }, [s2w, visibleDiagramElements, visibleRelationships, relPicker, ctxMenu, drawingRel, editingElId, navigateToView, selType, selectedConnectionId, selectedNodeId, pushHistory, isViewMode, currentNodeElementIdById]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    if (resizing) {
      const dx = wx - resizing.startWx, dy = wy - resizing.startWy;
      const rh = resizing.handle;
      const fixedLeft = resizing.origX;
      const fixedTop = resizing.origY;
      const fixedRight = resizing.origX + resizing.origW;
      const fixedBottom = resizing.origY + resizing.origH;
      const others = visibleDiagramElements.filter(el => el.id !== resizing.id);
      const snapThresh = 6;

      let left = fixedLeft, top = fixedTop, right = fixedRight, bottom = fixedBottom;
      const guides: SnapGuide[] = [];

      // For each moving edge: try snapping to other element edges, fall back to grid
      if (rh.includes('w')) {
        let raw = fixedLeft + dx;
        let snapped = false;
        for (const o of others) {
          for (const t of [o.x, o.x + o.w]) {
            if (Math.abs(raw - t) < snapThresh) { raw = t; snapped = true; guides.push({ axis: 'x', value: t, type: 'edge' }); break; }
          }
          if (snapped) break;
        }
        left = snapped ? raw : snap(raw);
      }
      if (rh.includes('e')) {
        let raw = fixedRight + dx;
        let snapped = false;
        for (const o of others) {
          for (const t of [o.x, o.x + o.w]) {
            if (Math.abs(raw - t) < snapThresh) { raw = t; snapped = true; guides.push({ axis: 'x', value: t, type: 'edge' }); break; }
          }
          if (snapped) break;
        }
        right = snapped ? raw : snap(raw);
      }
      if (rh.includes('n')) {
        let raw = fixedTop + dy;
        let snapped = false;
        for (const o of others) {
          for (const t of [o.y, o.y + o.h]) {
            if (Math.abs(raw - t) < snapThresh) { raw = t; snapped = true; guides.push({ axis: 'y', value: t, type: 'edge' }); break; }
          }
          if (snapped) break;
        }
        top = snapped ? raw : snap(raw);
      }
      if (rh.includes('s')) {
        let raw = fixedBottom + dy;
        let snapped = false;
        for (const o of others) {
          for (const t of [o.y, o.y + o.h]) {
            if (Math.abs(raw - t) < snapThresh) { raw = t; snapped = true; guides.push({ axis: 'y', value: t, type: 'edge' }); break; }
          }
          if (snapped) break;
        }
        bottom = snapped ? raw : snap(raw);
      }

      // Enforce minimum size
      if (right - left < 60) { if (rh.includes('w')) left = right - 60; else right = left + 60; }
      if (bottom - top < 40) { if (rh.includes('n')) top = bottom - 40; else bottom = top + 40; }

      setSnapGuides(guides);
      updateCurrentDiagramNode(resizing.id, node => ({
        ...node,
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
      }));
      return;
    }
    if (drawingRel) { setDrawingRel(p => p ? { ...p, mx: wx, my: wy } : null); return; }
    if (dragWP) {
      updateCurrentDiagramConnection(dragWP.relId, connection => ({
        ...connection,
        waypoints: connection.waypoints.map((waypoint, index) => index === dragWP.wpIdx ? { x: snap(wx), y: snap(wy) } : waypoint),
        relativeBendpoints: undefined,
      }));
      return;
    }
    if (dragSegment) {
      updateCurrentDiagramConnection(dragSegment.relId, connection => {
        const relationship = visibleRelationships.find(candidate => candidate.id === dragSegment.relId);
        if (!relationship) return connection;
        const pts = getRelPoints(relationship, visibleDiagramElements, visibleElementMap);
        if (!pts) return connection;
        const allPts = [pts.start, ...pts.waypoints, pts.end];
        const si = dragSegment.segIdx;
        const wpCount = pts.waypoints.length;

        if (wpCount === 0) {
          // No waypoints yet — create 2 waypoints to form a 3-segment orthogonal path
          const a = allPts[0], b = allPts[allPts.length - 1];
          if (dragSegment.orientation === 'h') {
            // Horizontal segment → drag vertically → create Z-route
            const newY = snap(wy);
            return { ...connection, waypoints: [{ x: a.x, y: newY }, { x: b.x, y: newY }], relativeBendpoints: undefined };
          } else {
            const newX = snap(wx);
            return { ...connection, waypoints: [{ x: newX, y: a.y }, { x: newX, y: b.y }], relativeBendpoints: undefined };
          }
        }

        // Has waypoints — move the endpoints of the dragged segment
        const newWaypoints = [...pts.waypoints];
        // Segment si connects allPts[si] → allPts[si+1]
        // allPts = [start, wp0, wp1, ..., end]
        // wp index = allPts index - 1

        if (dragSegment.orientation === 'h') {
          // Horizontal segment → move vertically
          const newY = snap(wy);
          // Move the waypoint endpoints of this segment
          if (si > 0 && si - 1 < wpCount) newWaypoints[si - 1] = { ...newWaypoints[si - 1], y: newY };
          if (si < wpCount) newWaypoints[si] = { ...newWaypoints[si], y: newY };
        } else {
          // Vertical segment → move horizontally
          const newX = snap(wx);
          if (si > 0 && si - 1 < wpCount) newWaypoints[si - 1] = { ...newWaypoints[si - 1], x: newX };
          if (si < wpCount) newWaypoints[si] = { ...newWaypoints[si], x: newX };
        }

        return { ...connection, waypoints: newWaypoints, relativeBendpoints: undefined };
      });
      return;
    }
    if (dragEndpoint) {
      const key = dragEndpoint.endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor';
      const relationshipId = visibleRelationships.find(relationship => relationship.id === dragEndpoint.relId)?.relationshipId;
      if (relationshipId) {
        setRelationships(prev => prev.map(r => r.id === relationshipId ? { ...r, [key]: { x: snap(wx), y: snap(wy) } } : r));
      }
      return;
    }
    if (dragLabel) {
      const rel = visibleRelationships.find(r => r.id === dragLabel.relId);
      if (rel) {
        const pts = getRelPoints(rel, visibleDiagramElements, visibleElementMap);
        if (pts) {
          const allPts = [pts.start, ...pts.waypoints, pts.end];
          const newT = nearestTOnPath(allPts, wx, wy);
          updateCurrentDiagramConnection(dragLabel.relId, connection => ({ ...connection, labelPos: newT }));
        }
      }
      return;
    }
    if (dragging) {
      const draggedEl = visibleDiagramElements.find(el => el.id === dragging.id);
      if (draggedEl) {
        const proposedX = snap(wx - dragging.ox);
        const proposedY = snap(wy - dragging.oy);
        const others = visibleDiagramElements.filter(el => el.id !== dragging.id);
        const result = snapToElements({ x: proposedX, y: proposedY, w: draggedEl.w, h: draggedEl.h }, others);
        setSnapGuides(result.guides);

        updateCurrentDiagramNode(dragging.id, node => ({
          ...node,
          x: result.x,
          y: result.y,
        }));
      }
    } else if (panning) {
      setCamThrottled(p => ({ ...p, x: panning.cx + e.clientX - panning.sx, y: panning.cy + e.clientY - panning.sy }));
    } else {
      if (selType === 'element' && selectedNodeId) {
        const selElHov = visibleDiagramElements.find(e => e.id === selectedNodeId);
        if (selElHov) {
          const handle = hitTestResizeHandle(selElHov, wx, wy);
          if (handle) {
            canvas.style.cursor = HANDLE_CURSORS[handle];
            setHovElId(null); setHovRelId(null);
            return;
          }
        }
      }
      const el = hitTestElement(visibleDiagramElements, wx, wy, getLayer, isNote);
      const newHovElId = el?.id || null;
      if (newHovElId !== hovElId) setHovElId(newHovElId);
      if (!el) {
        const rh = hitTestRelationship(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
        const newHovRelId = rh?.rel?.id || null;
        if (newHovRelId !== hovRelId) setHovRelId(newHovRelId);
        canvas.style.cursor = rh ? 'pointer' : 'default';
      } else {
        if (hovRelId !== null) setHovRelId(null);
        canvas.style.cursor = 'default';
      }
    }
  }, [s2w, dragging, panning, visibleDiagramElements, visibleRelationships, visibleElementMap, drawingRel, dragWP, dragEndpoint, dragLabel, dragSegment, resizing, selType, selectedNodeId, hovElId, hovRelId, setCamThrottled, updateCurrentDiagramNode, updateCurrentDiagramConnection]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (drawingRel) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);
      const tgt = hitTestElement(visibleDiagramElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
      if (tgt && tgt.id !== drawingRel.sourceNodeId) {
        relPickerWaypoints.current = drawingRel.waypoints;
        setRelPicker({
          sx: e.clientX - rect.left,
          sy: e.clientY - rect.top,
          srcId: drawingRel.sourceId,
          tgtId: tgt.elementId,
          sourceNodeId: drawingRel.sourceNodeId,
          targetNodeId: tgt.id,
        });
      }
      setDrawingRel(null); return;
    }

    // Archi behavior: when dropping an element onto another element, offer to create a relationship
    if (dragging && !isViewMode) {
      const draggedEl = visibleDiagramElements.find(el => el.id === dragging.id);
      if (draggedEl) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
          // Find element under the center of the dragged element
          const dropTarget = visibleDiagramElements.find(el => {
            if (el.id === dragging.id) return false;
            return draggedEl.x + draggedEl.w / 2 >= el.x && draggedEl.x + draggedEl.w / 2 <= el.x + el.w &&
                   draggedEl.y + draggedEl.h / 2 >= el.y && draggedEl.y + draggedEl.h / 2 <= el.y + el.h;
          });
          // Only offer if no relationship already exists between the two
          if (dropTarget) {
            const alreadyConnected = relationships.some(r =>
              (r.sourceId === draggedEl.elementId && r.targetId === dropTarget.elementId) ||
              (r.sourceId === dropTarget.elementId && r.targetId === draggedEl.elementId)
            );
            if (!alreadyConnected) {
              relPickerWaypoints.current = [];
              setRelPicker({
                sx,
                sy,
                srcId: draggedEl.elementId,
                tgtId: dropTarget.elementId,
                sourceNodeId: draggedEl.id,
                targetNodeId: dropTarget.id,
              });
            }
          }
        }
      }
    }

    setDragging(null); setPanning(null); setDragWP(null); setDragEndpoint(null); setDragLabel(null); setDragSegment(null); setResizing(null);
    setSnapGuides([]);
  }, [drawingRel, dragging, s2w, visibleDiagramElements, relationships, isViewMode]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);

    const el = hitTestElement(visibleDiagramElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
    if (el) {
      // View navigation always allowed
      if (el.linkedViewId) {
        navigateToView(el.linkedViewId);
        return;
      }
      // Inline editing only in edit mode
      if (!isViewMode) {
        setEditingElId(el.elementId);
        setEditingName(el.name);
        setSelectedNodeId(el.id);
        setSelectedConnectionId(null);
        setSelectedId(el.elementId);
        setSelType('element');
      }
      return;
    }

    if (!isViewMode) {
      const rh = hitTestRelationship(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
      if (rh) {
        const relationshipId = (rh.rel as DiagramRelationshipInstance).relationshipId;
        const name = prompt('Relationship label:', rh.rel.name || '');
        if (name !== null) { pushHistory(); setRelationships(prev => prev.map(r => r.id === relationshipId ? { ...r, name } : r)); }
      }
    }
  }, [s2w, visibleDiagramElements, visibleRelationships, navigateToView, isViewMode, pushHistory]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isViewMode) return; // No context menu in view mode
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    const el = hitTestElement(visibleDiagramElements, wx, wy, getLayer, isNote) as DiagramElementInstance | null;
    if (el) {
      setSelectedNodeId(el.id); setSelectedConnectionId(null); setSelectedId(el.elementId); setSelType('element');
      const elTypeDef = ELEMENT_TYPES[el.type];

      // Build "Change type" submenu grouped by layer
      const typesByLayer: Record<string, [string, typeof ELEMENT_TYPES[string]][]> = {};
      for (const [k, v] of Object.entries(ELEMENT_TYPES)) {
        if (v.isNote || k === el.type) continue;
        const layer = v.layer;
        if (!typesByLayer[layer]) typesByLayer[layer] = [];
        typesByLayer[layer].push([k, v]);
      }

      const changeTypeChildren: CtxMenuItem[] = [];
      // Current layer first, then others
      const currentLayer = elTypeDef?.layer;
      const layerOrder = currentLayer
        ? [currentLayer, ...Object.keys(LAYERS).filter(l => l !== currentLayer)]
        : Object.keys(LAYERS);

      for (const layer of layerOrder) {
        const types = typesByLayer[layer];
        if (!types || types.length === 0) continue;
        const L = LAYERS[layer];
        if (changeTypeChildren.length > 0) {
          changeTypeChildren.push({ label: '', separator: true });
        }
        for (const [k, v] of types) {
          changeTypeChildren.push({
            label: v.label,
            icon: k,
            iconColor: L?.accent || '#888',
            action: () => { pushHistory(); setElements(prev => prev.map(e => e.id === el.elementId ? { ...e, type: k } : e)); },
          });
        }
      }

      const items: CtxMenuItem[] = [
        { label: 'Rename', action: () => { setEditingElId(el.elementId); setEditingName(el.name); } },
        { label: 'Change type', children: changeTypeChildren },
        { label: '', separator: true },
        {
          label: 'Bring to front',
          action: () => {
            pushHistory();
            const maxZ = Math.max(0, ...elements.map(e => e.zIndex ?? 0));
            setElements(prev => prev.map(e => e.id === el.elementId ? { ...e, zIndex: maxZ + 1 } : e));
          },
        },
        {
          label: 'Send to back',
          action: () => {
            pushHistory();
            const minZ = Math.min(0, ...elements.map(e => e.zIndex ?? 0));
            setElements(prev => prev.map(e => e.id === el.elementId ? { ...e, zIndex: minZ - 1 } : e));
          },
        },
        { label: '', separator: true },
        {
          label: 'Delete',
          color: '#e07070',
          action: () => {
            pushHistory();
            setElements(prev => prev.filter(e => e.id !== el.elementId));
            setRelationships(prev => prev.filter(r => r.sourceId !== el.elementId && r.targetId !== el.elementId));
            removeDiagramConnectionsForElement(el.elementId);
            setViews(prev => prev.map(view => ({
              ...view,
              elementIds: (view.elementIds || []).filter(elementId => elementId !== el.elementId),
            })));
            setSelectedNodeId(null);
            setSelectedConnectionId(null);
            setSelectedId(null);
            setSelType(null);
          },
        },
      ];

      setCtxMenu({ x: sx, y: sy, items });
      return;
    }

    const rh = hitTestRelationship(visibleRelationships, visibleDiagramElements, wx, wy, camRef.current.s);
    if (rh) {
      const relationshipId = (rh.rel as DiagramRelationshipInstance).relationshipId;
      setSelectedNodeId(null);
      setSelectedConnectionId(rh.rel.id);
      setSelectedId(relationshipId);
      setSelType('relationship');
      setCtxMenu({
        x: sx, y: sy,
        items: [
          {
            label: 'Add waypoint here',
            action: () => {
              pushHistory();
              updateCurrentDiagramConnection(rh.rel.id, connection => {
                const waypoints = [...(connection.waypoints || [])];
                waypoints.splice(rh.segIdx, 0, { x: snap(wx), y: snap(wy) });
                return { ...connection, waypoints, relativeBendpoints: undefined };
              });
            },
          },
          {
            label: 'Edit label',
            action: () => {
              pushHistory();
              const name = prompt('Label:', rh.rel.name || '');
              if (name !== null) setRelationships(prev => prev.map(r => r.id === relationshipId ? { ...r, name } : r));
            },
          },
          ...(rh.rel.waypoints?.length > 0 ? [{
            label: 'Remove all waypoints',
            action: () => {
              pushHistory();
              updateCurrentDiagramConnection(rh.rel.id, connection => ({ ...connection, waypoints: [], relativeBendpoints: undefined }));
            },
          }] : []),
          ...((rh.rel.sourceAnchor || rh.rel.targetAnchor) ? [{
            label: 'Reset endpoints to auto',
            action: () => {
              pushHistory();
              setRelationships(prev => prev.map(r => r.id === relationshipId ? { ...r, sourceAnchor: undefined, targetAnchor: undefined } : r));
            },
          }] : []),
          {
            label: 'Delete relationship',
            color: '#e07070',
            action: () => {
              pushHistory();
              setRelationships(prev => prev.filter(r => r.id !== relationshipId));
              removeDiagramConnectionsForRelationship(relationshipId);
              if (selectedId === relationshipId) {
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                setSelectedId(null);
                setSelType(null);
              }
            },
          },
        ],
      });
      return;
    }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy, camRef.current.s);
    if (wp) {
      setCtxMenu({
        x: sx,
        y: sy,
        items: [{
          label: 'Remove waypoint',
          color: '#e07070',
          action: () => {
            pushHistory();
            updateCurrentDiagramConnection(wp.relId, connection => ({
              ...connection,
              waypoints: connection.waypoints.filter((_, index) => index !== wp.wpIdx),
              relativeBendpoints: undefined,
            }));
          },
        }],
      });
    }
  }, [s2w, visibleDiagramElements, visibleRelationships, selectedId, pushHistory, elements, isViewMode, updateCurrentDiagramConnection, removeDiagramConnectionsForRelationship, removeDiagramConnectionsForElement]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.08 : 0.93;
    const c = camRef.current;
    const ns = Math.min(3, Math.max(0.2, c.s * f));
    const wx = (sx - c.x) / c.s, wy = (sy - c.y) / c.s;
    setCamThrottled({ s: ns, x: sx - wx * ns, y: sy - wy * ns });
  }, [setCamThrottled]);

  // ==================== INLINE EDITING ====================
  const commitEditing = useCallback(() => {
    if (editingElId) {
      pushHistory();
      setElements(prev => prev.map(e => e.id === editingElId ? { ...e, name: editingName } : e));
      setEditingElId(null);
    }
  }, [editingElId, editingName, pushHistory]);

  const cancelEditing = useCallback(() => {
    setEditingElId(null);
  }, []);

  // ==================== ACTIONS ====================
  const addElement = useCallback((type: string) => {
    if (!isElementTypeAllowedInViewpoint(type, activeViewpoint)) {
      const viewpointLabel = getViewpointDefinition(activeViewpoint)?.label || 'active';
      showTransientDiagnostic(`"${ELEMENT_TYPES[type]?.label || type}" is outside the ${viewpointLabel} viewpoint.`);
      return;
    }
    pushHistory();
    const c = s2w(cSize.w / 2, cSize.h / 2);
    const isG = type === 'grouping' || type === 'location';
    const isN = type === 'note';
    const el: ModelElement = {
      id: uid(), type,
      name: isN ? 'Add note text here...' : ELEMENT_TYPES[type].label,
      x: snap(c.x, GRID), y: snap(c.y, GRID),
      w: isG ? 300 : isN ? 180 : 160,
      h: isG ? 180 : isN ? 80 : 72,
      documentation: '',
    };
    setElements(prev => [...prev, el]);
    appendCurrentDiagramNode({
      id: `${currentViewId}::${el.id}`,
      viewId: currentViewId,
      elementId: el.id,
      x: el.x,
      y: el.y,
      w: el.w,
      h: el.h,
      linkedViewId: el.linkedViewId,
      zIndex: el.zIndex,
      nestingDepth: el.zIndex ?? 0,
      style: el.style,
    });
    setViews(prev => prev.map(view =>
      view.id === currentViewId
        ? { ...view, elementIds: [...new Set([...(view.elementIds || []), el.id])] }
        : view,
    ));
    setSelectedNodeId(`${currentViewId}::${el.id}`); setSelectedConnectionId(null); setSelectedId(el.id); setSelType('element');
  }, [s2w, cSize, currentViewId, pushHistory, appendCurrentDiagramNode, activeViewpoint, showTransientDiagnostic]);

  const createEmptyView = useCallback((name?: string, parentViewId?: string, viewpoint?: string) => {
    const nextViewpoint = viewpoint || activeView?.viewpoint || 'landscape';
    const newView: ModelView = {
      id: uid(),
      name: name?.trim() || 'New View',
      elementIds: [],
      childViewIds: [],
      viewpoint: nextViewpoint,
      purpose: getSuggestedPurposeForViewpoint(nextViewpoint),
    };

    pushHistory();
    setViews(prev => {
      const updated = [...prev, newView];
      if (parentViewId) {
        return updated.map(view => (
          view.id === parentViewId
            ? { ...view, childViewIds: [...(view.childViewIds || []), newView.id] }
            : view
        ));
      }
      return updated;
    });
    diagramNodesByViewRef.current = {
      ...diagramNodesByViewRef.current,
      [newView.id]: [],
    };
    diagramConnectionsByViewRef.current = {
      ...diagramConnectionsByViewRef.current,
      [newView.id]: [],
    };
    elementLayoutsByViewRef.current = {
      ...elementLayoutsByViewRef.current,
      [newView.id]: {},
    };
    relationshipLayoutsByViewRef.current = {
      ...relationshipLayoutsByViewRef.current,
      [newView.id]: {},
    };
    setDiagramStateVersion(version => version + 1);
    saveViewLayoutSnapshot(currentViewId);
    setCurrentViewId(newView.id);
    setOpenTabIds(prev => [...prev, newView.id]);
    setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);
  }, [activeView, currentViewId, pushHistory, saveViewLayoutSnapshot]);

  const createViewFromTemplate = useCallback((templateId: string, name?: string, parentViewId?: string) => {
    const template = viewTemplates.find(candidate => candidate.id === templateId) || viewTemplates[0] || VIEW_TEMPLATES[0];
    pushHistory();
    const instance = instantiateViewTemplate(template, {
      viewId: uid(),
      name,
      makeId: uid,
    });
    const newView = instance.view;
    const starterElements = instance.elements;
    const starterRelationships = instance.relationships;
    const starterNodes = instance.diagramNodes;
    const starterConnections = instance.diagramConnections;

    setElements(prev => [...prev, ...starterElements]);
    setRelationships(prev => [...prev, ...starterRelationships]);
    setViews(prev => {
      const updated = [...prev, newView];
      if (parentViewId) {
        return updated.map(v =>
          v.id === parentViewId
            ? { ...v, childViewIds: [...(v.childViewIds || []), newView.id] }
            : v,
        );
      }
      return updated;
    });
    diagramNodesByViewRef.current = {
      ...diagramNodesByViewRef.current,
      [newView.id]: starterNodes,
    };
    diagramConnectionsByViewRef.current = {
      ...diagramConnectionsByViewRef.current,
      [newView.id]: starterConnections,
    };
    elementLayoutsByViewRef.current = {
      ...elementLayoutsByViewRef.current,
      [newView.id]: Object.fromEntries(starterNodes.map(node => [node.elementId, {
        x: node.x,
        y: node.y,
        w: node.w,
        h: node.h,
        linkedViewId: node.linkedViewId,
        zIndex: node.zIndex,
        style: node.style,
      }])),
    };
    relationshipLayoutsByViewRef.current = {
      ...relationshipLayoutsByViewRef.current,
      [newView.id]: Object.fromEntries(starterConnections.map(connection => [connection.relationshipId, {
        waypoints: connection.waypoints || [],
        labelPos: connection.labelPos ?? 0.5,
        relativeBendpoints: connection.relativeBendpoints,
      }])),
    };
    setDiagramStateVersion(version => version + 1);
    // Navigate to the new view
    saveViewLayoutSnapshot(currentViewId);
    setCurrentViewId(newView.id);
    setOpenTabIds(prev => [...prev, newView.id]);
    setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);
    fitToContent(starterElements);
  }, [pushHistory, currentViewId, saveViewLayoutSnapshot, fitToContent, viewTemplates]);

  const saveViewAsTemplate = useCallback((viewId: string) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;
    const label = window.prompt('Template name', `${view.name} Template`)?.trim();
    if (!label) return;
    const template = createCustomViewTemplate(
      `custom-${uid()}`,
      label,
      view,
      elements,
      relationships,
      diagramNodesByViewRef.current[viewId] || [],
      diagramConnectionsByViewRef.current[viewId] || [],
    );
    setCustomViewTemplates(prev => [template, ...prev]);
    showTransientDiagnostic(`Saved "${label}" as a reusable view template.`);
  }, [elements, relationships, showTransientDiagnostic, views]);

  const openCreateViewDialog = useCallback((parentViewId?: string) => {
    const inheritedViewpoint = views.find(view => view.id === (parentViewId || currentViewId))?.viewpoint || activeView?.viewpoint || 'landscape';
    const defaultTemplate = viewTemplates.find(template => template.viewpoint === inheritedViewpoint) || VIEW_TEMPLATES[0];
    setCreateViewDraft({
      parentViewId,
      mode: 'choice',
      viewpoint: inheritedViewpoint,
      templateId: defaultTemplate.id,
      name: 'New View',
    });
  }, [activeView, currentViewId, viewTemplates, views]);

  const submitCreateViewDraft = useCallback(() => {
    if (!createViewDraft) return;
    if (createViewDraft.mode === 'empty') {
      createEmptyView(createViewDraft.name, createViewDraft.parentViewId, createViewDraft.viewpoint);
    } else if (createViewDraft.mode === 'template') {
      createViewFromTemplate(createViewDraft.templateId, createViewDraft.name, createViewDraft.parentViewId);
    } else {
      return;
    }
    setCreateViewDraft(null);
  }, [createEmptyView, createViewDraft, createViewFromTemplate]);

  const renameView = useCallback((viewId: string, newName: string) => {
    if (!newName.trim()) return;
    pushHistory();
    setViews(prev => prev.map(v => v.id === viewId ? { ...v, name: newName.trim() } : v));
  }, [pushHistory]);

  const openViewContextMenu = useCallback((viewId: string, x: number, y: number) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;
    setCtxMenu({
      x,
      y,
      items: [
        { label: 'Open View', action: () => navigateToView(viewId) },
        {
          label: 'Rename View',
          action: () => {
            setEditingTabId(viewId);
            setEditingTabName(view.name);
            if (viewId !== currentViewId) navigateToView(viewId);
          },
        },
        { label: 'Set as Template', action: () => saveViewAsTemplate(viewId) },
        { label: '', separator: true },
        { label: 'Delete View', color: '#e07070', action: () => deleteViewById(viewId) },
      ],
    });
  }, [currentViewId, deleteViewById, navigateToView, saveViewAsTemplate, views]);

  const selectViewFromTree = useCallback((viewId: string) => {
    navigateToView(viewId);
    setSelectedNodeId(null);
    setSelectedConnectionId(null);
    setSelectedId(null);
    setSelType(null);
  }, [navigateToView]);

  const selectElementFromTree = useCallback((elementId: string) => {
    const targetViewId = views.find(view => (view.elementIds || []).includes(elementId))?.id;
    if (targetViewId && targetViewId !== currentViewId) navigateToView(targetViewId);

    const nodes = diagramNodesByViewRef.current[targetViewId || currentViewId] || [];
    const nodeId = nodes.find(node => node.elementId === elementId)?.id || null;

    setSelectedId(elementId);
    setSelectedNodeId(nodeId);
    setSelectedConnectionId(null);
    setSelType('element');
  }, [currentViewId, navigateToView, views]);

  const selectRelationshipFromTree = useCallback((relationshipId: string) => {
    const relationship = relationships.find(candidate => candidate.id === relationshipId);
    if (!relationship) return;

    const targetViewId = views.find(view => {
      const memberIds = new Set(view.elementIds || []);
      return memberIds.has(relationship.sourceId) && memberIds.has(relationship.targetId);
    })?.id;

    if (targetViewId && targetViewId !== currentViewId) navigateToView(targetViewId);

    const connections = diagramConnectionsByViewRef.current[targetViewId || currentViewId] || [];
    const connectionId = connections.find(connection => connection.relationshipId === relationshipId)?.id || null;

    setSelectedId(relationshipId);
    setSelectedNodeId(null);
    setSelectedConnectionId(connectionId);
    setSelType('relationship');
  }, [currentViewId, navigateToView, relationships, views]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    if (selType === 'element') {
      setElements(prev => prev.filter(e => e.id !== selectedId));
      setRelationships(prev => prev.filter(r => r.sourceId !== selectedId && r.targetId !== selectedId));
      removeDiagramNodesForElement(selectedId);
      removeDiagramConnectionsForElement(selectedId);
      setViews(prev => prev.map(view => ({
        ...view,
        elementIds: (view.elementIds || []).filter(elementId => elementId !== selectedId),
      })));
    } else {
      setRelationships(prev => prev.filter(r => r.id !== selectedId));
      removeDiagramConnectionsForRelationship(selectedId);
    }
    setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);
  }, [selectedId, selType, pushHistory, removeDiagramNodesForElement, removeDiagramConnectionsForElement, removeDiagramConnectionsForRelationship]);

  const exportModel = useCallback(() => {
    const result = exportEditorModelToText(buildEditorModelForExport(), selectedFormatId);
    const hasError = result.diagnostics.some(diagnostic => diagnostic.severity === 'error');
    if (hasError) {
      const firstError = result.diagnostics.find(diagnostic => diagnostic.severity === 'error');
      alert(firstError?.message || 'Export failed');
      return;
    }
    summarizeDiagnostics('Export', result.diagnostics);

    const blob = new Blob([result.content], { type: result.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = result.suggestedFileName; a.click();
    URL.revokeObjectURL(url);
  }, [buildEditorModelForExport, selectedFormatId, summarizeDiagnostics]);

  const importModel = useCallback(() => {
    const acceptedExtensions = Array.from(new Set(modelFormats.flatMap(format => format.extensions.map(extension => `.${extension}`))));
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = acceptedExtensions.join(',');
    inp.onchange = async (e: Event) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const f = target.files?.[0];
      if (!f) return;

      const detectedFormat = detectModelFormatByFileName(f.name);
      const formatId = ioFormatId === 'auto' ? detectedFormat?.id : ioFormatId;
      if (!formatId) {
        alert('Unsupported file format');
        return;
      }

      try {
        const content = await f.text();
        const result = importEditorModelFromText(content, formatId);
        if (!result.model) {
          const firstError = result.diagnostics.find(diagnostic => diagnostic.severity === 'error');
          alert(firstError?.message || 'Invalid file');
          return;
        }
        summarizeDiagnostics('Import', result.diagnostics);

        const importedLayouts = result.document
          ? buildLayoutsFromCanonicalDocument(result.document)
          : buildLayoutsFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
        const importedDiagramState = result.document
          ? buildDiagramStateFromCanonicalDocument(result.document)
          : buildDiagramStateFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
        elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
        relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;
        diagramNodesByViewRef.current = importedDiagramState.diagramNodesByView;
        diagramConnectionsByViewRef.current = importedDiagramState.diagramConnectionsByView;
        fragmentedSourceDocumentRef.current = null;
        setOrganizationBaseDocument(result.document ?? null);

        setElements(result.model.elements);
        setRelationships(result.model.relationships);
        setViews(result.model.views);
        if (result.model.views.length > 0) {
          setCurrentViewId(result.model.views[0].id);
          setOpenTabIds([result.model.views[0].id]);
          applyViewLayout(result.model.views[0].id);
        }
        setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);
        // Fit camera to imported content using layout-resolved positions
        const firstViewId = result.model.views[0]?.id;
        const layoutEls = firstViewId ? importedLayouts.elementLayouts[firstViewId] : null;
        if (layoutEls) {
          const laidOut = result.model.elements
            .filter(element => layoutEls[element.id])
            .map(element => ({ ...element, ...layoutEls[element.id], w: layoutEls[element.id].w, h: layoutEls[element.id].h }));
          fitToContent(laidOut);
        } else {
          fitToContent(result.model.elements);
        }
      } catch {
        alert('Invalid file');
      }
    };
    inp.click();
  }, [ioFormatId, modelFormats, applyViewLayout, fitToContent, summarizeDiagnostics]);

  // ---------------------------------------------------------------------------
  // Filesystem: Open Directory, Open File, Save
  // ---------------------------------------------------------------------------

  const loadFileEntry = useCallback(async (entry: OpenFileEntry) => {
    try {
      const content = await entry.readText();
      const detectedFormat = detectModelFormatByFileName(entry.name);
      const formatId = detectedFormat?.id;
      if (!formatId) { alert(`Unsupported format: ${entry.name}`); return; }

      const result = importEditorModelFromText(content, formatId);
      if (!result.model) {
        const firstError = result.diagnostics.find(d => d.severity === 'error');
        alert(firstError?.message || 'Invalid file');
        return;
      }
      summarizeDiagnostics('Import', result.diagnostics);

      const importedLayouts = result.document
        ? buildLayoutsFromCanonicalDocument(result.document)
        : buildLayoutsFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
      const importedDiagramState = result.document
        ? buildDiagramStateFromCanonicalDocument(result.document)
        : buildDiagramStateFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
      elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
      relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;
      diagramNodesByViewRef.current = importedDiagramState.diagramNodesByView;
      diagramConnectionsByViewRef.current = importedDiagramState.diagramConnectionsByView;
      fragmentedSourceDocumentRef.current = null;
      setOrganizationBaseDocument(result.document ?? null);

      setElements(result.model.elements);
      setRelationships(result.model.relationships);
      setViews(result.model.views);
      if (result.model.views.length > 0) {
        setCurrentViewId(result.model.views[0].id);
        setOpenTabIds([result.model.views[0].id]);
        applyViewLayout(result.model.views[0].id);
      }
      setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);

      // Fit camera to imported content
      const firstViewId = result.model.views[0]?.id;
      const layoutEls = firstViewId ? importedLayouts.elementLayouts[firstViewId] : null;
      if (layoutEls) {
        const laidOut = result.model.elements
          .filter(e => layoutEls[e.id])
          .map(e => ({ ...e, ...layoutEls[e.id], w: layoutEls[e.id].w, h: layoutEls[e.id].h }));
        fitToContent(laidOut);
      } else {
        fitToContent(result.model.elements);
      }

      wsSetActiveFile(entry.relativePath, formatId);
    } catch (err) {
      alert(`Failed to open file: ${err}`);
    }
  }, [applyViewLayout, fitToContent, summarizeDiagnostics, wsSetActiveFile]);

  const loadFragmentedModel = useCallback(async (files: OpenFileEntry[]) => {
    try {
      setImportDiag(null);
      setLoadProgress({ phase: 'Starting', pct: 0 });
      const result = await importFragmentedModel(files, (phase, current, total) => {
        setLoadProgress({ phase, pct: total > 0 ? Math.round((current / total) * 100) : 0 });
      });
      setLoadProgress(null);
      if (!result.model) {
        const firstError = result.diagnostics.find(d => d.severity === 'error');
        alert(firstError?.message || 'Failed to import fragmented model');
        return;
      }
      summarizeDiagnostics('Import', result.diagnostics);

      // Use pre-computed layouts from the combined mapper when available (avoids redundant pass)
      const importedLayouts = result.elementLayouts && result.relationshipLayouts
        ? { elementLayouts: result.elementLayouts, relationshipLayouts: result.relationshipLayouts }
        : result.document
          ? buildLayoutsFromCanonicalDocument(result.document)
          : buildLayoutsFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
      const importedDiagramState = result.document
        ? buildDiagramStateFromCanonicalDocument(result.document)
        : buildDiagramStateFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
      elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
      relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;
      diagramNodesByViewRef.current = importedDiagramState.diagramNodesByView;
      diagramConnectionsByViewRef.current = importedDiagramState.diagramConnectionsByView;
      fragmentedSourceDocumentRef.current = result.document ?? null;
      setOrganizationBaseDocument(result.document ?? null);

      // Seed content hashes from a trial serialization so the first
      // incremental save only writes files that actually changed.
      if (result.document) {
        const baseline = serializeCoArchiFragmented(result.document);
        wsSeedContentHashes(baseline.files);
      }

      setElements(result.model.elements);
      setRelationships(result.model.relationships);
      setViews(result.model.views);
      if (result.model.views.length > 0) {
        setCurrentViewId(result.model.views[0].id);
        setOpenTabIds([result.model.views[0].id]);
        applyViewLayout(result.model.views[0].id);
      }
      setSelectedNodeId(null); setSelectedConnectionId(null); setSelectedId(null); setSelType(null);

      // Show import summary as a temporary visible diagnostic
      const m = result.model;
      const fv = m.views[0];
      const fvEls = fv ? new Set(fv.elementIds) : new Set<string>();
      const relsMatch = m.relationships.filter(r => fvEls.has(r.sourceId) && fvEls.has(r.targetId)).length;
      const summary = `Imported: ${m.elements.length} elements, ${m.relationships.length} relationships, ${m.views.length} views. `
        + `First view "${fv?.name || '?'}": ${fv?.elementIds.length ?? 0} els, ${relsMatch} rels match.`;
      showTransientDiagnostic(summary);

      // Fit camera to imported content
      const firstViewId = result.model.views[0]?.id;
      const layoutEls = firstViewId ? importedLayouts.elementLayouts[firstViewId] : null;
      if (layoutEls) {
        const laidOut = result.model.elements
          .filter(e => layoutEls[e.id])
          .map(e => ({ ...e, ...layoutEls[e.id], w: layoutEls[e.id].w, h: layoutEls[e.id].h }));
        fitToContent(laidOut);
      } else {
        fitToContent(result.model.elements);
      }
    } catch (err) {
      setLoadProgress(null);
      alert(`Failed to import fragmented model: ${err}`);
    }
  }, [applyViewLayout, fitToContent, showTransientDiagnostic, summarizeDiagnostics]);

  const handleOpenDirectory = useCallback(async () => {
    try {
      const state = await wsOpenDirectory();
      const workspaceLoadKey = `${state.backend}:${state.directoryPath || state.directoryName}:${state.files.length}:${state.canWrite}`;

      // Detect fragmented coArchi directory (individual XML files per element)
      if (state.files.length > 0 && isFragmentedModelDirectory(state.files)) {
        autoLoadedWorkspaceRef.current = workspaceLoadKey;
        await loadFragmentedModel(state.files);
        return;
      }

      // Auto-open the first archimate/xml/json file
      if (state.files.length > 0) {
        autoLoadedWorkspaceRef.current = workspaceLoadKey;
        await loadFileEntry(state.files[0]);
      } else {
        showTransientDiagnostic(`No supported model files found in '${state.directoryName}'.`);
      }
    } catch (err) {
      // User cancelled the picker
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Failed to open directory: ${err}`);
    }
  }, [wsOpenDirectory, loadFileEntry, loadFragmentedModel, showTransientDiagnostic]);

  useEffect(() => {
    if (restorePending) return;
    if (wsFiles.length === 0) return;

    const workspaceLoadKey = `${workspace.backend || 'unknown'}:${workspace.directoryPath || wsDirName || 'workspace'}:${wsFiles.length}:${wsActiveFilePath || wsKind || 'none'}`;
    if (autoLoadedWorkspaceRef.current === workspaceLoadKey) return;

    const run = async () => {
      if (wsKind === 'coarchi-directory') {
        autoLoadedWorkspaceRef.current = workspaceLoadKey;
        await loadFragmentedModel(wsFiles);
        return;
      }

      if (wsActiveFilePath) {
        const entry = wsGetFile(wsActiveFilePath);
        if (!entry) return;
        autoLoadedWorkspaceRef.current = workspaceLoadKey;
        await loadFileEntry(entry);
      }
    };

    void run();
  }, [
    restorePending,
    workspace.backend,
    workspace.directoryPath,
    wsDirName,
    wsFiles,
    wsActiveFilePath,
    wsKind,
    wsGetFile,
    loadFileEntry,
    loadFragmentedModel,
  ]);

  const handleSave = useCallback(async () => {
    // Fragmented save (coArchi directory)
    if (wsKind === 'coarchi-directory') {
      if (!workspace.canWrite) {
        showSaveNotice('error', 'Saving a coArchi directory requires direct write access to the opened workspace.');
        return;
      }
      try {
        showSaveNotice('saving', 'Saving fragmented workspace...', 0);
        saveViewLayoutSnapshot(currentViewId);
        const saveDocument = buildFragmentedSaveDocument();
        const exportModel = buildEditorModelForExport();
        const result = exportFragmentedEditorModel(
          exportModel,
          saveDocument ?? fragmentedSourceDocumentRef.current ?? undefined,
          saveDocument ? undefined : elementLayoutsByViewRef.current,
          saveDocument ? undefined : relationshipLayoutsByViewRef.current,
        );
        // Log validation issues but never block save — Archi saves regardless of validation state
        const validationErrors = result.diagnostics.filter(d => d.severity === 'error');
        if (validationErrors.length > 0) {
          const duplicateTrace = collectDuplicateTrace(result.document);
          if (duplicateTrace.length > 0) {
            const traceText = formatDuplicateTrace(duplicateTrace);
            console.warn('[OpenArchi] Duplicate element trace during fragmented save\n' + traceText);
          }
          console.warn('[OpenArchi] Saving with validation issues:', validationErrors.map(d => d.message));
        }
        const preview = result.changeSet ? buildFragmentedSavePreview(result.changeSet) : null;
        if (preview) {
          if (isTauriRuntime()) {
            console.info('[OpenArchi] Fragmented save preview\n' + preview);
            showTransientDiagnostic('Saving fragmented workspace. Preview written to the dev console.', 5000);
          } else if (!window.confirm(preview)) {
            setSaveNotice(null);
            return;
          }
        }
        console.info('[OpenArchi] Saving fragmented workspace', {
          workspace: wsDirName || 'workspace',
          fileCount: result.files.length,
          deletedPaths: result.deletedPaths || [],
          rootFilePath: result.document?.metadata?.coArchi?.rootFilePath,
        });
        const saveResult = await wsSaveFragmented(result.files, result.deletedPaths || []);
        console.info('[OpenArchi] Fragmented save result', saveResult);
        fragmentedSourceDocumentRef.current = result.document ?? fragmentedSourceDocumentRef.current;
        setOrganizationBaseDocument(result.document ?? fragmentedSourceDocumentRef.current);
        const summary = `Wrote ${saveResult.writtenCount} of ${result.files.length} files to ${wsDirName || 'workspace'}/`
          + (saveResult.skippedCount > 0 ? ` (${saveResult.skippedCount} unchanged)` : '')
          + (saveResult.deletedCount > 0 ? ` | -${saveResult.deletedCount} deleted` : '');
        showTransientDiagnostic(summary);
        showSaveNotice('success', summary, 6000);
      } catch (err) {
        console.error('[OpenArchi] Fragmented save failed', err);
        showSaveNotice('error', `Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Single-file save
    const activeFileEntry = getActiveFile();
    if (!activeFileEntry || !wsFormat) {
      // Fallback to download export
      exportModel();
      showSaveNotice('success', 'Exported model as a download.', 5000);
      return;
    }
    showSaveNotice('saving', `Saving ${activeFileEntry.name}...`, 0);
    const result = exportEditorModelToText(buildEditorModelForExport(), wsFormat);
    const hasError = result.diagnostics.some(d => d.severity === 'error');
    if (hasError) {
      const duplicateDiagnostics = result.diagnostics
        .filter(diagnostic => diagnostic.code.startsWith('VALIDATION_DUPLICATE_'))
        .map(diagnostic => diagnostic.message)
        .join('\n');
      if (duplicateDiagnostics) {
        console.error('[OpenArchi] Duplicate ID diagnostics before single-file save\n' + duplicateDiagnostics);
        showTransientDiagnostic(duplicateDiagnostics, 15000);
      }
      const firstError = result.diagnostics.find(d => d.severity === 'error');
      showSaveNotice('error', firstError?.message || 'Save failed');
      return;
    }
    if (activeFileEntry.writeText) {
      try {
        await wsSaveFile(activeFileEntry, result.content);
        showSaveNotice('success', `Saved ${activeFileEntry.name}`, 5000);
      } catch (err) {
        console.error('[OpenArchi] Single-file save failed', err);
        showSaveNotice('error', `Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // No write access (fallback browser) – download instead
      const blob = new Blob([result.content], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = activeFileEntry.name;
      a.click();
      URL.revokeObjectURL(url);
      markClean();
      showSaveNotice('success', `Downloaded ${activeFileEntry.name}`, 5000);
    }
  }, [wsKind, workspace.canWrite, getActiveFile, wsFormat, wsDirName, exportModel, wsSaveFile, wsSaveFragmented, wsSaveSingleFragment, markClean, showTransientDiagnostic, showSaveNotice, saveViewLayoutSnapshot, currentViewId, buildFragmentedSaveDocument, buildEditorModelForExport]);

  const handleSaveAsJson = useCallback(async () => {
    if (!workspace.canWrite) {
      showSaveNotice('error', 'No writable workspace is open — cannot save JSON file.');
      return;
    }
    try {
      showSaveNotice('saving', 'Saving model.openarchi.json...', 0);
      const result = exportEditorModelToText(buildEditorModelForExport(), 'openarchi-json');
      if (result.diagnostics.some(d => d.severity === 'error')) {
        showSaveNotice('error', result.diagnostics.find(d => d.severity === 'error')?.message || 'Export failed');
        return;
      }
      await wsSaveSingleFragment('model.openarchi.json', result.content);
      showTransientDiagnostic(`Saved model.openarchi.json to ${wsDirName || 'workspace'}/`);
      showSaveNotice('success', `Saved model.openarchi.json to ${wsDirName || 'workspace'}/`, 6000);
    } catch (err) {
      console.error('[OpenArchi] JSON save failed', err);
      showSaveNotice('error', `Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [workspace.canWrite, buildEditorModelForExport, wsSaveSingleFragment, wsDirName, showTransientDiagnostic, showSaveNotice]);

  const handleExportSvg = useCallback(() => {
    const viewName = views.find(v => v.id === currentViewId)?.name || 'view';
    const svg = exportViewToSvg(
      visibleDiagramElements as ModelElement[],
      visibleRelationships as ModelRelationship[],
    );
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${viewName.replace(/[^a-zA-Z0-9_-]/g, '_')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    showTransientDiagnostic(`Exported ${viewName}.svg`);
  }, [views, currentViewId, visibleDiagramElements, visibleRelationships, showTransientDiagnostic]);

  // Mark dirty on model changes (skip initial render)
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) { isInitialRender.current = false; return; }
    if (wsActiveFilePath || wsKind === 'coarchi-directory') markDirty();
  }, [elements, relationships, views, diagramStateVersion, wsActiveFilePath, wsKind, markDirty]);

  // Keyboard
  const isTextInputActive = useCallback((): boolean => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isTextInputActive()) return;
        if (interactionMode !== 'view') deleteSelected();
      }
      if (e.key === 'Escape') { setRelPicker(null); setCtxMenu(null); setShowChangelog(false); setShowSearch(false); setDrawingRel(null); cancelEditing(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(s => !s); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (isTextInputActive()) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        if (isTextInputActive()) return;
        e.preventDefault();
        redo();
      }
      // Back/forward: Alt+Left / Alt+Right
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
      // Fit to content: Ctrl+Shift+1
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === '1') { e.preventDefault(); fitToContent(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [deleteSelected, cancelEditing, goBack, goForward, handleSave, undo, redo, fitToContent, interactionMode, isTextInputActive]);

  useEffect(() => {
    if (!selectedId) return;
    if (selType === 'element') {
      const elementStillExists = elements.some(element => element.id === selectedId);
      if (!elementStillExists) {
        setSelectedNodeId(null);
        setSelectedConnectionId(null);
        setSelectedId(null);
        setSelType(null);
        return;
      }
    }
    if (selType === 'element' && selectedNodeId) {
      const nodeStillVisible = visibleDiagramElements.some(element => element.id === selectedNodeId);
      if (!nodeStillVisible) setSelectedNodeId(null);
    }
    if (selType === 'relationship') {
      const relationshipStillExists = relationships.some(relationship => relationship.id === selectedId);
      if (!relationshipStillExists) {
        setSelectedNodeId(null);
        setSelectedConnectionId(null);
        setSelectedId(null);
        setSelType(null);
        return;
      }
      if (selectedConnectionId) {
        const connectionStillVisible = visibleRelationships.some(relationship => relationship.id === selectedConnectionId);
        if (!connectionStillVisible) setSelectedConnectionId(null);
      }
    }
  }, [selectedId, selectedNodeId, selectedConnectionId, selType, elements, relationships, visibleDiagramElements, visibleRelationships]);

  // ==================== DERIVED STATE ====================
  const selEl = selType === 'element' ? elements.find(e => e.id === selectedId) || null : null;
  const semanticSelectedRelationship = selType === 'relationship' ? relationships.find(r => r.id === selectedId) || null : null;
  const selectedDiagramRelationship = useMemo(
    () => (selectedConnectionId ? visibleRelationships.find(relationship => relationship.id === selectedConnectionId) || null : null),
    [selectedConnectionId, visibleRelationships],
  );
  const selRel = useMemo(() => {
    if (!semanticSelectedRelationship) return null;
    if (!selectedDiagramRelationship) return semanticSelectedRelationship;
    return {
      ...semanticSelectedRelationship,
      waypoints: selectedDiagramRelationship.waypoints,
      labelPos: selectedDiagramRelationship.labelPos,
      relativeBendpoints: selectedDiagramRelationship.relativeBendpoints,
    };
  }, [semanticSelectedRelationship, selectedDiagramRelationship]);
  const folderDocument = organizationBaseDocument ?? fragmentedSourceDocumentRef.current;
  const elementFolderPath = selEl
    ? getRelativeFolderPathFromSourcePath(selEl.sourcePath, folderDocument) || getDefaultElementFolder(selEl.type)
    : undefined;
  const relationshipFolderPath = selRel
    ? getRelativeFolderPathFromSourcePath(selRel.sourcePath, folderDocument) || getDefaultRelationshipFolder()
    : undefined;
  const viewFolderPath = activeView
    ? getRelativeFolderPathFromSourcePath(activeView.sourcePath, folderDocument) || getDefaultViewFolder()
    : undefined;

  const propEditPushedRef = useRef(false);
  useEffect(() => { propEditPushedRef.current = false; }, [selectedId, selectedConnectionId, currentViewId]);

  const updEl = useCallback((k: string, v: unknown) => {
    if (!propEditPushedRef.current) { pushHistory(); propEditPushedRef.current = true; }
    setElements(p => p.map(e => e.id === selectedId ? { ...e, [k]: v } : e));
  }, [selectedId, pushHistory]);

  const updRel = useCallback((k: string, v: unknown) => {
    if (!propEditPushedRef.current) { pushHistory(); propEditPushedRef.current = true; }
    if ((k === 'labelPos' || k === 'waypoints' || k === 'relativeBendpoints') && selectedConnectionId) {
      updateCurrentDiagramConnection(selectedConnectionId, connection => ({
        ...connection,
        [k]: v,
      }));
      return;
    }
    setRelationships(p => p.map(r => r.id === selectedId ? { ...r, [k]: v } : r));
  }, [selectedId, selectedConnectionId, pushHistory, updateCurrentDiagramConnection]);

  const selectRelationshipFromPanel = useCallback((relationshipId: string) => {
    const visibleConnection = visibleRelationships.find(relationship => relationship.relationshipId === relationshipId) || null;
    setSelectedNodeId(null);
    setSelectedId(relationshipId);
    setSelType('relationship');
    setSelectedConnectionId(visibleConnection?.id || null);
  }, [visibleRelationships]);

  const updView = useCallback((viewId: string, k: string, v: unknown) => {
    if (!propEditPushedRef.current) { pushHistory(); propEditPushedRef.current = true; }
    setViews(prev => prev.map(view => {
      if (view.id !== viewId) return view;
      if (k === 'viewpoint') {
        const nextViewpoint = typeof v === 'string' && v ? v : undefined;
        return {
          ...view,
          viewpoint: nextViewpoint,
          purpose: view.purpose || getSuggestedPurposeForViewpoint(nextViewpoint),
        };
      }
      return { ...view, [k]: v };
    }));
  }, [pushHistory]);
  const moveElementToFolderById = useCallback((elementId: string, folderPath: string) => {
    const element = elements.find(candidate => candidate.id === elementId);
    if (!element) return;
    const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultElementFolder(element.type);
    const currentFolder = getRelativeFolderPathFromSourcePath(element.sourcePath, folderDocument) || getDefaultElementFolder(element.type);
    if (normalizedFolder === currentFolder) return;
    pushHistory();
    setElements(prev => prev.map(candidate => (
      candidate.id === elementId
        ? { ...candidate, sourcePath: moveElementSourcePath(candidate, normalizedFolder, folderDocument) }
        : candidate
    )));
  }, [elements, folderDocument, pushHistory]);
  const moveRelationshipToFolderById = useCallback((relationshipId: string, folderPath: string) => {
    const relationship = relationships.find(candidate => candidate.id === relationshipId);
    if (!relationship) return;
    const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultRelationshipFolder();
    const currentFolder = getRelativeFolderPathFromSourcePath(relationship.sourcePath, folderDocument) || getDefaultRelationshipFolder();
    if (normalizedFolder === currentFolder) return;
    pushHistory();
    setRelationships(prev => prev.map(candidate => (
      candidate.id === relationshipId
        ? { ...candidate, sourcePath: moveRelationshipSourcePath(candidate, normalizedFolder, folderDocument) }
        : candidate
    )));
  }, [folderDocument, pushHistory, relationships]);
  const moveViewToFolderById = useCallback((viewId: string, folderPath: string) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;
    const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultViewFolder();
    const currentFolder = getRelativeFolderPathFromSourcePath(view.sourcePath, folderDocument) || getDefaultViewFolder();
    if (normalizedFolder === currentFolder) return;
    pushHistory();
    setViews(prev => prev.map(candidate => (
      candidate.id === viewId
        ? { ...candidate, sourcePath: moveViewSourcePath(candidate, normalizedFolder, folderDocument) }
        : candidate
    )));
  }, [folderDocument, pushHistory, views]);
  const moveSelectedElementToFolder = useCallback((folderPath: string) => {
    if (!selEl) return;
    moveElementToFolderById(selEl.id, folderPath);
  }, [moveElementToFolderById, selEl]);
  const moveSelectedRelationshipToFolder = useCallback((folderPath: string) => {
    if (!selRel) return;
    moveRelationshipToFolderById(selRel.id, folderPath);
  }, [moveRelationshipToFolderById, selRel]);
  const moveCurrentViewToFolder = useCallback((folderPath: string) => {
    if (!activeView) return;
    moveViewToFolderById(activeView.id, folderPath);
  }, [activeView, moveViewToFolderById]);
  const moveTreeItemToFolder = useCallback((item: { kind: 'view' | 'element' | 'relationship'; id: string }, folderPath: string) => {
    if (item.kind === 'element') {
      moveElementToFolderById(item.id, folderPath);
      return;
    }
    if (item.kind === 'relationship') {
      moveRelationshipToFolderById(item.id, folderPath);
      return;
    }
    moveViewToFolderById(item.id, folderPath);
  }, [moveElementToFolderById, moveRelationshipToFolderById, moveViewToFolderById]);
  const createFolder = useCallback((parentFolderPath: string) => {
    if (!folderDocument) return;
    const defaultName = 'new-folder';
    const name = window.prompt('New folder name', defaultName);
    if (!name) return;
    const segment = normalizeRelativeFolderPath(name);
    if (!segment) return;
    const nextFolderPath = normalizeRelativeFolderPath(parentFolderPath)
      ? `${normalizeRelativeFolderPath(parentFolderPath)}/${segment}`
      : segment;
    pushHistory();
    setOrganizationBaseDocument(current => upsertCoArchiFolderEntry(current ?? folderDocument, nextFolderPath));
  }, [folderDocument, pushHistory]);
  const renameFolder = useCallback((folderPath: string) => {
    if (!folderDocument) return;
    const currentFolder = normalizeRelativeFolderPath(folderPath);
    const nextFolderInput = window.prompt('Rename folder path', currentFolder);
    if (!nextFolderInput) return;
    const nextFolderPath = normalizeRelativeFolderPath(nextFolderInput);
    if (!nextFolderPath || nextFolderPath === currentFolder) return;
    if (isSameOrDescendantFolder(nextFolderPath, currentFolder)) {
      alert('A folder cannot be renamed into itself or one of its descendants.');
      return;
    }

    pushHistory();

    setElements(prev => prev.map(element => {
      const currentRelativeFolder = getRelativeFolderPathFromSourcePath(element.sourcePath, folderDocument) || getDefaultElementFolder(element.type);
      if (!isSameOrDescendantFolder(currentRelativeFolder, currentFolder)) return element;
      return {
        ...element,
        sourcePath: moveElementSourcePath(
          element,
          rebaseRelativeFolderPath(currentRelativeFolder, currentFolder, nextFolderPath),
          folderDocument,
        ),
      };
    }));

    setRelationships(prev => prev.map(relationship => {
      const currentRelativeFolder = getRelativeFolderPathFromSourcePath(relationship.sourcePath, folderDocument) || getDefaultRelationshipFolder();
      if (!isSameOrDescendantFolder(currentRelativeFolder, currentFolder)) return relationship;
      return {
        ...relationship,
        sourcePath: moveRelationshipSourcePath(
          relationship,
          rebaseRelativeFolderPath(currentRelativeFolder, currentFolder, nextFolderPath),
          folderDocument,
        ),
      };
    }));

    setViews(prev => prev.map(view => {
      const currentRelativeFolder = getRelativeFolderPathFromSourcePath(view.sourcePath, folderDocument) || getDefaultViewFolder();
      if (!isSameOrDescendantFolder(currentRelativeFolder, currentFolder)) return view;
      return {
        ...view,
        sourcePath: moveViewSourcePath(
          view,
          rebaseRelativeFolderPath(currentRelativeFolder, currentFolder, nextFolderPath),
          folderDocument,
        ),
      };
    }));

    setOrganizationBaseDocument(current => renameCoArchiFolderEntries(current ?? folderDocument, currentFolder, nextFolderPath));
  }, [folderDocument, pushHistory]);
  const deleteFolder = useCallback((folderPath: string) => {
    if (!folderDocument) return;
    const normalizedFolder = normalizeRelativeFolderPath(folderPath);
    if (!normalizedFolder) return;
    if (!window.confirm(`Delete folder "${normalizedFolder}"?`)) return;
    pushHistory();
    setOrganizationBaseDocument(current => removeCoArchiFolderEntry(current ?? folderDocument, normalizedFolder));
  }, [folderDocument, pushHistory]);

  // Position for inline editing overlay
  const editingEl = editingElId ? elements.find(e => e.id === editingElId) : null;
  const editOverlay = editingEl ? {
    left: editingEl.x * cam.s + cam.x,
    top: editingEl.y * cam.s + cam.y,
    width: editingEl.w * cam.s,
    height: editingEl.h * cam.s,
  } : null;
  const editIsNote = editingEl ? isNote(editingEl.type) : false;

  const relPickerWaypoints = useRef<{ x: number; y: number }[]>([]);

  const deriveAffectedViewsForPaths = useCallback((changedFiles: string[]): AffectedViewInfo[] => {
    const changedPathSet = new Set(changedFiles);
    if (changedPathSet.size === 0) return [];

    const changedElementIds = new Set(
      elements
        .filter(element => element.sourcePath && changedPathSet.has(element.sourcePath))
        .map(element => element.id),
    );
    const changedRelationshipIds = new Set(
      relationships
        .filter(relationship => relationship.sourcePath && changedPathSet.has(relationship.sourcePath))
        .map(relationship => relationship.id),
    );

    return views
      .map(view => {
        const reasons: string[] = [];
        if (view.sourcePath && changedPathSet.has(view.sourcePath)) {
          reasons.push('view fragment changed');
        }
        if ((view.elementIds || []).some(elementId => changedElementIds.has(elementId))) {
          reasons.push('contains changed elements');
        }

        const memberIds = new Set(view.elementIds || []);
        const semanticRelationshipIds = new Set(
          relationships
            .filter(relationship => memberIds.has(relationship.sourceId) && memberIds.has(relationship.targetId))
            .map(relationship => relationship.id),
        );
        const diagramRelationshipIds = new Set(
          (diagramConnectionsByViewRef.current[view.id] || []).map(connection => connection.relationshipId),
        );
        if ([...changedRelationshipIds].some(relationshipId =>
          semanticRelationshipIds.has(relationshipId) || diagramRelationshipIds.has(relationshipId))) {
          reasons.push('contains changed relationships');
        }

        if (reasons.length === 0) return null;
        return {
          viewId: view.id,
          viewName: view.name,
          reasons,
        } satisfies AffectedViewInfo;
      })
      .filter((view): view is AffectedViewInfo => view !== null)
      .sort((left, right) => {
        if (left.reasons.length !== right.reasons.length) {
          return right.reasons.length - left.reasons.length;
        }
        return left.viewName.localeCompare(right.viewName);
      });
  }, [elements, relationships, views]);

  const handleSelectHistoryCommit = useCallback(async (commit: GitHistoryEntry) => {
    setSelectedHistoryCommit(commit);
    setCommitChangedFiles([]);
    setCommitAffectedViews([]);
    setCommitDetailsError(null);
    setCommitCompareState(null);
    setCommitCompareError(null);
    setCommitDetailsLoading(true);

    try {
      const changedFiles = await wsGetGitChangedFiles(commit.hash);
      setCommitChangedFiles(changedFiles);
      setCommitAffectedViews(deriveAffectedViewsForPaths(changedFiles));
      if (changedFiles.length === 0) {
        setCommitDetailsError('No changed model files were detected for this commit.');
      }
    } catch (error) {
      setCommitDetailsError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitDetailsLoading(false);
    }
  }, [deriveAffectedViewsForPaths, wsGetGitChangedFiles]);

  const handleCompareHistoryView = useCallback(async (commit: GitHistoryEntry, viewId: string) => {
    const currentView = views.find(view => view.id === viewId) || null;
    if (!currentView) {
      setCommitCompareError('The selected view is no longer present in the current workspace.');
      return;
    }

    setCommitCompareLoading(true);
    setCommitCompareError(null);
    setCommitCompareState(null);

    try {
      const snapshotFiles = await wsGetGitModelSnapshot(commit.hash);
      if (snapshotFiles.length === 0) {
        throw new Error('No model snapshot could be loaded for this commit.');
      }

      const snapshotEntries: OpenFileEntry[] = snapshotFiles.map(file => ({
        name: file.relativePath.split('/').pop() || file.relativePath,
        relativePath: file.relativePath,
        readText: async () => file.content,
      }));

      const result = await importFragmentedModel(snapshotEntries);
      if (!result.model) {
        const firstError = result.diagnostics.find(diagnostic => diagnostic.severity === 'error');
        throw new Error(firstError?.message || 'Failed to import the selected git snapshot.');
      }

      const snapshotDiagramState = result.document
        ? buildDiagramStateFromCanonicalDocument(result.document)
        : buildDiagramStateFromEditorModel(result.model.elements, result.model.relationships, result.model.views);

      const currentSnapshot = buildViewSvgSnapshot(
        currentView.id,
        views,
        elements,
        relationships,
        diagramNodesByViewRef.current,
        diagramConnectionsByViewRef.current,
      );

      const snapshotView = result.model.views.find(view => view.id === currentView.id)
        || result.model.views.find(view => view.sourcePath && currentView.sourcePath && view.sourcePath === currentView.sourcePath)
        || result.model.views.find(view => view.name === currentView.name);

      const previousSnapshot = snapshotView
        ? buildViewSvgSnapshot(
          snapshotView.id,
          result.model.views,
          result.model.elements,
          result.model.relationships,
          snapshotDiagramState.diagramNodesByView,
          snapshotDiagramState.diagramConnectionsByView,
        )
        : {
          svg: exportViewToSvg([], []),
          elementCount: 0,
          relationshipCount: 0,
        };

      setCommitCompareState({
        commit,
        viewId: currentView.id,
        viewName: currentView.name,
        currentSvg: currentSnapshot.svg,
        previousSvg: previousSnapshot.svg,
        currentElementCount: currentSnapshot.elementCount,
        currentRelationshipCount: currentSnapshot.relationshipCount,
        previousElementCount: previousSnapshot.elementCount,
        previousRelationshipCount: previousSnapshot.relationshipCount,
        snapshotMissing: !snapshotView,
      });
    } catch (error) {
      setCommitCompareError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommitCompareLoading(false);
    }
  }, [elements, relationships, views, wsGetGitModelSnapshot]);

  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    if (!showChangelog) return;
    if (!gitBranch) {
      setGitHistory([]);
      setGitHistoryError('No git repository detected for the current workspace.');
      return;
    }

    let cancelled = false;
    setGitHistoryLoading(true);
    setGitHistoryError(null);

    (async () => {
      try {
        const history = await wsGetGitHistory(30);
        if (cancelled) return;
        setGitHistory(history);
        if (history.length === 0) {
          setGitHistoryError(isTauriRuntime()
            ? 'No commits found or git history is unavailable for this workspace.'
            : 'Git history is only available in the Tauri desktop app right now.');
        }
      } catch (error) {
        if (cancelled) return;
        setGitHistory([]);
        setGitHistoryError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) {
          setGitHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showChangelog, gitBranch, wsGetGitHistory]);

  useEffect(() => {
    if (showChangelog) return;
    setSelectedHistoryCommit(null);
    setCommitChangedFiles([]);
    setCommitAffectedViews([]);
    setCommitDetailsError(null);
    setCommitDetailsLoading(false);
    setCommitCompareState(null);
    setCommitCompareError(null);
    setCommitCompareLoading(false);
  }, [showChangelog]);

  // ==================== RENDER ====================
  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, background: 'var(--bg, #f3f4f6)', color: 'var(--text-primary, #1a1a1a)' }}>
      {/* Full-screen canvas area with floating UI */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* ====== Top-left: Logo + file info ====== */}
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 280,
          background: 'var(--glass, rgba(255,255,255,0.82))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          borderRadius: 'var(--radius-md, 10px)',
          boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
          padding: '5px 10px',
        }}>
          <div style={{ width: 20, height: 20, flexShrink: 0, background: 'var(--text-primary, #1a1a1a)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, color: '#fff', letterSpacing: '-0.3px' }}>OA</div>
          <span style={{ fontWeight: 600, fontSize: 13, flexShrink: 0, color: 'var(--text-primary, #1a1a1a)', letterSpacing: '-0.01em' }}>OpenArchi</span>
          {(wsActiveFilePath || wsDirName) && (
            <span style={{ fontSize: 11, color: 'var(--text-muted, #8a8a90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
              {wsDirName ? `${wsDirName}/` : ''}{wsActiveFilePath || ''}
              {isDirty && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent, #2563eb)', flexShrink: 0 }} title="Unsaved changes" />}
            </span>
          )}
          {gitBranch && (
            <span style={{
              fontSize: 10, color: 'var(--text-muted, #8a8a90)',
              background: 'var(--surface-hover, rgba(0,0,0,0.035))',
              padding: '1px 6px', borderRadius: 8, flexShrink: 0, whiteSpace: 'nowrap',
            }}>
              {'\u2387'} {gitBranch}
            </span>
          )}
        </div>

        {/* ====== Reconnect banner (shows after page refresh when permission needed) ====== */}
        {restorePending && restoreDirectoryName && (
          <div style={{
            position: 'absolute', top: 50, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--glass-strong, rgba(255,255,255,0.95))',
            backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
            borderRadius: 'var(--radius-md, 10px)',
            boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
            padding: '8px 14px', fontSize: 13, fontFamily: FONT,
          }}>
            <span style={{ color: 'var(--text-secondary, #555)' }}>
              Reconnect to <strong>{restoreDirectoryName}</strong>?
            </span>
            <button
              onClick={async () => {
                const state = await requestPermissionAndRestore();
                if (state && state.activeFilePath) {
                  const entry = wsGetFile(state.activeFilePath);
                  if (entry) await loadFileEntry(entry);
                } else if (state && state.kind === 'coarchi-directory' && state.files.length > 0) {
                  await loadFragmentedModel(state.files);
                }
              }}
              style={{
                padding: '4px 12px', border: 'none', borderRadius: 6,
                background: 'var(--accent, #2563eb)', color: '#fff',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}
            >Reconnect</button>
            <button
              onClick={closeWorkspace}
              style={{
                padding: '4px 8px', border: 'none', borderRadius: 6,
                background: 'transparent', color: 'var(--text-muted, #8a8a90)',
                fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
              }}
            >Dismiss</button>
          </div>
        )}

        {createViewDraft && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(243,244,246,0.72)',
            backdropFilter: 'blur(10px)',
          }}>
            <div style={{
              width: 640,
              maxWidth: 'calc(100vw - 40px)',
              maxHeight: 'calc(100vh - 80px)',
              overflow: 'auto',
              background: 'var(--glass-strong, rgba(255,255,255,0.95))',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
              borderRadius: 'var(--radius-lg, 14px)',
              boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.12))',
              padding: '18px 18px 16px',
              fontFamily: FONT,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    New View
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)', marginTop: 2 }}>
                    Choose a template
                  </div>
                </div>
                <button
                  onClick={() => setCreateViewDraft(null)}
                  style={{
                    width: 28, height: 28, borderRadius: 8, border: 'none',
                    background: 'transparent', color: 'var(--text-faint, #b0b0b8)',
                    cursor: 'pointer', fontSize: 16, lineHeight: 1,
                  }}
                >
                  {'\u00D7'}
                </button>
              </div>

              {createViewDraft.mode === 'choice' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 14 }}>
                  <button
                    onClick={() => setCreateViewDraft(prev => prev ? {
                      ...prev,
                      mode: 'empty',
                      name: 'New View',
                    } : prev)}
                    style={{
                      textAlign: 'left',
                      borderRadius: 10,
                      border: '1px solid var(--border, rgba(0,0,0,0.06))',
                      background: 'var(--surface-solid, #fff)',
                      padding: '14px 14px 12px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>Empty View</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #555)', lineHeight: 1.5, marginTop: 8 }}>
                      Start with a blank canvas and the inherited viewpoint.
                    </div>
                  </button>
                  <button
                    onClick={() => setCreateViewDraft(prev => {
                      if (!prev) return prev;
                      const selectedTemplate = viewTemplates.find(template => template.id === prev.templateId) || viewTemplates[0] || VIEW_TEMPLATES[0];
                      return {
                        ...prev,
                        mode: 'template',
                        templateId: selectedTemplate.id,
                        name: selectedTemplate.defaultName,
                      };
                    })}
                    style={{
                      textAlign: 'left',
                      borderRadius: 10,
                      border: '1px solid var(--border, rgba(0,0,0,0.06))',
                      background: 'var(--surface-solid, #fff)',
                      padding: '14px 14px 12px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>View From Template</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #555)', lineHeight: 1.5, marginTop: 8 }}>
                      Start from a built-in or saved custom scaffold.
                    </div>
                  </button>
                </div>
              )}

              {createViewDraft.mode === 'template' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
                  {viewTemplates.map(template => {
                    const selected = template.id === createViewDraft.templateId;
                    return (
                      <button
                        key={template.id}
                        onClick={() => setCreateViewDraft(prev => prev ? {
                          ...prev,
                          templateId: template.id,
                          name: template.defaultName,
                        } : prev)}
                        style={{
                          textAlign: 'left',
                          borderRadius: 10,
                          border: selected ? '1px solid rgba(37,99,235,0.35)' : '1px solid var(--border, rgba(0,0,0,0.06))',
                          background: selected ? 'var(--surface-selected, rgba(37,99,235,0.07))' : 'var(--surface-solid, #fff)',
                          padding: '12px 12px 10px',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: selected ? 'var(--accent-text, #1d4ed8)' : 'var(--text-primary, #1a1a1a)' }}>
                          {template.label}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.4px', marginTop: 4 }}>
                          {template.kind === 'custom'
                            ? `Custom • ${getViewpointDefinition(template.viewpoint)?.label || template.viewpoint}`
                            : (getViewpointDefinition(template.viewpoint)?.label || template.viewpoint)}
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #555)', lineHeight: 1.5, marginTop: 8 }}>
                          {template.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    View Name
                  </div>
                  <input
                    autoFocus
                    value={createViewDraft.name}
                    onChange={event => setCreateViewDraft(prev => prev ? { ...prev, name: event.target.value } : prev)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border, rgba(0,0,0,0.06))',
                      background: 'var(--surface-solid, #fff)',
                      fontSize: 13,
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    Viewpoint
                  </div>
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border, rgba(0,0,0,0.06))',
                    background: 'var(--surface-hover, rgba(0,0,0,0.02))',
                    fontSize: 13,
                    color: 'var(--text-secondary, #555)',
                  }}>
                    {getViewpointDefinition(
                      createViewDraft.mode === 'template'
                        ? (viewTemplates.find(template => template.id === createViewDraft.templateId)?.viewpoint)
                        : createViewDraft.viewpoint,
                    )?.label || 'Landscape'}
                  </div>
                </div>
              </div>

              <div style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--surface-hover, rgba(0,0,0,0.03))',
                color: 'var(--text-secondary, #555)',
                fontSize: 12,
                lineHeight: 1.6,
                marginBottom: 16,
              }}>
                {createViewDraft.mode === 'empty'
                  ? 'Empty views start with a blank canvas and inherit the active viewpoint so you can model from scratch.'
                  : createViewDraft.mode === 'template'
                    ? ((viewTemplates.find(template => template.id === createViewDraft.templateId)?.starterSummary)
                      || 'New views start with a focused starter scaffold so the template opens with visible structure and initial semantics.')
                    : 'Choose whether the new view should start blank or from a reusable template.'}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                {createViewDraft.mode !== 'choice' && (
                  <button
                    onClick={() => setCreateViewDraft(prev => prev ? { ...prev, mode: 'choice' } : prev)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid var(--border, rgba(0,0,0,0.06))',
                      background: 'transparent',
                      color: 'var(--text-muted, #8a8a90)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => setCreateViewDraft(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--border, rgba(0,0,0,0.06))',
                    background: 'transparent',
                    color: 'var(--text-muted, #8a8a90)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={submitCreateViewDraft}
                  disabled={createViewDraft.mode === 'choice'}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: createViewDraft.mode === 'choice' ? 'var(--surface-active, rgba(0,0,0,0.08))' : 'var(--accent, #2563eb)',
                    color: '#fff',
                    cursor: createViewDraft.mode === 'choice' ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    opacity: createViewDraft.mode === 'choice' ? 0.7 : 1,
                  }}
                >
                  Create View
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====== Loading progress overlay ====== */}
        {loadProgress && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(243,244,246,0.85)',
            backdropFilter: 'blur(8px)',
            fontFamily: FONT,
          }}>
            <div style={{
              background: 'var(--glass-strong, rgba(255,255,255,0.95))',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
              borderRadius: 'var(--radius-md, 10px)',
              boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
              padding: '24px 32px', textAlign: 'center', minWidth: 280,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)', marginBottom: 8 }}>
                Loading model...
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8a90)', marginBottom: 12 }}>
                {loadProgress.phase} ({loadProgress.pct}%)
              </div>
              <div style={{
                height: 4, borderRadius: 2, background: 'var(--border, rgba(0,0,0,0.06))', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  background: 'var(--accent, #2563eb)',
                  width: `${loadProgress.pct}%`,
                  transition: 'width 0.2s ease',
                }} />
              </div>
            </div>
          </div>
        )}

        {/* ====== Top-right: Actions cluster ====== */}
        <div style={{
          position: 'absolute', top: 10, right: propSide === 'right' ? 270 : 10, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 2,
          background: 'var(--glass, rgba(255,255,255,0.82))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          borderRadius: 'var(--radius-md, 10px)',
          boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
          padding: '3px 5px',
        }}>
          <Btn onClick={goBack} disabled={!canGoBack}>{'\u25C0'}</Btn>
          <Btn onClick={goForward} disabled={!canGoForward}>{'\u25B6'}</Btn>
          <div style={{ width: 1, height: 16, background: 'var(--border, rgba(0,0,0,0.06))', margin: '0 2px' }} />
          <Btn onClick={undo} disabled={historyIndexRef.current <= 0}>Undo</Btn>
          <Btn onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1}>Redo</Btn>
          <div style={{ width: 1, height: 16, background: 'var(--border, rgba(0,0,0,0.06))', margin: '0 2px' }} />
          <div style={{ position: 'relative' }}>
            <Btn onClick={() => setShowChangelog(v => !v)}>History</Btn>
            {showChangelog && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 6,
                  width: 340, maxHeight: 400,
                  background: 'var(--glass-strong, rgba(255,255,255,0.95))',
                  backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
                  WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))' as string,
                  border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
                  borderRadius: 'var(--radius-md, 10px)',
                  boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.12))',
                  fontFamily: FONT, overflow: 'hidden',
                  display: 'flex', flexDirection: 'column',
                  zIndex: 200,
                }}>
                <div style={{ padding: '10px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>View History</span>
                  <button onClick={() => setShowChangelog(false)} style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
                    color: 'var(--text-faint, #b0b0b8)', padding: '0 2px', lineHeight: 1,
                  }}>{'\u00D7'}</button>
                </div>
                <div style={{ padding: '4px 14px 6px', fontSize: 10, color: 'var(--text-muted, #8a8a90)' }}>
                  {gitBranch ? `${gitBranch} • ${activeView?.name || 'Unknown view'}` : (activeView?.name || 'Unknown view')}
                </div>
                <div style={{ flex: 1, overflow: 'auto', padding: '6px 14px 14px' }}>
                  {gitHistoryLoading ? (
                    <div style={{ color: 'var(--text-faint, #b0b0b8)', fontSize: 12, lineHeight: 1.7 }}>
                      Loading git history...
                    </div>
                  ) : gitHistoryError ? (
                    <div style={{ color: 'var(--text-faint, #b0b0b8)', fontSize: 12, lineHeight: 1.7 }}>
                      {gitHistoryError}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {gitHistory.map(commit => {
                        const selected = selectedHistoryCommit?.hash === commit.hash;
                        return (
                        <button
                          key={commit.hash}
                          onClick={() => void handleSelectHistoryCommit(commit)}
                          style={{
                            textAlign: 'left',
                            width: '100%',
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: selected
                              ? 'var(--surface-selected, rgba(37,99,235,0.09))'
                              : 'var(--surface-hover, rgba(0,0,0,0.02))',
                            border: selected
                              ? '1px solid rgba(37,99,235,0.24)'
                              : '1px solid var(--border, rgba(0,0,0,0.06))',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--accent-text, #1d4ed8)',
                              fontFamily: 'monospace',
                            }}>
                              {commit.shortHash}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)' }}>
                              {commit.date}
                            </span>
                          </div>
                          <div style={{ marginTop: 5, fontSize: 12, color: 'var(--text-primary, #1a1a1a)', lineHeight: 1.45 }}>
                            {commit.subject}
                          </div>
                          <div style={{ marginTop: 5, fontSize: 10.5, color: 'var(--text-muted, #8a8a90)' }}>
                            {commit.author}
                          </div>
                        </button>
                      )})}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ====== Tab bar island ====== */}
        <div style={{
          position: 'absolute', top: 10,
          left: 300,
          right: propSide === 'right' ? 520 : 260,
          zIndex: 10,
          height: 32,
          background: 'var(--glass, rgba(255,255,255,0.82))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          borderRadius: 'var(--radius-md, 10px)',
          boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
          display: 'flex', alignItems: 'stretch', padding: '3px 4px', gap: 1, overflow: 'auto',
        }}>
          {openTabIds.map(tid => {
            const v = views.find(vv => vv.id === tid);
            const isActive = tid === currentViewId;
            return (
              <div
                key={tid}
                onClick={() => { if (editingTabId !== tid) navigateToView(tid); }}
                onDoubleClick={() => { setEditingTabId(tid); setEditingTabName(v?.name || ''); }}
                onContextMenu={event => {
                  event.preventDefault();
                  openViewContextMenu(tid, event.clientX, event.clientY);
                }}
                onMouseDown={event => {
                  if (event.button !== 1) return;
                  event.preventDefault();
                  closeTab(tid);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', fontSize: 12, fontFamily: 'inherit',
                  cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                  background: isActive ? 'var(--surface-selected, rgba(74,85,104,0.07))' : 'transparent',
                  color: isActive ? 'var(--accent-text, #374151)' : 'var(--text-muted, #8a8a90)',
                  fontWeight: isActive ? 500 : 400,
                  borderRadius: 6,
                  border: 'none',
                  position: 'relative',
                  transition: 'background var(--transition-fast, 0.12s ease), color var(--transition-fast, 0.12s ease)',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                {editingTabId === tid ? (
                  <input
                    autoFocus
                    value={editingTabName}
                    onChange={e => setEditingTabName(e.target.value)}
                    onBlur={() => { renameView(tid, editingTabName); setEditingTabId(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { renameView(tid, editingTabName); setEditingTabId(null); }
                      if (e.key === 'Escape') setEditingTabId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
                      border: 'none', outline: 'none', background: 'transparent',
                      color: 'var(--accent-text, #374151)',
                      width: Math.max(40, editingTabName.length * 7 + 10),
                      padding: 0,
                    }}
                  />
                ) : (
                  <span>{v?.name || tid}</span>
                )}
                {openTabIds.length > 1 && (
                  <span
                    onClick={e => { e.stopPropagation(); closeTab(tid); }}
                    style={{
                      fontSize: 12, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1,
                      padding: '1px 2px', borderRadius: 3, cursor: 'pointer',
                      transition: 'color var(--transition-fast, 0.12s ease), background var(--transition-fast, 0.12s ease)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary, #555)'; e.currentTarget.style.background = 'var(--surface-active, rgba(0,0,0,0.06))'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-faint, #b0b0b8)'; e.currentTarget.style.background = 'transparent'; }}
                  >
                    {'\u00D7'}
                  </span>
                )}
              </div>
            );
          })}
          {/* New view tab button */}
          <div
            onClick={() => openCreateViewDialog()}
            title="New View"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 8px', cursor: 'pointer', userSelect: 'none',
              color: 'var(--text-faint, #b0b0b8)', borderRadius: 6, flexShrink: 0,
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; e.currentTarget.style.color = 'var(--text-secondary, #555)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint, #b0b0b8)'; }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* ====== Left panel island (views + properties) ====== */}
        <div style={{
          position: 'absolute', left: 10, top: 52, bottom: 10, width: leftPanelWidth, zIndex: 10,
          background: 'var(--glass-strong, rgba(255,255,255,0.92))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          borderRadius: 'var(--radius-lg, 14px)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Resize handle */}
          <div
            style={{
              position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', zIndex: 20,
            }}
            onMouseDown={e => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = leftPanelWidth;
              const onMove = (ev: MouseEvent) => {
                const newWidth = Math.min(600, Math.max(180, startWidth + ev.clientX - startX));
                setLeftPanelWidth(newWidth);
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          />
          {(() => {
            const hasOrg = !!organizationTree;
            return (
            <div style={{ padding: '8px 10px 0' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: hasOrg ? '1fr 1fr' : '1fr',
                gap: 4,
                padding: 3,
                borderRadius: 8,
                background: 'var(--surface-hover, rgba(0,0,0,0.035))',
              }}>
                <button
                  onClick={() => setLeftNavMode('views')}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    background: leftNavMode === 'views' ? 'var(--glass, rgba(255,255,255,0.82))' : 'transparent',
                    color: leftNavMode === 'views' ? 'var(--text-primary, #1a1a1a)' : 'var(--text-muted, #8a8a90)',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    fontWeight: leftNavMode === 'views' ? 500 : 400,
                  }}
                >
                  Views
                </button>
                {hasOrg && (
                <button
                  onClick={() => setLeftNavMode('model')}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 8px',
                    cursor: 'pointer',
                    background: leftNavMode === 'model' ? 'var(--glass, rgba(255,255,255,0.82))' : 'transparent',
                    color: leftNavMode === 'model' ? 'var(--text-primary, #1a1a1a)' : 'var(--text-muted, #8a8a90)',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    fontWeight: leftNavMode === 'model' ? 500 : 400,
                  }}
                >
                  Model
                </button>
                )}
              </div>
            </div>
            );
          })()}
          {organizationTree && leftNavMode === 'model' ? (
            <ModelTree
              tree={organizationTree}
              currentViewId={currentViewId}
              selectedId={selectedId}
              selectedType={selType}
              onSelectView={selectViewFromTree}
              onSelectElement={selectElementFromTree}
              onSelectRelationship={selectRelationshipFromTree}
              onMoveItemToFolder={moveTreeItemToFolder}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
            />
          ) : (
            <ViewNav
              views={views}
              currentViewId={currentViewId}
              onNavigate={navigateToView}
              onAddView={(parentId) => openCreateViewDialog(parentId)}
              onViewContextMenu={openViewContextMenu}
            />
          )}
          {/* Property panel on left side */}
          {propSide === 'left' && (
            <PropertyPanel
              selEl={selEl}
              selRel={selRel}
              elements={elements}
              relationships={relationships}
              onUpdateElement={updEl}
              onUpdateRelationship={updRel}
              onSelectRelationship={selectRelationshipFromPanel}
              onUpdateView={updView}
              side="left"
              onToggleSide={() => setPropSide('right')}
              currentView={views.find(v => v.id === currentViewId) ?? null}
              onRenameView={renameView}
              elementFolderPath={folderDocument ? elementFolderPath : undefined}
              relationshipFolderPath={folderDocument ? relationshipFolderPath : undefined}
              viewFolderPath={folderDocument ? viewFolderPath : undefined}
              onMoveElementToFolder={folderDocument ? moveSelectedElementToFolder : undefined}
              onMoveRelationshipToFolder={folderDocument ? moveSelectedRelationshipToFolder : undefined}
              onMoveViewToFolder={folderDocument ? moveCurrentViewToFolder : undefined}
            />
          )}
        </div>

        {/* ====== Canvas ====== */}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
          <canvas
            ref={canvasRef}
            style={{ cursor: resizing ? HANDLE_CURSORS[resizing.handle] : drawingRel ? 'crosshair' : dragging ? 'grabbing' : panning ? 'grabbing' : dragLabel ? 'ew-resize' : undefined }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDblClick}
            onContextMenu={handleContextMenu}
            onMouseLeave={() => { setDragging(null); setPanning(null); setDragWP(null); setDragEndpoint(null); setDragLabel(null); setDragSegment(null); setResizing(null); setHovElId(null); setHovRelId(null); setSnapGuides([]); }}
            onWheel={handleWheel}
            onDragOver={e => { if (e.dataTransfer.types.includes('application/openarchi-view')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
            onDrop={e => {
              const data = e.dataTransfer.getData('application/openarchi-view');
              if (!data) return;
              e.preventDefault();
              try {
                const { viewId, viewName } = JSON.parse(data);
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);
                pushHistory();
                const el: ModelElement = {
                  id: uid(), type: 'viewReference',
                  name: viewName || 'View',
                  x: snap(wx - 80, GRID), y: snap(wy - 36, GRID),
                  w: 160, h: 72,
                  documentation: '',
                  linkedViewId: viewId,
                };
                setElements(prev => [...prev, el]);
                appendCurrentDiagramNode({
                  id: `${currentViewId}::${el.id}`,
                  viewId: currentViewId,
                  elementId: el.id,
                  x: el.x,
                  y: el.y,
                  w: el.w,
                  h: el.h,
                  linkedViewId: el.linkedViewId,
                  zIndex: el.zIndex,
                  nestingDepth: el.zIndex ?? 0,
                  style: el.style,
                });
                setViews(prev => prev.map(v =>
                  v.id === currentViewId
                    ? { ...v, elementIds: [...new Set([...(v.elementIds || []), el.id])] }
                    : v,
                ));
                setSelectedNodeId(`${currentViewId}::${el.id}`); setSelectedConnectionId(null); setSelectedId(el.id); setSelType('element');
              } catch { /* invalid drag data */ }
            }}
          />

          {/* Inline element name editor */}
          {editingEl && editOverlay && (
            <div
              style={{
                position: 'absolute',
                left: editOverlay.left,
                top: editOverlay.top,
                width: editOverlay.width,
                height: editOverlay.height,
                display: 'flex', alignItems: editIsNote ? 'stretch' : 'center', justifyContent: 'center',
                pointerEvents: 'none',
                padding: editIsNote ? 6 : 0,
                boxSizing: 'border-box',
              }}
            >
              {editIsNote ? (
                <textarea
                  autoFocus
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') cancelEditing(); }}
                  onBlur={commitEditing}
                  style={{
                    pointerEvents: 'auto',
                    width: '100%',
                    height: '100%',
                    padding: '8px 10px',
                    fontSize: Math.max(12, 14 * cam.s),
                    fontFamily: 'inherit',
                    fontWeight: 400,
                    textAlign: 'left',
                    border: '2px solid #4a5568',
                    borderRadius: 4,
                    outline: 'none',
                    background: '#fffffa',
                    color: '#333',
                    boxShadow: '0 2px 12px rgba(37,99,235,0.2)',
                    resize: 'none',
                    lineHeight: '1.4',
                  }}
                />
              ) : (
                <input
                  autoFocus
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEditing(); if (e.key === 'Escape') cancelEditing(); }}
                  onBlur={commitEditing}
                  style={{
                    pointerEvents: 'auto',
                    width: Math.max(80, editOverlay.width - 20),
                    padding: '4px 8px',
                    fontSize: Math.max(12, 14 * cam.s),
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    textAlign: 'center',
                    border: '2px solid #4a5568',
                    borderRadius: 6,
                    outline: 'none',
                    background: '#fff',
                    color: '#333',
                    boxShadow: '0 2px 12px rgba(37,99,235,0.2)',
                  }}
                />
              )}
            </div>
          )}

          {relPicker && (
            <RelPicker
              x={Math.min(relPicker.sx, cSize.w - 280)}
              y={Math.min(relPicker.sy, cSize.h - 420)}
              onSelect={t => {
                pushHistory();
                const relationshipId = uid();
                setRelationships(p => [...p, { id: relationshipId, type: t, sourceId: relPicker.srcId, targetId: relPicker.tgtId, name: '', waypoints: relPickerWaypoints.current, labelPos: 0.5 }]);
                appendCurrentDiagramConnection({
                  id: `${currentViewId}::${relationshipId}`,
                  viewId: currentViewId,
                  relationshipId,
                  sourceNodeId: relPicker.sourceNodeId,
                  targetNodeId: relPicker.targetNodeId,
                  waypoints: relPickerWaypoints.current,
                  labelPos: 0.5,
                });
                relPickerWaypoints.current = [];
                setRelPicker(null);
              }}
              onCancel={() => { relPickerWaypoints.current = []; setRelPicker(null); }}
            />
          )}

          {ctxMenu && <CtxMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

          {showSearch && (
            <SearchPanel
              elements={elements}
              relationships={relationships}
              views={views}
              onSelectElement={id => {
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                setSelectedId(id);
                setSelType('element');
                const inView = visibleDiagramElements.find(element => element.elementId === id);
                if (inView) setSelectedNodeId(inView.id);
                const semanticInView = visibleElements.find(element => element.id === id);
                const el = inView || semanticInView || elements.find(element => element.id === id);
                if (el) setCam(p => ({ ...p, x: cSize.w / 2 - el.x * p.s, y: cSize.h / 2 - el.y * p.s }));
              }}
              onSelectRelationship={id => {
                setSelectedNodeId(null);
                setSelectedConnectionId(null);
                setSelectedId(id);
                setSelType('relationship');
              }}
              onSelectView={id => navigateToView(id)}
              onClose={() => setShowSearch(false)}
            />
          )}

          {/* Shift hint when drawing */}
          {drawingRel && (
            <div style={{
              position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)',
              fontSize: 12, color: 'var(--text-secondary, #555)',
              background: 'var(--glass, rgba(255,255,255,0.82))',
              backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
              WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
              padding: '5px 12px', borderRadius: 'var(--radius-sm, 6px)',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
              boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
              whiteSpace: 'nowrap',
            }}>
              <strong>Click</strong> to add waypoint, click <strong>target element</strong> to complete
            </div>
          )}
        </div>

        {/* ====== Floating toolbar (bottom center) ====== */}
        <FloatingToolbar
          activeLayer={activeLayer}
          onLayerChange={setActiveLayer}
          onAddElement={addElement}
          onDeleteSelected={deleteSelected}
          hasSelection={!!selectedId}
          onOpenDir={handleOpenDirectory}
          onImport={importModel}
          onExport={exportModel}
          onExportSvg={handleExportSvg}
          onSave={handleSave}
          onSaveAsJson={workspace.canWrite ? handleSaveAsJson : undefined}
          canSave={!!wsActiveFilePath || wsKind === 'coarchi-directory'}
          isDirty={isDirty}
          dirState={!!wsDirName}
          dirFiles={wsFiles}
          activeFilePath={wsActiveFilePath || ''}
          onSelectFile={path => {
            const entry = wsGetFile(path);
            if (entry) loadFileEntry(entry);
          }}
          ioFormatId={ioFormatId}
          onFormatChange={setIoFormatId}
          modelFormats={modelFormats}
          gridType={gridType}
          onToggleGrid={() => setGridType(g => g === 'dot' ? 'line' : 'dot')}
          onSearch={() => setShowSearch(s => !s)}
          interactionMode={interactionMode}
          onToggleMode={() => setInteractionMode(m => m === 'view' ? 'edit' : 'view')}
          allowedLayers={allowedLayersForActiveView}
          allowedElementTypes={allowedElementTypesForActiveView}
          viewpointLabel={getViewpointDefinition(activeViewpoint)?.label}
        />

        {/* ====== Legend toggle + panel (bottom-right) ====== */}
        <button
          onClick={() => setShowLegend(l => !l)}
          style={{
            position: 'absolute', bottom: 14, right: propSide === 'right' ? 274 : 12, zIndex: 50,
            width: 30, height: 30, borderRadius: 'var(--radius-sm, 6px)',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
            background: showLegend ? 'var(--surface-selected, rgba(74,85,104,0.07))' : 'var(--glass, rgba(255,255,255,0.82))',
            backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: showLegend ? 'var(--accent-text, #374151)' : 'var(--text-muted, #8a8a90)',
            fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: 0,
            transition: 'background var(--transition-fast, 0.12s ease), color var(--transition-fast, 0.12s ease)',
          }}
          title={showLegend ? 'Hide Legend' : 'Show Legend'}
          onMouseEnter={e => { if (!showLegend) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
          onMouseLeave={e => { if (!showLegend) e.currentTarget.style.background = 'var(--glass, rgba(255,255,255,0.82))'; }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" /><line x1="5" y1="6" x2="7.5" y2="6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" /><line x1="5" y1="8.5" x2="7.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" /><line x1="5" y1="11" x2="7.5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><line x1="9" y1="11" x2="11" y2="11" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" /></svg>
        </button>
        {showLegend && (() => {
          const usedElTypes = new Set<string>();
          for (const el of visibleElements) {
            if (ELEMENT_TYPES[el.type] && !ELEMENT_TYPES[el.type].isNote) usedElTypes.add(el.type);
          }
          const usedRelTypes = new Set<string>();
          for (const r of visibleRelationships) {
            usedRelTypes.add(r.type);
          }
          const activeElTypes = Object.entries(ELEMENT_TYPES).filter(([k]) => usedElTypes.has(k));
          const activeRelTypes = Object.entries(RELATIONSHIP_TYPES).filter(([k]) => usedRelTypes.has(k));

          const relLineW = 44;
          const relLineH = 16;

          const renderRelSvg = (rd: { dash: boolean; head: string }) => {
            const y = relLineH / 2;
            const x1 = 2, x2 = relLineW - 2;
            const col = '#777';
            const aL = 7;
            const aS = 0.5;

            const linePath = `M${x1},${y} L${x2},${y}`;
            const dashArray = rd.dash ? '4,2.5' : undefined;

            let headMarkup = null;
            if (rd.head === 'filled_arrow') {
              const hw = aL * Math.sin(aS);
              headMarkup = <polygon points={`${x2},${y} ${x2 - aL},${y - hw} ${x2 - aL},${y + hw}`} fill={col} />;
            } else if (rd.head === 'open_arrow') {
              const hw = aL * Math.sin(aS);
              headMarkup = <polyline points={`${x2 - aL},${y - hw} ${x2},${y} ${x2 - aL},${y + hw}`} fill="none" stroke={col} strokeWidth="1.3" strokeLinejoin="round" />;
            } else if (rd.head === 'hollow_arrow') {
              const hw = aL * Math.sin(aS);
              headMarkup = <polygon points={`${x2},${y} ${x2 - aL},${y - hw} ${x2 - aL},${y + hw}`} fill="#fff" stroke={col} strokeWidth="1.1" />;
            } else if (rd.head === 'diamond_filled' || rd.head === 'diamond') {
              const dL = 8, dW = 3.5;
              headMarkup = <polygon points={`${x1},${y} ${x1 + dL / 2},${y - dW} ${x1 + dL},${y} ${x1 + dL / 2},${y + dW}`} fill={rd.head === 'diamond_filled' ? col : '#fff'} stroke={col} strokeWidth="0.9" />;
            } else if (rd.head === 'filled_dot') {
              headMarkup = <circle cx={x1 + 4} cy={y} r={3} fill={col} />;
            }

            return (
              <svg width={relLineW} height={relLineH} style={{ flexShrink: 0 }}>
                <path d={linePath} stroke={col} strokeWidth="1.1" fill="none" strokeDasharray={dashArray} />
                {headMarkup}
              </svg>
            );
          };

          return (
            <div style={{
              position: 'absolute', bottom: 54, right: propSide === 'right' ? 274 : 12, zIndex: 50,
              background: 'var(--glass-strong, rgba(255,255,255,0.92))',
              backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
              WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
              border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
              borderRadius: 'var(--radius-md, 10px)',
              boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
              padding: '10px 14px',
              width: 280, fontSize: 12, fontFamily: FONT, maxHeight: 400, overflow: 'auto',
            }}>
              {activeElTypes.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.5px' }}>Elements</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px' }}>
                    {activeElTypes.map(([k, def]) => {
                      const L = LAYERS[def.layer];
                      return (
                        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
                          <CanvasIcon type={k} size={16} color={L?.stroke || '#666'} />
                          <span style={{ color: 'var(--text-secondary, #555)', fontSize: 11.5 }}>{def.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {activeElTypes.length > 0 && activeRelTypes.length > 0 && (
                <div style={{ height: 1, background: 'var(--border, rgba(0,0,0,0.06))', margin: '8px 0' }} />
              )}
              {activeRelTypes.length > 0 && (
                <>
                  <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.5px' }}>Relationships</div>
                  {activeRelTypes.map(([, rd]) => (
                    <div key={rd.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      {renderRelSvg(rd)}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ color: 'var(--text-secondary, #555)', fontSize: 11.5, fontWeight: 500 }}>{rd.label}</span>
                        <span style={{ color: 'var(--text-faint, #b0b0b8)', fontSize: 10 }}>{rd.desc}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {activeElTypes.length === 0 && activeRelTypes.length === 0 && (
                <div style={{ color: 'var(--text-faint, #b0b0b8)', fontSize: 12, padding: '4px 0' }}>No elements or relationships yet.</div>
              )}
            </div>
          );
        })()}

        {/* ====== Zoom + stats (bottom-left) ====== */}
        <div style={{
          position: 'absolute', bottom: 12, left: leftPanelWidth + 24, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 400,
          background: 'var(--glass, rgba(255,255,255,0.82))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          padding: '3px 10px', borderRadius: 'var(--radius-sm, 6px)',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.03))',
        }}>
          <span style={{ color: 'var(--text-muted, #8a8a90)', fontWeight: 500 }}>{Math.round(cam.s * 100)}%</span>
          <span style={{ width: 1, height: 12, background: 'var(--border, rgba(0,0,0,0.06))' }} />
          <span style={{ color: 'var(--text-faint, #b0b0b8)' }}>{visibleElements.length} el {'\u00B7'} {visibleRelationships.length} rel</span>
        </div>

        {importDiag && (
          <div
            onClick={() => setImportDiag(null)}
            style={{
              position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
              maxWidth: '80vw', padding: '8px 14px', zIndex: 100,
              background: 'rgba(220,160,0,0.95)', color: '#000', borderRadius: 8,
              fontSize: 11, fontFamily: 'monospace', cursor: 'pointer', whiteSpace: 'pre-wrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            {importDiag} <span style={{ opacity: 0.5 }}>(click to dismiss)</span>
          </div>
        )}

        {saveNotice && (
          <div
            onClick={() => setSaveNotice(null)}
            style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              minWidth: 240,
              maxWidth: '70vw',
              padding: '10px 14px',
              zIndex: 110,
              background: saveNotice.kind === 'error'
                ? 'rgba(190, 24, 93, 0.96)'
                : saveNotice.kind === 'success'
                  ? 'rgba(5, 150, 105, 0.96)'
                  : 'rgba(37, 99, 235, 0.96)',
              color: '#fff',
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              cursor: 'pointer',
              boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              whiteSpace: 'pre-wrap',
            }}
          >
            <span style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.9)',
              boxShadow: saveNotice.kind === 'saving' ? '0 0 0 6px rgba(255,255,255,0.16)' : 'none',
            }} />
            {saveNotice.message}
          </div>
        )}

        {selectedHistoryCommit && (
          <div
            onMouseDown={() => {
              setSelectedHistoryCommit(null);
              setCommitCompareState(null);
              setCommitCompareError(null);
            }}
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 130,
              background: 'rgba(15, 23, 42, 0.28)',
              backdropFilter: 'blur(10px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div
              onMouseDown={event => event.stopPropagation()}
              style={{
                width: 'min(1100px, calc(100vw - 40px))',
                maxHeight: 'calc(100vh - 64px)',
                overflow: 'hidden',
                background: 'var(--glass-strong, rgba(255,255,255,0.96))',
                border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
                borderRadius: 'var(--radius-lg, 14px)',
                boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.16))',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{
                padding: '16px 18px 14px',
                borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'var(--accent-text, #1d4ed8)',
                      fontFamily: 'monospace',
                    }}>
                      {selectedHistoryCommit.shortHash}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted, #8a8a90)' }}>
                      {selectedHistoryCommit.author} • {selectedHistoryCommit.date}
                    </span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 17, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>
                    {selectedHistoryCommit.subject}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-secondary, #555)' }}>
                    Changed model fragments and affected views in the current workspace. Compare opens the selected historical view against what is on disk now.
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedHistoryCommit(null);
                    setCommitCompareState(null);
                    setCommitCompareError(null);
                  }}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-faint, #b0b0b8)',
                    cursor: 'pointer',
                    fontSize: 18,
                    lineHeight: 1,
                  }}
                >
                  {'\u00D7'}
                </button>
              </div>

              <div style={{
                padding: 18,
                overflow: 'auto',
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)',
                gap: 16,
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{
                    borderRadius: 12,
                    border: '1px solid var(--border, rgba(0,0,0,0.06))',
                    background: 'var(--surface-solid, #fff)',
                    padding: '12px 12px 10px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-faint, #b0b0b8)' }}>
                      Changed Files
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflow: 'auto' }}>
                      {commitDetailsLoading ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8a90)' }}>Loading changed files...</div>
                      ) : commitChangedFiles.length > 0 ? (
                        commitChangedFiles.map(path => (
                          <div
                            key={path}
                            style={{
                              fontSize: 11,
                              lineHeight: 1.45,
                              color: 'var(--text-secondary, #555)',
                              fontFamily: 'monospace',
                              padding: '6px 8px',
                              borderRadius: 8,
                              background: 'var(--surface-hover, rgba(0,0,0,0.02))',
                            }}
                          >
                            {path}
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8a90)' }}>
                          No changed model files were detected for this commit.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    borderRadius: 12,
                    border: '1px solid var(--border, rgba(0,0,0,0.06))',
                    background: 'var(--surface-solid, #fff)',
                    padding: '12px 12px 10px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-faint, #b0b0b8)' }}>
                      Affected Views
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflow: 'auto' }}>
                      {commitDetailsLoading ? (
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8a90)' }}>Deriving affected views...</div>
                      ) : commitAffectedViews.length > 0 ? (
                        commitAffectedViews.map(view => {
                          const isActive = commitCompareState?.viewId === view.viewId;
                          return (
                            <button
                              key={view.viewId}
                              onClick={() => void handleCompareHistoryView(selectedHistoryCommit, view.viewId)}
                              style={{
                                textAlign: 'left',
                                borderRadius: 10,
                                border: isActive ? '1px solid rgba(37,99,235,0.24)' : '1px solid var(--border, rgba(0,0,0,0.06))',
                                background: isActive ? 'var(--surface-selected, rgba(37,99,235,0.08))' : 'var(--surface-hover, rgba(0,0,0,0.02))',
                                padding: '10px 11px',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>
                                  {view.viewName}
                                </span>
                                <span style={{ fontSize: 10, color: 'var(--accent-text, #1d4ed8)' }}>
                                  Compare
                                </span>
                              </div>
                              <div style={{ marginTop: 6, fontSize: 10.5, color: 'var(--text-muted, #8a8a90)', lineHeight: 1.5 }}>
                                {view.reasons.join(' • ')}
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-muted, #8a8a90)' }}>
                          No affected views could be derived from the current workspace state.
                        </div>
                      )}
                    </div>
                    {commitDetailsError && (
                      <div style={{ marginTop: 10, fontSize: 11.5, color: '#b45309', lineHeight: 1.5 }}>
                        {commitDetailsError}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{
                  borderRadius: 12,
                  border: '1px solid var(--border, rgba(0,0,0,0.06))',
                  background: 'var(--surface-solid, #fff)',
                  padding: '12px 12px 10px',
                  minHeight: 520,
                  display: 'flex',
                  flexDirection: 'column',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--text-faint, #b0b0b8)' }}>
                    View Compare
                  </div>
                  {commitCompareLoading ? (
                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted, #8a8a90)' }}>
                      Loading selected commit snapshot...
                    </div>
                  ) : commitCompareError ? (
                    <div style={{ marginTop: 16, fontSize: 12, color: '#b45309', lineHeight: 1.6 }}>
                      {commitCompareError}
                    </div>
                  ) : commitCompareState ? (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>
                        {commitCompareState.viewName}
                      </div>
                      {commitCompareState.snapshotMissing && (
                        <div style={{ fontSize: 11.5, color: '#b45309', lineHeight: 1.5 }}>
                          This view does not exist in the selected commit. The left side is empty so you can compare against a newly added view.
                        </div>
                      )}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 12,
                        minHeight: 0,
                        flex: 1,
                      }}>
                        <div style={{
                          borderRadius: 10,
                          border: '1px solid var(--border, rgba(0,0,0,0.06))',
                          background: 'var(--surface-hover, rgba(0,0,0,0.015))',
                          padding: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          minHeight: 0,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary, #1a1a1a)' }}>
                            {commitCompareState.commit.shortHash}
                          </div>
                          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--text-muted, #8a8a90)' }}>
                            {commitCompareState.previousElementCount} elements • {commitCompareState.previousRelationshipCount} relationships
                          </div>
                          <div style={{
                            marginTop: 10,
                            borderRadius: 8,
                            overflow: 'auto',
                            background: '#fff',
                            border: '1px solid rgba(0,0,0,0.04)',
                            flex: 1,
                            minHeight: 340,
                          }}>
                            <div
                              style={{ minWidth: '100%', minHeight: '100%', padding: 12 }}
                              dangerouslySetInnerHTML={{ __html: commitCompareState.previousSvg }}
                            />
                          </div>
                        </div>

                        <div style={{
                          borderRadius: 10,
                          border: '1px solid var(--border, rgba(0,0,0,0.06))',
                          background: 'var(--surface-hover, rgba(0,0,0,0.015))',
                          padding: 10,
                          display: 'flex',
                          flexDirection: 'column',
                          minHeight: 0,
                        }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary, #1a1a1a)' }}>
                            Current Workspace
                          </div>
                          <div style={{ marginTop: 4, fontSize: 10.5, color: 'var(--text-muted, #8a8a90)' }}>
                            {commitCompareState.currentElementCount} elements • {commitCompareState.currentRelationshipCount} relationships
                          </div>
                          <div style={{
                            marginTop: 10,
                            borderRadius: 8,
                            overflow: 'auto',
                            background: '#fff',
                            border: '1px solid rgba(0,0,0,0.04)',
                            flex: 1,
                            minHeight: 340,
                          }}>
                            <div
                              style={{ minWidth: '100%', minHeight: '100%', padding: 12 }}
                              dangerouslySetInnerHTML={{ __html: commitCompareState.currentSvg }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted, #8a8a90)', lineHeight: 1.7 }}>
                      Select an affected view to render the selected commit beside the current workspace.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ====== Property panel on right side ====== */}
        {propSide === 'right' && (
          <div style={{
            position: 'absolute', right: 10, top: 52, bottom: 10, width: 252, zIndex: 10,
            background: 'var(--glass-strong, rgba(255,255,255,0.92))',
            backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
            borderRadius: 'var(--radius-lg, 14px)',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
            boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <PropertyPanel
              selEl={selEl}
              selRel={selRel}
              elements={elements}
              relationships={relationships}
              onUpdateElement={updEl}
              onUpdateRelationship={updRel}
              onSelectRelationship={selectRelationshipFromPanel}
              onUpdateView={updView}
              side="right"
              onToggleSide={() => setPropSide('left')}
              currentView={views.find(v => v.id === currentViewId) ?? null}
              onRenameView={renameView}
              elementFolderPath={folderDocument ? elementFolderPath : undefined}
              relationshipFolderPath={folderDocument ? relationshipFolderPath : undefined}
              viewFolderPath={folderDocument ? viewFolderPath : undefined}
              onMoveElementToFolder={folderDocument ? moveSelectedElementToFolder : undefined}
              onMoveRelationshipToFolder={folderDocument ? moveSelectedRelationshipToFolder : undefined}
              onMoveViewToFolder={folderDocument ? moveCurrentViewToFolder : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
