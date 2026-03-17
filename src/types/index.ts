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
  head: 'diamond_filled' | 'diamond' | 'filled_dot' | 'hollow_arrow' | 'open_arrow' | 'filled_arrow' | 'none';
  desc: string;
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
}

export interface Waypoint {
  x: number;
  y: number;
}

export interface ModelRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name: string;
  waypoints: Waypoint[];
  labelPos: number;
}

export interface ModelView {
  id: string;
  name: string;
  elementIds: string[];
  childViewIds: string[];
}

export interface OpenArchiModel {
  version: string;
  elements: ModelElement[];
  relationships: ModelRelationship[];
  views: ModelView[];
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

export interface DragLabelState {
  relId: string;
}

export interface RelPickerState {
  sx: number;
  sy: number;
  srcId: string;
  tgtId: string;
}

export interface CtxMenuItem {
  label: string;
  action?: () => void;
  icon?: string;
  iconColor?: string;
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
