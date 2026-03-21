import type { Waypoint } from '../types';

/** Optional visual style metadata preserved from source diagram */
export interface DiagramStyle {
  fillColor?: string;
  lineColor?: string;
  fontColor?: string;
  font?: string;
  textAlignment?: number;
  textPosition?: number;
  lineWidth?: number;
  lineStyle?: string;
  gradient?: number;
  alpha?: number;
  lineAlpha?: number;
  nameVisible?: boolean;
  labelExpression?: string;
}

export interface CanonicalElement {
  id: string;
  type: string;
  name: string;
  documentation: string;
}

export interface CanonicalRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name: string;
}

export interface CanonicalView {
  id: string;
  name: string;
  childViewIds: string[];
}

export interface CanonicalViewNode {
  id: string;
  viewId: string;
  elementId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  linkedViewId?: string;
  /** Source diagram style metadata (preserved for fidelity, optional) */
  style?: DiagramStyle;
}

export interface CanonicalViewConnection {
  id: string;
  viewId: string;
  relationshipId: string;
  waypoints: Waypoint[];
  labelPosition: number;
  /** Source diagram style metadata (preserved for fidelity, optional) */
  style?: DiagramStyle;
}

export interface CanonicalModelDocument {
  version: string;
  elements: CanonicalElement[];
  relationships: CanonicalRelationship[];
  views: CanonicalView[];
  viewNodes: CanonicalViewNode[];
  viewConnections: CanonicalViewConnection[];
  metadata?: {
    sourceFormat?: string;
  };
}

