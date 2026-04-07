// ============================================================
// ArchiMate element, relationship, and view types
// ============================================================

export interface Point {
  x: number;
  y: number;
}

export interface Anchor extends Point {
  side: string;
}

export interface LayerDef {
  label: string;
  fill: string;
  stroke: string;
  accent: string;
  text: string;
}

export interface ElementTypeDef {
  label: string;
  layer: string;
  shape: 'rect' | 'round';
  isNote?: boolean;
  desc?: string;
}

export interface RelationshipTypeDef {
  label: string;
  dash: boolean;
  /** Dash pattern array for canvas setLineDash(). Only used when dash=true. */
  dashPattern?: number[];
  head: 'diamond_filled' | 'diamond' | 'filled_dot' | 'hollow_arrow' | 'open_arrow' | 'filled_arrow' | 'none';
  desc: string;
}

export interface ElementStyle {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
}

export interface ModelElement {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  documentation: string;
  linkedViewId?: string;
  zIndex?: number;
  style?: ElementStyle;
}

export interface Waypoint {
  x: number;
  y: number;
}

/** Archi-style relative bendpoint: offsets from source/target centers */
export interface RelativeBendpoint {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ModelRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name: string;
  waypoints: Waypoint[];
  labelPos: number;
  /** Manual anchor point on source element boundary (absolute coords, snapped to edge on render) */
  sourceAnchor?: Point;
  /** Manual anchor point on target element boundary (absolute coords, snapped to edge on render) */
  targetAnchor?: Point;
  /** Archi-style relative bendpoints — resolved dynamically from source/target centers */
  relativeBendpoints?: RelativeBendpoint[];
}

export interface ModelView {
  id: string;
  name: string;
  elementIds: string[];
  childViewIds: string[];
}

export interface DiagramNodeRecord {
  id: string;
  viewId: string;
  elementId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  linkedViewId?: string;
  zIndex?: number;
  style?: ElementStyle;
  parentNodeId?: string;
  nestingDepth?: number;
}

export interface DiagramConnectionRecord {
  id: string;
  viewId: string;
  relationshipId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  waypoints: Waypoint[];
  labelPos: number;
  relativeBendpoints?: RelativeBendpoint[];
}

export interface OpenArchiModel {
  version: string;
  elements: ModelElement[];
  relationships: ModelRelationship[];
  views: ModelView[];
  diagramNodes?: DiagramNodeRecord[];
  diagramConnections?: DiagramConnectionRecord[];
}

// ============================================================
// Canvas interaction state
// ============================================================

export interface Camera {
  x: number;
  y: number;
  s: number;
}

export interface DragState {
  id: string;
  ox: number;
  oy: number;
}

export interface PanState {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
}

export interface DrawingRelState {
  sourceId: string;
  sourceNodeId?: string;
  mx: number;
  my: number;
  waypoints: Point[];
}

export interface DragWPState {
  relId: string;
  wpIdx: number;
  startX: number;
  startY: number;
}

export interface DragEndpointState {
  relId: string;
  endpoint: 'source' | 'target';
}

export interface DragSegmentState {
  relId: string;
  segIdx: number;        // index of the segment being dragged (0 = start→wp0, etc.)
  orientation: 'h' | 'v'; // whether dragging moves the segment vertically or horizontally
  startWx: number;
  startWy: number;
}

export interface DragLabelState {
  relId: string;
}

export interface RelPickerState {
  sx: number;
  sy: number;
  srcId: string;
  tgtId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
}

export interface CtxMenuItem {
  label: string;
  action?: () => void;
  icon?: string;
  iconColor?: string;
  color?: string;
  children?: CtxMenuItem[];
  separator?: boolean;
}

export interface CtxMenuState {
  x: number;
  y: number;
  items: CtxMenuItem[];
}

export interface RelHit {
  rel: ModelRelationship;
  segIdx: number;
}

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface ResizeState {
  id: string;
  handle: ResizeHandle;
  startWx: number;
  startWy: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

export type GridType = 'dot' | 'line';
export type LeftPanel = 'palette' | 'views' | 'changelog';
export type SelectionType = 'element' | 'relationship' | null;
