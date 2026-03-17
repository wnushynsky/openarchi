import type { Waypoint } from '../types';

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
}

export interface CanonicalViewConnection {
  id: string;
  viewId: string;
  relationshipId: string;
  waypoints: Waypoint[];
  labelPosition: number;
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

