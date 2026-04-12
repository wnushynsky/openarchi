import type { Waypoint } from '../types';

export interface CoArchiFolderEntry {
  path: string;
  name?: string;
  id?: string;
  type?: string;
  explicit?: boolean;
}

export interface CoArchiMetadata {
  rootFilePath?: string;
  modelName?: string;
  modelId?: string;
  modelVersion?: string;
  modelPurpose?: string;
  folders?: CoArchiFolderEntry[];
}

export interface CanonicalProperty {
  key: string;
  value: string;
}

export interface CanonicalAiMetadata {
  primaryPrompt?: string;
  agentNotes?: string[];
  generatedBy?: string;
}

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
  summary?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
  sourcePath?: string;
}

export interface CanonicalRelationship {
  id: string;
  type: string;
  sourceId: string;
  targetId: string;
  name: string;
  documentation?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
  sourcePath?: string;
}

export interface CanonicalView {
  id: string;
  name: string;
  childViewIds: string[];
  documentation?: string;
  purpose?: string;
  viewpoint?: string;
  tags?: string[];
  properties?: CanonicalProperty[];
  sourcePath?: string;
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
  /** ID of the parent viewNode in the diagram hierarchy (undefined for top-level nodes) */
  parentNodeId?: string;
  /** Nesting depth: 0 = top-level, 1 = child of a top-level node, etc. */
  nestingDepth?: number;
}

export interface CanonicalViewConnection {
  id: string;
  viewId: string;
  relationshipId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  waypoints: Waypoint[];
  labelPosition: number;
  /** Source diagram style metadata (preserved for fidelity, optional) */
  style?: DiagramStyle;
  /** Raw relative bendpoints from source format (startX/Y offsets from source center, endX/Y from target center) */
  relativeBendpoints?: { startX: number; startY: number; endX: number; endY: number }[];
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
    coArchi?: CoArchiMetadata;
    ai?: CanonicalAiMetadata;
  };
}
