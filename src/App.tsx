import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  ModelElement, ModelRelationship, ModelView,
  Camera, DragState, PanState, DrawingRelState, DragWPState, DragEndpointState, DragLabelState, DragSegmentState,
  RelPickerState, CtxMenuState, CtxMenuItem, GridType, LeftPanel, SelectionType, ResizeState,
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
import { drawDotGrid, drawLineGrid, drawElement, drawRelationship, drawSnapGuides, getRelSegments, type RelSegments } from './canvas';
import { RelPicker, CtxMenu, SearchPanel, ViewNav, PropertyPanel, Btn, CanvasIcon, FloatingToolbar } from './components';
import {
  detectModelFormatByFileName,
  exportEditorModelToText,
  importEditorModelFromText,
  importFragmentedModel,
  isFragmentedModelDirectory,
  listModelFormats,
} from './model/service';
import {
  openDirectory,
  type DirectoryState,
  type OpenFileEntry,
} from './io/filesystem';
import type { ModelDiagnostic } from './model/diagnostics';

const getLayer = (type: string) => ELEMENT_TYPES[type]?.layer;
const isNote = (type: string) => !!ELEMENT_TYPES[type]?.isNote;

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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [views, setViews] = useState<ModelView[]>(SAMPLE_VIEWS);
  const [currentViewId, setCurrentViewId] = useState('v1');
  const [elements, setElements] = useState<ModelElement[]>(SAMPLE_ELEMENTS);
  const [relationships, setRelationships] = useState<ModelRelationship[]>(SAMPLE_RELATIONSHIPS);

  const [importDiag, setImportDiag] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('views');
  const [leftPanelWidth, setLeftPanelWidth] = useState(244);
  const [propSide, setPropSide] = useState<'left' | 'right'>('left');
  const [openTabIds, setOpenTabIds] = useState<string[]>(['v1']);
  const [editingElId, setEditingElId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'view' | 'edit'>('edit');
  const [editingName, setEditingName] = useState('');
  const [showLegend, setShowLegend] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // Filesystem state
  const [dirState, setDirState] = useState<DirectoryState | null>(null);
  const [activeFileEntry, setActiveFileEntry] = useState<OpenFileEntry | null>(null);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const showTransientDiagnostic = useCallback((message: string, timeoutMs: number = 8000) => {
    setImportDiag(message);
    setTimeout(() => {
      setImportDiag(current => (current === message ? null : current));
    }, timeoutMs);
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
  interface HistorySnapshot { elements: ModelElement[]; relationships: ModelRelationship[]; views: ModelView[] }
  const historyRef = useRef<HistorySnapshot[]>([{
    elements: SAMPLE_ELEMENTS.map(e => ({ ...e })),
    relationships: SAMPLE_RELATIONSHIPS.map(r => ({ ...r, waypoints: [...r.waypoints] })),
    views: SAMPLE_VIEWS.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
  }]);
  const historyIndexRef = useRef(0);

  // Snapshot the current state into the refs so pushHistory can read it synchronously
  const elementsRef = useRef(elements);
  const relationshipsRef = useRef(relationships);
  const viewsRef = useRef(views);
  useEffect(() => { elementsRef.current = elements; }, [elements]);
  useEffect(() => { relationshipsRef.current = relationships; }, [relationships]);
  useEffect(() => { viewsRef.current = views; }, [views]);

  /** Call BEFORE a mutation to save the current state as an undo point */
  const pushHistory = useCallback(() => {
    const snapshot: HistorySnapshot = {
      elements: elementsRef.current.map(e => ({ ...e })),
      relationships: relationshipsRef.current.map(r => ({ ...r, waypoints: [...r.waypoints] })),
      views: viewsRef.current.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
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
  }, []);

  const applySnapshot = useCallback((snap: HistorySnapshot) => {
    setElements(snap.elements.map(e => ({ ...e })));
    setRelationships(snap.relationships.map(r => ({ ...r, waypoints: [...r.waypoints] })));
    setViews(snap.views.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })));
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    // Save current state as the "redo" point if we're at the tip
    if (historyIndexRef.current === historyRef.current.length - 1) {
      const current: HistorySnapshot = {
        elements: elementsRef.current.map(e => ({ ...e })),
        relationships: relationshipsRef.current.map(r => ({ ...r, waypoints: [...r.waypoints] })),
        views: viewsRef.current.map(v => ({ ...v, elementIds: [...v.elementIds], childViewIds: [...v.childViewIds] })),
      };
      historyRef.current.push(current);
    }
    historyIndexRef.current -= 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    applySnapshot(historyRef.current[historyIndexRef.current]);
  }, [applySnapshot]);

  const initialLayouts = useMemo(
    () => buildLayoutsFromEditorModel(SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS),
    [],
  );
  const elementLayoutsByViewRef = useRef<ElementLayoutsByView>(initialLayouts.elementLayouts);
  const relationshipLayoutsByViewRef = useRef<RelationshipLayoutsByView>(initialLayouts.relationshipLayouts);

  const modelFormats = useMemo(() => listModelFormats(), []);

  const selectedFormatId = ioFormatId === 'auto' ? 'openarchi-json' : ioFormatId;
  const activeView = useMemo(() => {
    if (views.length === 0) return null;
    return views.find(view => view.id === currentViewId) || views[0];
  }, [views, currentViewId]);

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

  const visibleRelationships = useMemo(
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
    if (relationships.length > 0 && visibleRelationships.length === 0 && visibleElementIds.size > 0) {
      const sample = relationships.slice(0, 3);
      const elSample = Array.from(visibleElementIds).slice(0, 3);
      showTransientDiagnostic(
        `${relationships.length} relationships loaded but none visible in current view (${visibleElementIds.size} elements). `
        + `Sample endpoints: ${sample.map(relationship => `${relationship.sourceId}->${relationship.targetId}`).join(', ')}. `
        + `Sample view element IDs: ${elSample.join(', ')}`,
      );
    }
  }, [relationships, visibleRelationships, visibleElementIds, showTransientDiagnostic]);

  // Element lookup map for O(1) access in getRelPoints/drawRelationship
  const visibleElementMap = useMemo(
    () => new Map(visibleElements.map(e => [e.id, e])),
    [visibleElements],
  );

  const saveViewLayoutSnapshot = useCallback((viewId: string) => {
    const view = views.find(candidate => candidate.id === viewId);
    if (!view) return;

    const memberIds = new Set(view.elementIds || []);
    const elementLayout: Record<string, ElementViewLayout> = {
      ...(elementLayoutsByViewRef.current[viewId] || {}),
    };
    const relationshipLayout: Record<string, RelationshipViewLayout> = {
      ...(relationshipLayoutsByViewRef.current[viewId] || {}),
    };

    for (const element of elements) {
      if (!memberIds.has(element.id)) continue;
      elementLayout[element.id] = {
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
      relationshipLayout[relationship.id] = {
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
        relativeBendpoints: relationship.relativeBendpoints,
      };
    }

    elementLayoutsByViewRef.current = {
      ...elementLayoutsByViewRef.current,
      [viewId]: elementLayout,
    };
    relationshipLayoutsByViewRef.current = {
      ...relationshipLayoutsByViewRef.current,
      [viewId]: relationshipLayout,
    };
  }, [views, elements, relationships]);

  const applyViewLayout = useCallback((viewId: string) => {
    const elementLayout = elementLayoutsByViewRef.current[viewId] || {};
    const relationshipLayout = relationshipLayoutsByViewRef.current[viewId] || {};

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

    setRelationships(prev => prev.map(relationship => {
      const layout = relationshipLayout[relationship.id];
      if (!layout) return relationship;
      return {
        ...relationship,
        waypoints: layout.waypoints,
        labelPos: layout.labelPos,
        relativeBendpoints: layout.relativeBendpoints,
      };
    }));
  }, []);

  // ==================== CAMERA ====================
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, s: 1 });
  const [cSize, setCSize] = useState({ w: 800, h: 600 });

  // rAF-throttled camera updates — avoids re-rendering more than once per frame
  const camPendingRef = useRef<Camera | null>(null);
  const camRafRef = useRef(0);
  const setCamThrottled = useCallback((next: Camera | ((prev: Camera) => Camera)) => {
    if (typeof next === 'function') {
      const current = camPendingRef.current ?? cam;
      camPendingRef.current = next(current);
    } else {
      camPendingRef.current = next;
    }
    if (!camRafRef.current) {
      camRafRef.current = requestAnimationFrame(() => {
        camRafRef.current = 0;
        if (camPendingRef.current) {
          setCam(camPendingRef.current);
          camPendingRef.current = null;
        }
      });
    }
  }, [cam]);

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
    x: (sx - cam.x) / cam.s,
    y: (sy - cam.y) / cam.s,
  }), [cam]);

  // Pre-compute parent IDs — prefer structural data from import, fall back to spatial detection
  const parentIds = useMemo(() => {
    const ids = new Set<string>();

    // Try structural detection first (from parsed nesting hierarchy)
    const currentLayout = elementLayoutsByViewRef.current[currentViewId] || {};
    for (const [elementId, layout] of Object.entries(currentLayout)) {
      if (layout.isParent) ids.add(elementId);
    }

    // If no structural data available, fall back to spatial containment detection
    if (ids.size === 0 && visibleElements.length > 0) {
      const n = visibleElements.length;
      if (n < 200) {
        for (const outer of visibleElements) {
          for (const inner of visibleElements) {
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
        const byArea = [...visibleElements].sort((a, b) => (b.w * b.h) - (a.w * a.h));
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
    }
    return ids;
  }, [visibleElements, currentViewId]);

  // Archi draw order: containers behind children, composites behind non-composites.
  // Sort by: 1) nesting depth (zIndex), 2) composites before non-composites, 3) area descending (larger behind smaller)
  const sortedElements = useMemo(() => {
    const isComp = (el: ModelElement) => {
      const layer = ELEMENT_TYPES[el.type]?.layer;
      return layer === 'composite' && el.type !== 'note';
    };
    return [...visibleElements].sort((a, b) => {
      // Primary: lower zIndex draws first (parents behind children)
      const za = a.zIndex ?? 0, zb = b.zIndex ?? 0;
      if (za !== zb) return za - zb;
      // Secondary: composites draw before non-composites at same depth
      const ca = isComp(a) ? 0 : 1, cb = isComp(b) ? 0 : 1;
      if (ca !== cb) return ca - cb;
      // Tertiary: larger elements draw first (behind smaller ones)
      return (b.w * b.h) - (a.w * a.h);
    });
  }, [visibleElements]);

  // Track canvas dimensions to avoid unnecessary reallocation
  const canvasDimsRef = useRef({ w: 0, h: 0 });

  // ==================== RENDER LOOP ====================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = cSize.w * dpr, ph = cSize.h * dpr;
    // Only resize canvas buffer when dimensions actually change (expensive operation)
    if (canvasDimsRef.current.w !== pw || canvasDimsRef.current.h !== ph) {
      canvas.width = pw;
      canvas.height = ph;
      canvas.style.width = cSize.w + 'px';
      canvas.style.height = cSize.h + 'px';
      canvasDimsRef.current = { w: pw, h: ph };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#f5f6f8';
    ctx.fillRect(0, 0, cSize.w, cSize.h);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.s, cam.s);

    // Grid
    if (gridType === 'dot') drawDotGrid(ctx, cSize.w, cSize.h, cam.x, cam.y, cam.s);
    else drawLineGrid(ctx, cSize.w, cSize.h, cam.x, cam.y, cam.s);

    // Viewport culling — only draw elements/relationships visible on screen
    const vpMargin = 100; // extra margin in world coords to avoid pop-in
    const vpLeft = -cam.x / cam.s - vpMargin;
    const vpTop = -cam.y / cam.s - vpMargin;
    const vpRight = vpLeft + cSize.w / cam.s + vpMargin * 2;
    const vpBottom = vpTop + cSize.h / cam.s + vpMargin * 2;

    const inViewport = (el: { x: number; y: number; w: number; h: number }) =>
      el.x + el.w >= vpLeft && el.x <= vpRight && el.y + el.h >= vpTop && el.y <= vpBottom;

    const culledElements = sortedElements.filter(inViewport);

    // Elements — single pass sorted by zIndex (parents draw before children)
    for (const el of culledElements) {
      drawElement(
        ctx,
        el,
        selType === 'element' && selectedId === el.id,
        (selType === 'element' && selectedId === el.id) || hovElId === el.id,
        parentIds.has(el.id),
      );
    }

    // 3. Relationships (always on top of elements) — with crossing hops
    // For large models, skip crossing detection (expensive O(n²))
    const skipCrossings = visibleRelationships.length > 200;

    if (skipCrossings) {
      for (const r of visibleRelationships) {
        drawRelationship(ctx, r, visibleElements, selType === 'relationship' && selectedId === r.id, hovRelId === r.id, [], visibleElementMap);
      }
    } else {
      const allRelSegs: RelSegments[] = visibleRelationships
        .map(r => getRelSegments(r, visibleElements, visibleElementMap))
        .filter((s): s is RelSegments => s !== null);

      // Pre-build a flat list of all segments with their owning relId for fast exclusion
      const allFlatSegs = allRelSegs.flatMap(s => s.segments.map(seg => ({ ...seg, relId: s.relId })));

      for (const r of visibleRelationships) {
        const otherSegs = allFlatSegs.filter(s => s.relId !== r.id);
        drawRelationship(ctx, r, visibleElements, selType === 'relationship' && selectedId === r.id, hovRelId === r.id, otherSegs, visibleElementMap);
      }
    }

    // 4. Snap guide lines
    if (snapGuides.length > 0) {
      drawSnapGuides(ctx, snapGuides, cSize.w, cSize.h, cam.x, cam.y, cam.s);
    }

    // 5. Drawing-in-progress relationship (with waypoints + arrowhead)
    if (drawingRel) {
      const src = visibleElements.find(e => e.id === drawingRel.sourceId);
      if (src) {
        const wps = drawingRel.waypoints;
        const startPt = wps.length > 0 ? wps[0] : null;
        const a = nearestAnchor(src, startPt?.x ?? drawingRel.mx, startPt?.y ?? drawingRel.my);
        const col = '#4a5568';
        ctx.save();
        // Line
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (const wp of wps) ctx.lineTo(wp.x, wp.y);
        ctx.lineTo(drawingRel.mx, drawingRel.my);
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
        // Arrowhead at cursor end (open chevron like serving arrow)
        const prevPt = wps.length > 0 ? wps[wps.length - 1] : a;
        const dx = drawingRel.mx - prevPt.x;
        const dy = drawingRel.my - prevPt.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          const angle = Math.atan2(dy, dx);
          const aLen = 11;
          const aSpread = 0.45;
          ctx.beginPath();
          ctx.moveTo(drawingRel.mx - aLen * Math.cos(angle - aSpread), drawingRel.my - aLen * Math.sin(angle - aSpread));
          ctx.lineTo(drawingRel.mx, drawingRel.my);
          ctx.lineTo(drawingRel.mx - aLen * Math.cos(angle + aSpread), drawingRel.my - aLen * Math.sin(angle + aSpread));
          ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
        }
        // Waypoint dots
        for (const wp of wps) {
          ctx.beginPath(); ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }, [visibleElements, visibleElementMap, visibleRelationships, sortedElements, parentIds, selectedId, selType, cam, cSize, hovElId, hovRelId, drawingRel, gridType, snapGuides]);

  // ==================== MOUSE HANDLERS ====================
  const isViewMode = interactionMode === 'view';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (relPicker || ctxMenu) { setRelPicker(null); setCtxMenu(null); return; }
    if (editingElId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    // View mode: only allow selection (inspect), panning, and view navigation
    if (isViewMode) {
      const linked = hitTestPopout(visibleElements, wx, wy);
      if (linked) { navigateToView(linked); return; }

      const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
      if (el) {
        setSelectedId(el.id); setSelType('element');
      } else {
        const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
        if (rh) { setSelectedId(rh.rel.id); setSelType('relationship'); }
        else { setSelectedId(null); setSelType(null); setPanning({ sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }); }
      }
      return;
    }

    if (drawingRel && e.shiftKey) {
      setDrawingRel(prev => prev ? { ...prev, waypoints: [...prev.waypoints, { x: snap(wx), y: snap(wy) }] } : null);
      return;
    }

    const linked = hitTestPopout(visibleElements, wx, wy);
    if (linked) { navigateToView(linked); return; }

    // Resize handles take priority over everything (they overlap anchor zones at corners)
    if (selType === 'element' && selectedId) {
      const selEl = visibleElements.find(e => e.id === selectedId);
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
    if (anch) { setDrawingRel({ sourceId: anch.elId, mx: wx, my: wy, waypoints: [] }); return; }

    // Endpoint dragging — only when a relationship is selected
    if (selType === 'relationship' && selectedId) {
      const selRel = visibleRelationships.find(r => r.id === selectedId);
      if (selRel) {
        const ep = hitTestEndpoint(selRel, visibleElements, wx, wy);
        if (ep) { pushHistory(); setDragEndpoint({ relId: selRel.id, endpoint: ep }); return; }
      }
    }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy);
    if (wp) { pushHistory(); setDragWP({ ...wp, startX: wx, startY: wy }); return; }

    const lbl = hitTestLabel(visibleRelationships, visibleElements, wx, wy);
    if (lbl) { pushHistory(); setDragLabel({ relId: lbl.id }); setSelectedId(lbl.id); setSelType('relationship'); return; }

    const el = hitTestElement(sortedElements, wx, wy, getLayer, isNote);
    if (el) {
      setSelectedId(el.id); setSelType('element');
      pushHistory();
      setDragging({ id: el.id, ox: wx - el.x, oy: wy - el.y });
    } else {
      const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
      if (rh) {
        setSelectedId(rh.rel.id); setSelType('relationship');
        // If already selected, start segment drag
        if (selType === 'relationship' && selectedId === rh.rel.id) {
          const orient = getSegmentOrientation(rh.rel, visibleElements, rh.segIdx, visibleElementMap);
          if (orient) {
            pushHistory();
            setDragSegment({ relId: rh.rel.id, segIdx: rh.segIdx, orientation: orient, startWx: wx, startWy: wy });
          }
        }
      }
      else { setSelectedId(null); setSelType(null); setPanning({ sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }); }
    }
  }, [s2w, visibleElements, visibleRelationships, cam, relPicker, ctxMenu, drawingRel, editingElId, navigateToView, selType, selectedId, pushHistory, isViewMode]);

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
      const others = visibleElements.filter(el => el.id !== resizing.id);
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
      setElements(prev => prev.map(el => el.id === resizing.id ? { ...el, x: left, y: top, w: right - left, h: bottom - top } : el));
      return;
    }
    if (drawingRel) { setDrawingRel(p => p ? { ...p, mx: wx, my: wy } : null); return; }
    if (dragWP) {
      setRelationships(prev => prev.map(r => r.id === dragWP.relId ? { ...r, waypoints: r.waypoints.map((w, i) => i === dragWP.wpIdx ? { x: snap(wx), y: snap(wy) } : w) } : r));
      return;
    }
    if (dragSegment) {
      setRelationships(prev => prev.map(r => {
        if (r.id !== dragSegment.relId) return r;
        const pts = getRelPoints(r, visibleElements, visibleElementMap);
        if (!pts) return r;
        const allPts = [pts.start, ...pts.waypoints, pts.end];
        const si = dragSegment.segIdx;
        const wpCount = pts.waypoints.length;

        if (wpCount === 0) {
          // No waypoints yet — create 2 waypoints to form a 3-segment orthogonal path
          const a = allPts[0], b = allPts[allPts.length - 1];
          if (dragSegment.orientation === 'h') {
            // Horizontal segment → drag vertically → create Z-route
            const newY = snap(wy);
            return { ...r, waypoints: [{ x: a.x, y: newY }, { x: b.x, y: newY }], relativeBendpoints: undefined };
          } else {
            const newX = snap(wx);
            return { ...r, waypoints: [{ x: newX, y: a.y }, { x: newX, y: b.y }], relativeBendpoints: undefined };
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

        return { ...r, waypoints: newWaypoints, relativeBendpoints: undefined };
      }));
      return;
    }
    if (dragEndpoint) {
      const key = dragEndpoint.endpoint === 'source' ? 'sourceAnchor' : 'targetAnchor';
      setRelationships(prev => prev.map(r => r.id === dragEndpoint.relId ? { ...r, [key]: { x: snap(wx), y: snap(wy) } } : r));
      return;
    }
    if (dragLabel) {
      const rel = visibleRelationships.find(r => r.id === dragLabel.relId);
      if (rel) {
        const pts = getRelPoints(rel, visibleElements);
        if (pts) {
          const allPts = [pts.start, ...pts.waypoints, pts.end];
          const newT = nearestTOnPath(allPts, wx, wy);
          setRelationships(prev => prev.map(r => r.id === dragLabel.relId ? { ...r, labelPos: newT } : r));
        }
      }
      return;
    }
    if (dragging) {
      const draggedEl = visibleElements.find(el => el.id === dragging.id);
      if (draggedEl) {
        const proposedX = snap(wx - dragging.ox);
        const proposedY = snap(wy - dragging.oy);
        const others = visibleElements.filter(el => el.id !== dragging.id);
        const result = snapToElements({ x: proposedX, y: proposedY, w: draggedEl.w, h: draggedEl.h }, others);
        setSnapGuides(result.guides);

        setElements(prev => prev.map(el => el.id === dragging.id ? { ...el, x: result.x, y: result.y } : el));
      }
    } else if (panning) {
      setCamThrottled(p => ({ ...p, x: panning.cx + e.clientX - panning.sx, y: panning.cy + e.clientY - panning.sy }));
    } else {
      if (selType === 'element' && selectedId) {
        const selElHov = visibleElements.find(e => e.id === selectedId);
        if (selElHov) {
          const handle = hitTestResizeHandle(selElHov, wx, wy);
          if (handle) {
            canvas.style.cursor = HANDLE_CURSORS[handle];
            setHovElId(null); setHovRelId(null);
            return;
          }
        }
      }
      const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
      setHovElId(el?.id || null);
      if (!el) {
        const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
        setHovRelId(rh?.rel?.id || null);
      } else setHovRelId(null);
      canvas.style.cursor = 'default';
    }
  }, [s2w, dragging, panning, visibleElements, visibleRelationships, visibleElementMap, drawingRel, dragWP, dragEndpoint, dragLabel, dragSegment, resizing, selType, selectedId, setCamThrottled]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (drawingRel) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);
      const tgt = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
      if (tgt && tgt.id !== drawingRel.sourceId) {
        relPickerWaypoints.current = drawingRel.waypoints;
        setRelPicker({ sx: e.clientX - rect.left, sy: e.clientY - rect.top, srcId: drawingRel.sourceId, tgtId: tgt.id });
      }
      setDrawingRel(null); return;
    }
    setDragging(null); setPanning(null); setDragWP(null); setDragEndpoint(null); setDragLabel(null); setDragSegment(null); setResizing(null);
    setSnapGuides([]);
  }, [drawingRel, s2w, visibleElements]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);

    const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
    if (el) {
      // View navigation always allowed
      if (el.linkedViewId) {
        navigateToView(el.linkedViewId);
        return;
      }
      // Inline editing only in edit mode
      if (!isViewMode) {
        setEditingElId(el.id);
        setEditingName(el.name);
        setSelectedId(el.id);
        setSelType('element');
      }
      return;
    }

    if (!isViewMode) {
      const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
      if (rh) {
        const name = prompt('Relationship label:', rh.rel.name || '');
        if (name !== null) { pushHistory(); setRelationships(prev => prev.map(r => r.id === rh.rel.id ? { ...r, name } : r)); }
      }
    }
  }, [s2w, visibleElements, visibleRelationships, navigateToView, isViewMode, pushHistory]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isViewMode) return; // No context menu in view mode
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
    if (el) {
      setSelectedId(el.id); setSelType('element');
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
            action: () => { pushHistory(); setElements(prev => prev.map(e => e.id === el.id ? { ...e, type: k } : e)); },
          });
        }
      }

      const items: CtxMenuItem[] = [
        { label: 'Rename', action: () => { setEditingElId(el.id); setEditingName(el.name); } },
        { label: 'Change type', children: changeTypeChildren },
        { label: '', separator: true },
        {
          label: 'Bring to front',
          action: () => {
            pushHistory();
            const maxZ = Math.max(0, ...elements.map(e => e.zIndex ?? 0));
            setElements(prev => prev.map(e => e.id === el.id ? { ...e, zIndex: maxZ + 1 } : e));
          },
        },
        {
          label: 'Send to back',
          action: () => {
            pushHistory();
            const minZ = Math.min(0, ...elements.map(e => e.zIndex ?? 0));
            setElements(prev => prev.map(e => e.id === el.id ? { ...e, zIndex: minZ - 1 } : e));
          },
        },
        { label: '', separator: true },
        {
          label: 'Delete',
          action: () => {
            pushHistory();
            setElements(prev => prev.filter(e => e.id !== el.id));
            setRelationships(prev => prev.filter(r => r.sourceId !== el.id && r.targetId !== el.id));
            setViews(prev => prev.map(view => ({
              ...view,
              elementIds: (view.elementIds || []).filter(elementId => elementId !== el.id),
            })));
            setSelectedId(null);
            setSelType(null);
          },
        },
      ];

      setCtxMenu({ x: sx, y: sy, items });
      return;
    }

    const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
    if (rh) {
      setCtxMenu({
        x: sx, y: sy,
        items: [
          { label: 'Add waypoint here', action: () => { pushHistory(); setRelationships(prev => prev.map(r => { if (r.id !== rh.rel.id) return r; const wps = [...(r.waypoints || [])]; wps.splice(rh.segIdx, 0, { x: snap(wx), y: snap(wy) }); return { ...r, waypoints: wps }; })); } },
          { label: 'Edit label', action: () => { pushHistory(); const name = prompt('Label:', rh.rel.name || ''); if (name !== null) setRelationships(prev => prev.map(r => r.id === rh.rel.id ? { ...r, name } : r)); } },
          ...(rh.rel.waypoints?.length > 0 ? [{ label: 'Remove all waypoints', action: () => { pushHistory(); setRelationships(prev => prev.map(r => r.id === rh.rel.id ? { ...r, waypoints: [] } : r)); } }] : []),
          ...((rh.rel.sourceAnchor || rh.rel.targetAnchor) ? [{ label: 'Reset endpoints to auto', action: () => { pushHistory(); setRelationships(prev => prev.map(r => r.id === rh.rel.id ? { ...r, sourceAnchor: undefined, targetAnchor: undefined } : r)); } }] : []),
          { label: 'Delete relationship', action: () => { pushHistory(); setRelationships(prev => prev.filter(r => r.id !== rh.rel.id)); if (selectedId === rh.rel.id) { setSelectedId(null); setSelType(null); } } },
        ],
      });
      return;
    }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy);
    if (wp) {
      setCtxMenu({ x: sx, y: sy, items: [{ label: 'Remove waypoint', action: () => { pushHistory(); setRelationships(prev => prev.map(r => r.id === wp.relId ? { ...r, waypoints: r.waypoints.filter((_, i) => i !== wp.wpIdx) } : r)); } }] });
    }
  }, [s2w, visibleElements, visibleRelationships, selectedId, pushHistory, elements, isViewMode]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.08 : 0.93;
    const ns = Math.min(3, Math.max(0.2, cam.s * f));
    const wx = (sx - cam.x) / cam.s, wy = (sy - cam.y) / cam.s;
    setCamThrottled({ s: ns, x: sx - wx * ns, y: sy - wy * ns });
  }, [cam, setCamThrottled]);

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
    setViews(prev => prev.map(view =>
      view.id === currentViewId
        ? { ...view, elementIds: [...new Set([...(view.elementIds || []), el.id])] }
        : view,
    ));
    setSelectedId(el.id); setSelType('element');
  }, [s2w, cSize, currentViewId, pushHistory]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    pushHistory();
    if (selType === 'element') {
      setElements(prev => prev.filter(e => e.id !== selectedId));
      setRelationships(prev => prev.filter(r => r.sourceId !== selectedId && r.targetId !== selectedId));
      setViews(prev => prev.map(view => ({
        ...view,
        elementIds: (view.elementIds || []).filter(elementId => elementId !== selectedId),
      })));
    } else {
      setRelationships(prev => prev.filter(r => r.id !== selectedId));
    }
    setSelectedId(null); setSelType(null);
  }, [selectedId, selType, pushHistory]);

  const exportModel = useCallback(() => {
    const result = exportEditorModelToText({ version: 'openarchi-0.1', elements, relationships, views }, selectedFormatId);
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
  }, [elements, relationships, views, selectedFormatId, summarizeDiagnostics]);

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
        elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
        relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;

        setElements(result.model.elements);
        setRelationships(result.model.relationships);
        setViews(result.model.views);
        if (result.model.views.length > 0) {
          setCurrentViewId(result.model.views[0].id);
          setOpenTabIds([result.model.views[0].id]);
          applyViewLayout(result.model.views[0].id);
        }
        setSelectedId(null); setSelType(null);
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
      elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
      relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;

      setElements(result.model.elements);
      setRelationships(result.model.relationships);
      setViews(result.model.views);
      if (result.model.views.length > 0) {
        setCurrentViewId(result.model.views[0].id);
        setOpenTabIds([result.model.views[0].id]);
        applyViewLayout(result.model.views[0].id);
      }
      setSelectedId(null); setSelType(null);

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

      setActiveFileEntry(entry);
      setActiveFormatId(formatId);
      setIsDirty(false);
    } catch (err) {
      alert(`Failed to open file: ${err}`);
    }
  }, [applyViewLayout, fitToContent, summarizeDiagnostics]);

  const loadFragmentedModel = useCallback(async (files: OpenFileEntry[]) => {
    try {
      setImportDiag(null);
      const result = await importFragmentedModel(files);
      if (!result.model) {
        const firstError = result.diagnostics.find(d => d.severity === 'error');
        alert(firstError?.message || 'Failed to import fragmented model');
        return;
      }
      summarizeDiagnostics('Import', result.diagnostics);

      const importedLayouts = result.document
        ? buildLayoutsFromCanonicalDocument(result.document)
        : buildLayoutsFromEditorModel(result.model.elements, result.model.relationships, result.model.views);
      elementLayoutsByViewRef.current = importedLayouts.elementLayouts;
      relationshipLayoutsByViewRef.current = importedLayouts.relationshipLayouts;

      setElements(result.model.elements);
      setRelationships(result.model.relationships);
      setViews(result.model.views);
      if (result.model.views.length > 0) {
        setCurrentViewId(result.model.views[0].id);
        setOpenTabIds([result.model.views[0].id]);
        applyViewLayout(result.model.views[0].id);
      }
      setSelectedId(null); setSelType(null);
      setActiveFormatId('coarchi-xml');
      setIsDirty(false);

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
      alert(`Failed to import fragmented model: ${err}`);
    }
  }, [applyViewLayout, fitToContent, showTransientDiagnostic, summarizeDiagnostics]);

  const handleOpenDirectory = useCallback(async () => {
    try {
      const state = await openDirectory();
      setDirState(state);

      // Detect fragmented coArchi directory (individual XML files per element)
      const isFragmented = isFragmentedModelDirectory(state.files);

      if (isFragmented) {
        await loadFragmentedModel(state.files);
        return;
      }

      // Auto-open the first archimate/xml/json file
      if (state.files.length > 0) {
        await loadFileEntry(state.files[0]);
      } else {
        showTransientDiagnostic(`No supported model files found in '${state.directoryName}'.`);
      }
    } catch (err) {
      // User cancelled the picker
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Failed to open directory: ${err}`);
    }
  }, [loadFileEntry, loadFragmentedModel, showTransientDiagnostic]);

  const handleSave = useCallback(async () => {
    if (!activeFileEntry || !activeFormatId) {
      // Fallback to download export
      exportModel();
      return;
    }
    const result = exportEditorModelToText({ version: 'openarchi-0.1', elements, relationships, views }, activeFormatId);
    const hasError = result.diagnostics.some(d => d.severity === 'error');
    if (hasError) {
      const firstError = result.diagnostics.find(d => d.severity === 'error');
      alert(firstError?.message || 'Save failed');
      return;
    }
    if (activeFileEntry.writeText) {
      try {
        await activeFileEntry.writeText(result.content);
        setIsDirty(false);
      } catch (err) {
        alert(`Save failed: ${err}`);
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
      setIsDirty(false);
    }
  }, [activeFileEntry, activeFormatId, elements, relationships, views, exportModel]);

  // Mark dirty on model changes (skip initial render)
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) { isInitialRender.current = false; return; }
    if (activeFileEntry) setIsDirty(true);
  }, [elements, relationships, views, activeFileEntry]);

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
      if (e.key === 'Escape') { setRelPicker(null); setCtxMenu(null); setShowSearch(false); setDrawingRel(null); cancelEditing(); }
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
    if (selType === 'element' && !visibleElementIds.has(selectedId)) {
      setSelectedId(null);
      setSelType(null);
      return;
    }
    if (selType === 'relationship') {
      const isVisible = visibleRelationships.some(relationship => relationship.id === selectedId);
      if (!isVisible) {
        setSelectedId(null);
        setSelType(null);
      }
    }
  }, [selectedId, selType, visibleElementIds, visibleRelationships]);

  // ==================== DERIVED STATE ====================
  const selEl = selType === 'element' ? elements.find(e => e.id === selectedId) || null : null;
  const selRel = selType === 'relationship' ? relationships.find(r => r.id === selectedId) || null : null;

  const propEditPushedRef = useRef(false);
  useEffect(() => { propEditPushedRef.current = false; }, [selectedId]);

  const updEl = useCallback((k: string, v: unknown) => {
    if (!propEditPushedRef.current) { pushHistory(); propEditPushedRef.current = true; }
    setElements(p => p.map(e => e.id === selectedId ? { ...e, [k]: v } : e));
  }, [selectedId, pushHistory]);

  const updRel = useCallback((k: string, v: unknown) => {
    if (!propEditPushedRef.current) { pushHistory(); propEditPushedRef.current = true; }
    setRelationships(p => p.map(r => r.id === selectedId ? { ...r, [k]: v } : r));
  }, [selectedId, pushHistory]);

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

  // Left panel cycling (views + changelog only — palette moved to toolbar)
  const cycleLeftPanel = useCallback(() => {
    setLeftPanel(p => p === 'views' ? 'changelog' : 'views');
  }, []);

  const leftPanelLabel = leftPanel === 'views' ? 'Changelog' : 'Views';

  // ==================== RENDER ====================
  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, background: 'var(--bg, #f3f4f6)', color: 'var(--text-primary, #1a1a1a)' }}>
      {/* Full-screen canvas area with floating UI */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* ====== Top-left: Logo + file info ====== */}
        <div style={{
          position: 'absolute', top: 10, left: 10, zIndex: 10,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--glass, rgba(255,255,255,0.82))',
          backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
          borderRadius: 'var(--radius-md, 10px)',
          boxShadow: 'var(--shadow-md, 0 2px 12px rgba(0,0,0,0.06))',
          padding: '5px 10px',
        }}>
          <div style={{ width: 20, height: 20, background: 'var(--text-primary, #1a1a1a)', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 600, color: '#fff', letterSpacing: '-0.3px' }}>OA</div>
          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary, #1a1a1a)', letterSpacing: '-0.01em' }}>OpenArchi</span>
          {activeFileEntry && (
            <span style={{ fontSize: 11, color: 'var(--text-muted, #8a8a90)' }}>
              {dirState ? `${dirState.directoryName}/` : ''}{activeFileEntry.relativePath}{isDirty ? ' *' : ''}
            </span>
          )}
        </div>

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
          <Btn onClick={cycleLeftPanel}>{leftPanelLabel}</Btn>
        </div>

        {/* ====== Tab bar island ====== */}
        <div style={{
          position: 'absolute', top: 10,
          left: activeFileEntry ? 320 : 200,
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
                onClick={() => navigateToView(tid)}
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
                <span>{v?.name || tid}</span>
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
          {leftPanel === 'views' ? (
            <ViewNav views={views} currentViewId={currentViewId} onNavigate={navigateToView} />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px 6px', fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Changelog</div>
              <div style={{ padding: '8px 12px', color: 'var(--text-faint, #b0b0b8)', fontSize: 12, lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 8px', color: 'var(--text-muted, #8a8a90)', fontWeight: 400 }}>Change history will appear here.</p>
                <p style={{ margin: 0, fontSize: 11 }}>
                  Track element additions, modifications, relationship changes, and view updates over time.
                </p>
              </div>
            </div>
          )}
          {/* Property panel on left side */}
          {propSide === 'left' && (
            <PropertyPanel
              selEl={selEl}
              selRel={selRel}
              elements={elements}
              onUpdateElement={updEl}
              onUpdateRelationship={updRel}
              side="left"
              onToggleSide={() => setPropSide('right')}
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
                setRelationships(p => [...p, { id: uid(), type: t, sourceId: relPicker.srcId, targetId: relPicker.tgtId, name: '', waypoints: relPickerWaypoints.current, labelPos: 0.5 }]);
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
              views={views}
              onSelectElement={id => {
                setSelectedId(id);
                setSelType('element');
                const inView = visibleElements.find(element => element.id === id);
                const el = inView || elements.find(element => element.id === id);
                if (el) setCam(p => ({ ...p, x: cSize.w / 2 - el.x * p.s, y: cSize.h / 2 - el.y * p.s }));
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
              Hold <strong>Shift + Click</strong> to add a waypoint bend
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
          onSave={handleSave}
          canSave={!!activeFileEntry}
          isDirty={isDirty}
          dirState={!!dirState}
          dirFiles={dirState?.files || []}
          activeFilePath={activeFileEntry?.relativePath || ''}
          onSelectFile={path => {
            const entry = dirState?.files.find(f => f.relativePath === path);
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
              onUpdateElement={updEl}
              onUpdateRelationship={updRel}
              side="right"
              onToggleSide={() => setPropSide('left')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
