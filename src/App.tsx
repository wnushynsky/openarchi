import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type {
  ModelElement, ModelRelationship, ModelView,
  Camera, DragState, PanState, DrawingRelState, DragWPState, DragLabelState,
  RelPickerState, CtxMenuState, GridType, LeftPanel, SelectionType, ResizeState,
} from './types';
import type { CanonicalModelDocument } from './model/canonical';
import {
  LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, FONT,
  snap, uid, GRID,
  nearestAnchor, getRelPoints, nearestTOnPath,
  hitTestElement, hitTestAnchor, hitTestWaypoint, hitTestRelationship, hitTestLabel, hitTestPopout,
  hitTestResizeHandle, HANDLE_CURSORS,
  SAMPLE_ELEMENTS, SAMPLE_RELATIONSHIPS, SAMPLE_VIEWS,
  snapToElements, snapResizeToElements, type SnapGuide,
} from './core';
import { drawDotGrid, drawLineGrid, drawElement, drawRelationship, drawSnapGuides } from './canvas';
import { RelPicker, CtxMenu, SearchPanel, ViewNav, PropertyPanel, Btn, CanvasIcon } from './components';
import {
  detectModelFormatByFileName,
  exportEditorModelToText,
  importEditorModelFromText,
  listModelFormats,
} from './model/service';
import {
  isFileSystemAccessSupported,
  openDirectory,
  readFileHandle,
  writeFileHandle,
  type DirectoryState,
  type OpenFileEntry,
} from './io/filesystem';

const getLayer = (type: string) => ELEMENT_TYPES[type]?.layer;
const isNote = (type: string) => !!ELEMENT_TYPES[type]?.isNote;

interface ElementViewLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  linkedViewId?: string;
}

interface RelationshipViewLayout {
  waypoints: { x: number; y: number }[];
  labelPos: number;
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
      };
    }

    for (const relationship of relationships) {
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      relationshipLayouts[view.id][relationship.id] = {
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
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

  for (const node of document.viewNodes) {
    if (!elementLayouts[node.viewId]) elementLayouts[node.viewId] = {};
    elementLayouts[node.viewId][node.elementId] = {
      x: node.x,
      y: node.y,
      w: node.width,
      h: node.height,
      linkedViewId: node.linkedViewId,
    };
  }

  for (const connection of document.viewConnections) {
    if (!relationshipLayouts[connection.viewId]) relationshipLayouts[connection.viewId] = {};
    relationshipLayouts[connection.viewId][connection.relationshipId] = {
      waypoints: connection.waypoints || [],
      labelPos: connection.labelPosition ?? 0.5,
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
  const [dragLabel, setDragLabel] = useState<DragLabelState | null>(null);
  const [resizing, setResizing] = useState<ResizeState | null>(null);
  const [relPicker, setRelPicker] = useState<RelPickerState | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [ioFormatId, setIoFormatId] = useState<string>('auto');
  const [leftPanel, setLeftPanel] = useState<LeftPanel>('palette');
  const [propSide, setPropSide] = useState<'left' | 'right'>('left');
  const [openTabIds, setOpenTabIds] = useState<string[]>(['v1']);
  const [editingElId, setEditingElId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showLegend, setShowLegend] = useState(false);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  // Filesystem state
  const [dirState, setDirState] = useState<DirectoryState | null>(null);
  const [activeFileHandle, setActiveFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

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
    () => relationships.filter(relationship =>
      visibleElementIds.has(relationship.sourceId) && visibleElementIds.has(relationship.targetId),
    ),
    [relationships, visibleElementIds],
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
      };
    }

    for (const relationship of relationships) {
      if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) continue;
      relationshipLayout[relationship.id] = {
        waypoints: relationship.waypoints || [],
        labelPos: relationship.labelPos ?? 0.5,
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
      };
    }));

    setRelationships(prev => prev.map(relationship => {
      const layout = relationshipLayout[relationship.id];
      if (!layout) return relationship;
      return {
        ...relationship,
        waypoints: layout.waypoints,
        labelPos: layout.labelPos,
      };
    }));
  }, []);

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
  }, [currentViewId, saveViewLayoutSnapshot, applyViewLayout]);

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

  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, s: 1 });
  const [cSize, setCSize] = useState({ w: 800, h: 600 });

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

  // ==================== RENDER LOOP ====================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cSize.w * dpr;
    canvas.height = cSize.h * dpr;
    canvas.style.width = cSize.w + 'px';
    canvas.style.height = cSize.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#f5f6f8';
    ctx.fillRect(0, 0, cSize.w, cSize.h);
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.s, cam.s);

    // Grid
    if (gridType === 'dot') drawDotGrid(ctx, cSize.w, cSize.h, cam.x, cam.y, cam.s);
    else drawLineGrid(ctx, cSize.w, cSize.h, cam.x, cam.y, cam.s);

    // Compute which elements contain other elements (hasChildren)
    const parentIds = new Set<string>();
    for (const outer of visibleElements) {
      for (const inner of visibleElements) {
        if (inner.id === outer.id) continue;
        if (inner.x >= outer.x && inner.y >= outer.y &&
            inner.x + inner.w <= outer.x + outer.w &&
            inner.y + inner.h <= outer.y + outer.h) {
          parentIds.add(outer.id);
          break;
        }
      }
    }

    // 1. Composite elements (background)
    visibleElements.filter(e => getLayer(e.type) === 'composite' && !isNote(e.type)).forEach(el => {
      drawElement(ctx, el, selType === 'element' && selectedId === el.id, hovElId === el.id, (selType === 'element' && selectedId === el.id) || hovElId === el.id, parentIds.has(el.id));
    });

    // 2. Non-composite elements + notes
    visibleElements.filter(e => getLayer(e.type) !== 'composite' || isNote(e.type)).forEach(el => {
      drawElement(ctx, el, selType === 'element' && selectedId === el.id, hovElId === el.id, (selType === 'element' && selectedId === el.id) || hovElId === el.id, parentIds.has(el.id));
    });

    // 3. Relationships (always on top of elements)
    visibleRelationships.forEach(r => drawRelationship(ctx, r, visibleElements, selType === 'relationship' && selectedId === r.id, hovRelId === r.id));

    // 4. Snap guide lines
    if (snapGuides.length > 0) {
      drawSnapGuides(ctx, snapGuides, cSize.w, cSize.h, cam.x, cam.y, cam.s);
    }

    // 5. Drawing-in-progress relationship (with waypoints)
    if (drawingRel) {
      const src = visibleElements.find(e => e.id === drawingRel.sourceId);
      if (src) {
        const wps = drawingRel.waypoints;
        const startPt = wps.length > 0 ? wps[0] : null;
        const a = nearestAnchor(src, startPt?.x ?? drawingRel.mx, startPt?.y ?? drawingRel.my);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        for (const wp of wps) ctx.lineTo(wp.x, wp.y);
        ctx.lineTo(drawingRel.mx, drawingRel.my);
        ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
        // Waypoint dots
        for (const wp of wps) {
          ctx.beginPath(); ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill();
          ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        // Cursor dot
        ctx.beginPath(); ctx.arc(drawingRel.mx, drawingRel.my, 4, 0, Math.PI * 2); ctx.fillStyle = '#3b82f6'; ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }, [visibleElements, visibleRelationships, selectedId, selType, cam, cSize, hovElId, hovRelId, drawingRel, gridType, snapGuides]);

  // ==================== MOUSE HANDLERS ====================
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (relPicker || ctxMenu) { setRelPicker(null); setCtxMenu(null); return; }
    if (editingElId) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    if (drawingRel && e.shiftKey) {
      setDrawingRel(prev => prev ? { ...prev, waypoints: [...prev.waypoints, { x: snap(wx), y: snap(wy) }] } : null);
      return;
    }

    const linked = hitTestPopout(visibleElements, wx, wy);
    if (linked) { navigateToView(linked); return; }

    const anch = hitTestAnchor(visibleElements, wx, wy, getLayer, isNote);
    if (anch) { setDrawingRel({ sourceId: anch.elId, mx: wx, my: wy, waypoints: [] }); return; }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy);
    if (wp) { pushHistory(); setDragWP({ ...wp, startX: wx, startY: wy }); return; }

    const lbl = hitTestLabel(visibleRelationships, visibleElements, wx, wy);
    if (lbl) { pushHistory(); setDragLabel({ relId: lbl.id }); setSelectedId(lbl.id); setSelType('relationship'); return; }

    // Check resize handles on currently selected element first
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

    const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
    if (el) {
      setSelectedId(el.id); setSelType('element');
      pushHistory();
      setDragging({ id: el.id, ox: wx - el.x, oy: wy - el.y });
    } else {
      const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
      if (rh) { setSelectedId(rh.rel.id); setSelType('relationship'); }
      else { setSelectedId(null); setSelType(null); setPanning({ sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y }); }
    }
  }, [s2w, visibleElements, visibleRelationships, cam, relPicker, ctxMenu, drawingRel, editingElId, navigateToView, selType, selectedId, pushHistory]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { x: wx, y: wy } = s2w(sx, sy);

    if (resizing) {
      const dx = wx - resizing.startWx, dy = wy - resizing.startWy;
      const rh = resizing.handle;
      let nx = resizing.origX, ny = resizing.origY, nw = resizing.origW, nh = resizing.origH;
      if (rh.includes('w')) { nx = resizing.origX + dx; nw = resizing.origW - dx; }
      if (rh.includes('e')) { nw = resizing.origW + dx; }
      if (rh.includes('n')) { ny = resizing.origY + dy; nh = resizing.origH - dy; }
      if (rh.includes('s')) { nh = resizing.origH + dy; }
      nw = Math.max(60, nw); nh = Math.max(40, nh);
      if (nw === 60 && rh.includes('w')) nx = resizing.origX + resizing.origW - 60;
      if (nh === 40 && rh.includes('n')) ny = resizing.origY + resizing.origH - 40;
      // Grid-snap first, then smart-snap to elements
      nx = snap(nx); ny = snap(ny); nw = snap(nw); nh = snap(nh);
      const others = visibleElements.filter(el => el.id !== resizing.id);
      const result = snapResizeToElements({ x: nx, y: ny, w: nw, h: nh }, rh, others);
      setSnapGuides(result.guides);
      setElements(prev => prev.map(el => el.id === resizing.id ? { ...el, x: result.x, y: result.y, w: result.w, h: result.h } : el));
      return;
    }
    if (drawingRel) { setDrawingRel(p => p ? { ...p, mx: wx, my: wy } : null); return; }
    if (dragWP) {
      setRelationships(prev => prev.map(r => r.id === dragWP.relId ? { ...r, waypoints: r.waypoints.map((w, i) => i === dragWP.wpIdx ? { x: snap(wx), y: snap(wy) } : w) } : r));
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
      setCam(p => ({ ...p, x: panning.cx + e.clientX - panning.sx, y: panning.cy + e.clientY - panning.sy }));
    } else {
      if (selType === 'element' && selectedId) {
        const selElHov = visibleElements.find(e => e.id === selectedId);
        if (selElHov) {
          const handle = hitTestResizeHandle(selElHov, wx, wy);
          if (handle) {
            canvasRef.current!.style.cursor = HANDLE_CURSORS[handle];
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
      canvasRef.current!.style.cursor = 'default';
    }
  }, [s2w, dragging, panning, visibleElements, visibleRelationships, drawingRel, dragWP, dragLabel, resizing, selType, selectedId]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (drawingRel) {
      const rect = canvasRef.current!.getBoundingClientRect();
      const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);
      const tgt = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
      if (tgt && tgt.id !== drawingRel.sourceId) {
        relPickerWaypoints.current = drawingRel.waypoints;
        setRelPicker({ sx: e.clientX - rect.left, sy: e.clientY - rect.top, srcId: drawingRel.sourceId, tgtId: tgt.id });
      }
      setDrawingRel(null); return;
    }
    setDragging(null); setPanning(null); setDragWP(null); setDragLabel(null); setResizing(null);
    setSnapGuides([]);
  }, [drawingRel, s2w, visibleElements]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x: wx, y: wy } = s2w(e.clientX - rect.left, e.clientY - rect.top);

    const el = hitTestElement(visibleElements, wx, wy, getLayer, isNote);
    if (el) {
      if (el.linkedViewId) {
        navigateToView(el.linkedViewId);
        return;
      }
      setEditingElId(el.id);
      setEditingName(el.name);
      setSelectedId(el.id);
      setSelType('element');
      return;
    }

    const rh = hitTestRelationship(visibleRelationships, visibleElements, wx, wy);
    if (rh) {
      const name = prompt('Relationship label:', rh.rel.name || '');
      if (name !== null) { pushHistory(); setRelationships(prev => prev.map(r => r.id === rh.rel.id ? { ...r, name } : r)); }
    }
  }, [s2w, visibleElements, visibleRelationships, navigateToView]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
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

      const changeTypeChildren: typeof items = [];
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

      const items: { label: string; action?: () => void; children?: typeof changeTypeChildren; separator?: boolean; icon?: string; iconColor?: string }[] = [
        { label: 'Rename', action: () => { setEditingElId(el.id); setEditingName(el.name); } },
        { label: 'Change type', children: changeTypeChildren },
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
          { label: 'Delete relationship', action: () => { pushHistory(); setRelationships(prev => prev.filter(r => r.id !== rh.rel.id)); if (selectedId === rh.rel.id) { setSelectedId(null); setSelType(null); } } },
        ],
      });
      return;
    }

    const wp = hitTestWaypoint(visibleRelationships, wx, wy);
    if (wp) {
      setCtxMenu({ x: sx, y: sy, items: [{ label: 'Remove waypoint', action: () => { pushHistory(); setRelationships(prev => prev.map(r => r.id === wp.relId ? { ...r, waypoints: r.waypoints.filter((_, i) => i !== wp.wpIdx) } : r)); } }] });
    }
  }, [s2w, visibleElements, visibleRelationships, selectedId, pushHistory]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const f = e.deltaY < 0 ? 1.08 : 0.93;
    const ns = Math.min(3, Math.max(0.2, cam.s * f));
    const wx = (sx - cam.x) / cam.s, wy = (sy - cam.y) / cam.s;
    setCam({ s: ns, x: sx - wx * ns, y: sy - wy * ns });
  }, [cam]);

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
    if (result.diagnostics.length > 0) console.warn('Export diagnostics', result.diagnostics);

    const blob = new Blob([result.content], { type: result.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = result.suggestedFileName; a.click();
    URL.revokeObjectURL(url);
  }, [elements, relationships, views, selectedFormatId]);

  const importModel = useCallback(() => {
    const acceptedExtensions = Array.from(new Set(modelFormats.flatMap(format => format.extensions.map(extension => `.${extension}`))));
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = acceptedExtensions.join(',');
    inp.onchange = (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;

      const detectedFormat = detectModelFormatByFileName(f.name);
      const formatId = ioFormatId === 'auto' ? detectedFormat?.id : ioFormatId;
      if (!formatId) {
        alert('Unsupported file format');
        return;
      }

      const r = new FileReader();
      r.onload = (ev) => {
        try {
          const content = ev.target?.result as string;
          const result = importEditorModelFromText(content, formatId);
          if (!result.model) {
            const firstError = result.diagnostics.find(diagnostic => diagnostic.severity === 'error');
            alert(firstError?.message || 'Invalid file');
            return;
          }
          if (result.diagnostics.length > 0) console.warn('Import diagnostics', result.diagnostics);

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
        } catch { alert('Invalid file'); }
      };
      r.readAsText(f);
    };
    inp.click();
  }, [ioFormatId, modelFormats, applyViewLayout]);

  // ---------------------------------------------------------------------------
  // Filesystem: Open Directory, Open File, Save
  // ---------------------------------------------------------------------------

  const loadFileEntry = useCallback(async (entry: OpenFileEntry) => {
    try {
      const content = await readFileHandle(entry.handle);
      const detectedFormat = detectModelFormatByFileName(entry.name);
      const formatId = detectedFormat?.id;
      if (!formatId) { alert(`Unsupported format: ${entry.name}`); return; }

      const result = importEditorModelFromText(content, formatId);
      if (!result.model) {
        const firstError = result.diagnostics.find(d => d.severity === 'error');
        alert(firstError?.message || 'Invalid file');
        return;
      }
      if (result.diagnostics.length > 0) console.warn('Import diagnostics', result.diagnostics);

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

      setActiveFileHandle(entry.handle);
      setActiveFormatId(formatId);
      setIsDirty(false);
    } catch (err) {
      alert(`Failed to open file: ${err}`);
    }
  }, [applyViewLayout]);

  const handleOpenDirectory = useCallback(async () => {
    if (!isFileSystemAccessSupported()) {
      alert('Your browser does not support the File System Access API. Use Chrome or Edge.');
      return;
    }
    try {
      const state = await openDirectory();
      setDirState(state);
      // Auto-open the first archimate/xml/json file
      if (state.files.length > 0) {
        await loadFileEntry(state.files[0]);
      }
    } catch (err) {
      // User cancelled the picker
      if (err instanceof DOMException && err.name === 'AbortError') return;
      alert(`Failed to open directory: ${err}`);
    }
  }, [loadFileEntry]);

  const handleSave = useCallback(async () => {
    if (!activeFileHandle || !activeFormatId) {
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
    try {
      await writeFileHandle(activeFileHandle, result.content);
      setIsDirty(false);
    } catch (err) {
      alert(`Save failed: ${err}`);
    }
  }, [activeFileHandle, activeFormatId, elements, relationships, views, exportModel]);

  // Mark dirty on model changes (skip initial render)
  const isInitialRender = useRef(true);
  useEffect(() => {
    if (isInitialRender.current) { isInitialRender.current = false; return; }
    if (activeFileHandle) setIsDirty(true);
  }, [elements, relationships, views, activeFileHandle]);

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName)) return;
        deleteSelected();
      }
      if (e.key === 'Escape') { setRelPicker(null); setCtxMenu(null); setShowSearch(false); setDrawingRel(null); cancelEditing(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowSearch(s => !s); }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName)) return;
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes((document.activeElement as HTMLElement)?.tagName)) return;
        e.preventDefault();
        redo();
      }
      // Back/forward: Alt+Left / Alt+Right
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [deleteSelected, cancelEditing, goBack, goForward, handleSave, undo, redo]);

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

  const palItems = useMemo(() => {
    const items = Object.entries(ELEMENT_TYPES).filter(([, d]) => d.layer === activeLayer && !d.isNote);
    items.push(['note', ELEMENT_TYPES.note]);
    return items;
  }, [activeLayer]);

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

  // Left panel cycling
  const cycleLeftPanel = useCallback(() => {
    setLeftPanel(p => p === 'palette' ? 'views' : p === 'views' ? 'changelog' : 'palette');
  }, []);

  const leftPanelLabel = leftPanel === 'palette' ? 'Views' : leftPanel === 'views' ? 'Changelog' : 'Palette';

  // ==================== RENDER ====================
  return (
    <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: FONT, background: 'var(--bg, #f5f6f8)', color: 'var(--text-primary, #1a1a1a)' }}>
      {/* Toolbar */}
      <div style={{ height: 44, background: 'var(--surface, rgba(255,255,255,0.96))', borderBottom: '1px solid var(--border, rgba(0,0,0,0.07))', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 6, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 24, height: 24, background: '#2a2a2a', borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: '#fff', letterSpacing: '-0.3px' }}>OA</div>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#2a2a2a', letterSpacing: '-0.01em' }}>OpenArchi</span>
          {activeFileHandle && (
            <span style={{ fontSize: 12, color: '#999', marginLeft: 2 }}>
              — {activeFileHandle.name}{isDirty ? ' *' : ''}
            </span>
          )}
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--border, rgba(0,0,0,0.07))', margin: '0 3px' }} />
        <Btn onClick={goBack} disabled={!canGoBack}>{'\u25C0'}</Btn>
        <Btn onClick={goForward} disabled={!canGoForward}>{'\u25B6'}</Btn>
        <div style={{ width: 1, height: 18, background: 'var(--border, rgba(0,0,0,0.07))', margin: '0 2px' }} />
        <Btn onClick={undo} disabled={historyIndexRef.current <= 0}>Undo</Btn>
        <Btn onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1}>Redo</Btn>
        <div style={{ width: 1, height: 18, background: 'var(--border, rgba(0,0,0,0.07))', margin: '0 2px' }} />
        <Btn onClick={cycleLeftPanel}>{leftPanelLabel}</Btn>
        <div style={{ width: 1, height: 18, background: 'var(--border, rgba(0,0,0,0.07))', margin: '0 2px' }} />
        <Btn onClick={handleOpenDirectory}>Open Dir</Btn>
        {dirState && dirState.files.length > 1 && (
          <select
            value={activeFileHandle?.name || ''}
            onChange={e => {
              const entry = dirState.files.find(f => f.name === e.target.value);
              if (entry) loadFileEntry(entry);
            }}
            style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.08)', background: '#fff', fontFamily: 'inherit', fontSize: 12, color: '#555' }}
            title="Files in directory"
          >
            {dirState.files.map(f => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
        )}
        {activeFileHandle && (
          <Btn onClick={handleSave}>
            {isDirty ? 'Save *' : 'Save'}
          </Btn>
        )}
        <Btn onClick={importModel}>Import</Btn>
        <Btn onClick={exportModel}>Export</Btn>
        <select
          value={ioFormatId}
          onChange={e => setIoFormatId(e.target.value)}
          style={{
            padding: '4px 8px',
            borderRadius: 5,
            border: '1px solid rgba(0,0,0,0.08)',
            background: '#fff',
            fontFamily: 'inherit',
            fontSize: 12,
            color: '#555',
          }}
          title="Model format for import/export"
        >
          <option value="auto">Format: Auto / JSON</option>
          {modelFormats.map(format => (
            <option key={format.id} value={format.id}>{format.label}</option>
          ))}
        </select>
        <Btn onClick={deleteSelected} disabled={!selectedId}>Delete</Btn>
        <div style={{ width: 1, height: 18, background: 'var(--border, rgba(0,0,0,0.07))', margin: '0 2px' }} />
        <Btn onClick={() => setGridType(g => g === 'dot' ? 'line' : 'dot')}>{gridType === 'dot' ? 'Dots' : 'Grid'}</Btn>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowSearch(s => !s)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: 'rgba(0,0,0,0.03)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: '#888' }}>
          Search <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(0,0,0,0.08)', fontWeight: 500 }}>{'\u2318'}K</span>
        </button>
        <span style={{ fontSize: 11, color: '#bbb', marginLeft: 6 }}>{visibleElements.length} el {'\u00B7'} {visibleRelationships.length} rel</span>
      </div>

      {/* Main area — canvas fills everything, panels float as islands */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {/* Left panel island */}
        <div style={{
          position: 'absolute', left: 8, top: 8, bottom: 8, width: 244, zIndex: 10,
          background: 'var(--surface, rgba(255,255,255,0.96))',
          borderRadius: 12, border: '1px solid var(--border, rgba(0,0,0,0.07))',
          boxShadow: 'var(--shadow-md, 0 4px 20px rgba(0,0,0,0.06))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {leftPanel === 'palette' ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '14px 14px 7px', fontSize: 11, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Layers</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 10px 10px' }}>
                {Object.entries(LAYERS).map(([k, L]) => {
                  const isA = activeLayer === k;
                  return (
                    <button key={k} onClick={() => setActiveLayer(k)}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        background: isA ? (L.fill === 'transparent' ? 'rgba(0,0,0,0.04)' : L.fill) : 'transparent',
                        borderLeft: isA ? `3px solid ${L.accent}` : '3px solid transparent' }}
                      onMouseEnter={e => { if (!isA) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
                      onMouseLeave={e => { if (!isA) e.currentTarget.style.background = isA ? (L.fill === 'transparent' ? 'rgba(0,0,0,0.04)' : L.fill) : 'transparent'; }}>
                      <div style={{ width: 14, height: 14, borderRadius: 3, background: L.fill === 'transparent' ? 'rgba(0,0,0,0.06)' : L.fill, border: `1.5px solid ${L.stroke}`, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: isA ? 500 : 400, color: isA ? L.text : '#666' }}>{L.label}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', margin: '2px 14px' }} />
              <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Elements</div>
              <div style={{ flex: 1, overflow: 'auto', padding: '0 8px 10px' }}>
                {palItems.map(([k, d]) => {
                  const isNoteItem = d.isNote;
                  const L = isNoteItem ? { fill: '#F2F2F4', stroke: '#C0C0C4', accent: '#909098' } : LAYERS[d.layer];
                  return (
                    <button key={k} onClick={() => addElement(k)}
                      title={d.desc || d.label}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '6px 10px', borderRadius: 6, fontSize: 13, fontWeight: 400, background: 'transparent', color: '#606060', border: 'none', cursor: 'pointer', fontFamily: 'inherit', ...(isNoteItem ? { marginTop: 6, borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: 10 } : {}) }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <CanvasIcon type={k} size={20} color={L?.accent || '#888'} />
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : leftPanel === 'views' ? (
            <ViewNav views={views} currentViewId={currentViewId} onNavigate={navigateToView} />
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '14px 14px 7px', fontSize: 11, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Changelog</div>
              <div style={{ padding: '10px 14px', color: '#aaa', fontSize: 13, lineHeight: 1.7 }}>
                <p style={{ margin: '0 0 10px', color: '#777', fontWeight: 400 }}>Change history will appear here.</p>
                <p style={{ margin: 0, fontSize: 12 }}>
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

        {/* Tab bar island */}
        <div style={{
          position: 'absolute', top: 8, left: 262, right: propSide === 'right' ? 274 : 8, zIndex: 10,
          height: 32,
          background: 'var(--surface, rgba(255,255,255,0.96))',
          borderRadius: 8, border: '1px solid var(--border, rgba(0,0,0,0.07))',
          boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04))',
          display: 'flex', alignItems: 'center', padding: '0 4px', gap: 1, overflow: 'auto',
        }}>
            {openTabIds.map(tid => {
              const v = views.find(vv => vv.id === tid);
              const isActive = tid === currentViewId;
              return (
                <div
                  key={tid}
                  onClick={() => navigateToView(tid)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', fontSize: 12, fontFamily: 'inherit',
                    cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    background: isActive ? 'var(--accent-bg, #eef2ff)' : 'transparent',
                    color: isActive ? 'var(--accent-text, #1d4ed8)' : '#999',
                    fontWeight: isActive ? 500 : 400,
                    borderRadius: 5,
                    border: 'none',
                  }}
                >
                  <span>{v?.name || tid}</span>
                  {openTabIds.length > 1 && (
                    <span
                      onClick={e => { e.stopPropagation(); closeTab(tid); }}
                      style={{ fontSize: 13, color: '#ccc', lineHeight: 1, padding: '0 2px', borderRadius: 3, cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.background = 'transparent'; }}
                    >
                      {'\u00D7'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

        {/* Canvas — fills entire main area */}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
            <canvas
              ref={canvasRef}
              style={{ cursor: resizing ? HANDLE_CURSORS[resizing.handle] : drawingRel ? 'crosshair' : dragging ? 'grabbing' : panning ? 'grabbing' : dragLabel ? 'ew-resize' : undefined }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDblClick}
              onContextMenu={handleContextMenu}
              onMouseLeave={() => { setDragging(null); setPanning(null); setDragWP(null); setDragLabel(null); setResizing(null); setHovElId(null); setHovRelId(null); setSnapGuides([]); }}
              onWheel={handleWheel}
            />

            {/* Inline element name editor — textarea for notes, input for others */}
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
                      border: '2px solid #2563eb',
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
                      border: '2px solid #2563eb',
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
              <div style={{ position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)', fontSize: 12, color: '#666', background: '#fff', padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.07)', boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.04))', whiteSpace: 'nowrap' }}>
                Hold <strong>Shift + Click</strong> to add a waypoint bend
              </div>
            )}

            {/* Legend island (bottom-right) */}
            <div style={{ position: 'absolute', bottom: 8, right: propSide === 'right' ? 274 : 8, zIndex: 50 }}>
              <button
                onClick={() => setShowLegend(l => !l)}
                style={{
                  padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border, rgba(0,0,0,0.07))',
                  background: 'var(--surface, rgba(255,255,255,0.96))', fontSize: 11, color: '#999', cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 500,
                }}
              >
                {showLegend ? 'Hide Legend' : 'Legend'}
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

                return (
                  <div style={{
                    position: 'absolute', bottom: 28, right: 0,
                    background: '#fff', border: '1px solid var(--border, rgba(0,0,0,0.07))', borderRadius: 8,
                    boxShadow: 'var(--shadow-md, 0 4px 20px rgba(0,0,0,0.06))', padding: '8px 12px',
                    width: 210, fontSize: 11, fontFamily: FONT, maxHeight: 340, overflow: 'auto',
                  }}>
                    {activeElTypes.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.4px' }}>Elements</div>
                        {activeElTypes.map(([k, def]) => {
                          const L = LAYERS[def.layer];
                          return (
                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <CanvasIcon type={k} size={14} color={L?.accent || '#888'} />
                              <span style={{ color: '#555', fontSize: 11 }}>{def.label}</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                    {activeElTypes.length > 0 && activeRelTypes.length > 0 && (
                      <div style={{ height: 1, background: 'rgba(0,0,0,0.05)', margin: '6px 0' }} />
                    )}
                    {activeRelTypes.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.4px' }}>Relationships</div>
                        {activeRelTypes.map(([, rd]) => (
                          <div key={rd.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                            <span style={{ width: 20, color: '#999', fontSize: 10, textAlign: 'center', flexShrink: 0, fontFamily: 'monospace' }}>
                              {rd.dash ? '\u2504\u25B8' : '\u2500\u25B8'}
                            </span>
                            <span style={{ color: '#555' }}>{rd.label}</span>
                            <span style={{ marginLeft: 'auto', color: '#bbb', fontSize: 10 }}>{rd.desc}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {activeElTypes.length === 0 && activeRelTypes.length === 0 && (
                      <div style={{ color: '#bbb', fontSize: 11, padding: '4px 0' }}>No elements or relationships yet.</div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div style={{ position: 'absolute', bottom: 8, left: 262, fontSize: 11, color: '#aaa', background: 'var(--surface, rgba(255,255,255,0.96))', padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border, rgba(0,0,0,0.07))', fontWeight: 500 }}>
              {Math.round(cam.s * 100)}%
            </div>
          </div>

        {/* Property panel on right side — island */}
        {propSide === 'right' && (
          <div style={{
            position: 'absolute', right: 8, top: 8, bottom: 8, width: 252, zIndex: 10,
            background: 'var(--surface, rgba(255,255,255,0.96))',
            borderRadius: 12, border: '1px solid var(--border, rgba(0,0,0,0.07))',
            boxShadow: 'var(--shadow-md, 0 4px 20px rgba(0,0,0,0.06))',
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
