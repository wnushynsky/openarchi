import type {
  ModelElement,
  ModelRelationship,
  ModelView,
  OpenArchiModel,
  DiagramNodeRecord,
  DiagramConnectionRecord,
  RelativeBendpoint,
} from '../../types';
import { editorToCanonicalModel, canonicalToEditorModel } from '../../model/mapper';
import type { ModelDiagnostic } from '../../model/diagnostics';
import type { ModelFormatAdapter, ParseResult, SerializeResult } from '../adapter';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseElements(raw: unknown[], diagnostics: ModelDiagnostic[]): ModelElement[] {
  const elements: ModelElement[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_ELEMENT_INVALID',
        message: `Skipping element at index ${index} because it is not an object.`,
        path: `elements[${index}]`,
      });
      continue;
    }

    if (!isString(item.id) || !isString(item.type)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_ELEMENT_MISSING_KEYS',
        message: `Skipping element at index ${index} because id/type is missing.`,
        path: `elements[${index}]`,
      });
      continue;
    }

    elements.push({
      id: item.id,
      type: item.type,
      name: isString(item.name) ? item.name : item.type,
      x: isNumber(item.x) ? item.x : 0,
      y: isNumber(item.y) ? item.y : 0,
      w: isNumber(item.w) ? item.w : 160,
      h: isNumber(item.h) ? item.h : 72,
      documentation: isString(item.documentation) ? item.documentation : '',
      linkedViewId: isString(item.linkedViewId) ? item.linkedViewId : undefined,
    });
  }

  return elements;
}

function parseRelationships(raw: unknown[], diagnostics: ModelDiagnostic[]): ModelRelationship[] {
  const relationships: ModelRelationship[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_REL_INVALID',
        message: `Skipping relationship at index ${index} because it is not an object.`,
        path: `relationships[${index}]`,
      });
      continue;
    }

    if (!isString(item.id) || !isString(item.type) || !isString(item.sourceId) || !isString(item.targetId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_REL_MISSING_KEYS',
        message: `Skipping relationship at index ${index} because id/type/sourceId/targetId is missing.`,
        path: `relationships[${index}]`,
      });
      continue;
    }

    const waypoints = Array.isArray(item.waypoints)
      ? item.waypoints
          .filter((waypoint): waypoint is JsonRecord => isRecord(waypoint))
          .map(waypoint => ({
            x: isNumber(waypoint.x) ? waypoint.x : 0,
            y: isNumber(waypoint.y) ? waypoint.y : 0,
          }))
      : [];

    relationships.push({
      id: item.id,
      type: item.type,
      sourceId: item.sourceId,
      targetId: item.targetId,
      name: isString(item.name) ? item.name : '',
      waypoints,
      labelPos: isNumber(item.labelPos) ? item.labelPos : 0.5,
    });
  }

  return relationships;
}

function parseViews(raw: unknown[], diagnostics: ModelDiagnostic[]): ModelView[] {
  const views: ModelView[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_VIEW_INVALID',
        message: `Skipping view at index ${index} because it is not an object.`,
        path: `views[${index}]`,
      });
      continue;
    }

    if (!isString(item.id) || !isString(item.name)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_VIEW_MISSING_KEYS',
        message: `Skipping view at index ${index} because id/name is missing.`,
        path: `views[${index}]`,
      });
      continue;
    }

    views.push({
      id: item.id,
      name: item.name,
      elementIds: Array.isArray(item.elementIds)
        ? item.elementIds.filter((elementId): elementId is string => isString(elementId))
        : [],
      childViewIds: Array.isArray(item.childViewIds)
        ? item.childViewIds.filter((viewId): viewId is string => isString(viewId))
        : [],
    });
  }

  return views;
}

function parseRelativeBendpoints(raw: unknown): RelativeBendpoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const bendpoints = raw
    .filter((bendpoint): bendpoint is JsonRecord => isRecord(bendpoint))
    .map(bendpoint => ({
      startX: isNumber(bendpoint.startX) ? bendpoint.startX : 0,
      startY: isNumber(bendpoint.startY) ? bendpoint.startY : 0,
      endX: isNumber(bendpoint.endX) ? bendpoint.endX : 0,
      endY: isNumber(bendpoint.endY) ? bendpoint.endY : 0,
    }));
  return bendpoints.length > 0 ? bendpoints : undefined;
}

function parseDiagramNodes(raw: unknown[], diagnostics: ModelDiagnostic[]): DiagramNodeRecord[] {
  const nodes: DiagramNodeRecord[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_DIAGRAM_NODE_INVALID',
        message: `Skipping diagram node at index ${index} because it is not an object.`,
        path: `diagramNodes[${index}]`,
      });
      continue;
    }

    if (!isString(item.id) || !isString(item.viewId) || !isString(item.elementId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_DIAGRAM_NODE_MISSING_KEYS',
        message: `Skipping diagram node at index ${index} because id/viewId/elementId is missing.`,
        path: `diagramNodes[${index}]`,
      });
      continue;
    }

    nodes.push({
      id: item.id,
      viewId: item.viewId,
      elementId: item.elementId,
      x: isNumber(item.x) ? item.x : 0,
      y: isNumber(item.y) ? item.y : 0,
      w: isNumber(item.w) ? item.w : 160,
      h: isNumber(item.h) ? item.h : 72,
      linkedViewId: isString(item.linkedViewId) ? item.linkedViewId : undefined,
      zIndex: isNumber(item.zIndex) ? item.zIndex : undefined,
      style: isRecord(item.style) ? {
        fillColor: isString(item.style.fillColor) ? item.style.fillColor : undefined,
        lineColor: isString(item.style.lineColor) ? item.style.lineColor : undefined,
        fontColor: isString(item.style.fontColor) ? item.style.fontColor : undefined,
      } : undefined,
      parentNodeId: isString(item.parentNodeId) ? item.parentNodeId : undefined,
      nestingDepth: isNumber(item.nestingDepth) ? item.nestingDepth : undefined,
    });
  }

  return nodes;
}

function parseDiagramConnections(raw: unknown[], diagnostics: ModelDiagnostic[]): DiagramConnectionRecord[] {
  const connections: DiagramConnectionRecord[] = [];

  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_DIAGRAM_CONNECTION_INVALID',
        message: `Skipping diagram connection at index ${index} because it is not an object.`,
        path: `diagramConnections[${index}]`,
      });
      continue;
    }

    if (!isString(item.id) || !isString(item.viewId) || !isString(item.relationshipId)) {
      diagnostics.push({
        severity: 'warning',
        code: 'OPENARCHI_DIAGRAM_CONNECTION_MISSING_KEYS',
        message: `Skipping diagram connection at index ${index} because id/viewId/relationshipId is missing.`,
        path: `diagramConnections[${index}]`,
      });
      continue;
    }

    const waypoints = Array.isArray(item.waypoints)
      ? item.waypoints
          .filter((waypoint): waypoint is JsonRecord => isRecord(waypoint))
          .map(waypoint => ({
            x: isNumber(waypoint.x) ? waypoint.x : 0,
            y: isNumber(waypoint.y) ? waypoint.y : 0,
          }))
      : [];

    connections.push({
      id: item.id,
      viewId: item.viewId,
      relationshipId: item.relationshipId,
      sourceNodeId: isString(item.sourceNodeId) ? item.sourceNodeId : undefined,
      targetNodeId: isString(item.targetNodeId) ? item.targetNodeId : undefined,
      waypoints,
      labelPos: isNumber(item.labelPos) ? item.labelPos : 0.5,
      relativeBendpoints: parseRelativeBendpoints(item.relativeBendpoints),
    });
  }

  return connections;
}

function parseOpenArchiJson(raw: string): ParseResult {
  const diagnostics: ModelDiagnostic[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'OPENARCHI_JSON_PARSE_FAILED',
          message: 'File is not valid JSON.',
        },
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'OPENARCHI_JSON_INVALID_ROOT',
          message: 'JSON root must be an object.',
        },
      ],
    };
  }

  if (!Array.isArray(parsed.elements) || !Array.isArray(parsed.relationships) || !Array.isArray(parsed.views)) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'OPENARCHI_JSON_MISSING_COLLECTIONS',
          message: 'Expected top-level arrays: elements, relationships, views.',
        },
      ],
    };
  }

  const model: OpenArchiModel = {
    version: isString(parsed.version) ? parsed.version : 'openarchi-0.1',
    elements: parseElements(parsed.elements, diagnostics),
    relationships: parseRelationships(parsed.relationships, diagnostics),
    views: parseViews(parsed.views, diagnostics),
    diagramNodes: Array.isArray(parsed.diagramNodes) ? parseDiagramNodes(parsed.diagramNodes, diagnostics) : undefined,
    diagramConnections: Array.isArray(parsed.diagramConnections) ? parseDiagramConnections(parsed.diagramConnections, diagnostics) : undefined,
  };

  return {
    model: editorToCanonicalModel(model),
    diagnostics,
  };
}

function serializeOpenArchiJson(model: OpenArchiModel): SerializeResult {
  return {
    content: JSON.stringify(model, null, 2),
    diagnostics: [],
    mimeType: 'application/json',
    suggestedFileName: 'model.openarchi.json',
  };
}

export const openArchiJsonAdapter: ModelFormatAdapter = {
  id: 'openarchi-json',
  label: 'OpenArchi JSON',
  extensions: ['json'],
  mimeTypes: ['application/json', 'text/json'],
  parse: parseOpenArchiJson,
  serialize: model => serializeOpenArchiJson(canonicalToEditorModel(model)),
};
