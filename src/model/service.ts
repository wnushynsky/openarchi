import type { OpenArchiModel } from '../types';
import { AdapterRegistry } from '../io/adapter';
import type { ModelFormatAdapter, FragmentedSerializeResult } from '../io/adapter';
import { openArchiJsonAdapter } from '../io/adapters/openarchi-json';
import { coArchiXmlAdapter, parseCoArchiFragmentsStreaming, serializeCoArchiFragmented } from '../io/adapters/coarchi-xml';
import type { ProgressCallback } from '../io/adapters/coarchi-xml';
import { archiMateExchangeXmlAdapter } from '../io/adapters/archimate-exchange-xml';
import { canonicalToEditorModel, canonicalToEditorModelWithLayouts, editorToCanonicalModel } from './mapper';
import type {
  ElementLayoutsByView,
  RelationshipLayoutsByView,
  ElementViewLayout,
  RelationshipViewLayout,
} from './mapper';
import { hasDiagnosticErrors, type ModelDiagnostic } from './diagnostics';
import type { CanonicalModelDocument } from './canonical';
import type { OpenFileEntry } from '../io/filesystem';

const registry = new AdapterRegistry([
  openArchiJsonAdapter,
  coArchiXmlAdapter,
  archiMateExchangeXmlAdapter,
]);

export interface ModelImportResult {
  model?: OpenArchiModel;
  document?: CanonicalModelDocument;
  diagnostics: ModelDiagnostic[];
  /** Pre-computed layouts (avoids redundant pass over viewNodes after import) */
  elementLayouts?: ElementLayoutsByView;
  relationshipLayouts?: RelationshipLayoutsByView;
}

export interface ModelExportResult {
  content: string;
  mimeType: string;
  suggestedFileName: string;
  diagnostics: ModelDiagnostic[];
}

function mergeEditorModelIntoCanonical(
  model: OpenArchiModel,
  baseDocument?: CanonicalModelDocument,
): CanonicalModelDocument {
  const canonical = editorToCanonicalModel(model);
  if (!baseDocument) return canonical;

  const elementById = new Map(baseDocument.elements.map(element => [element.id, element]));
  const relationshipById = new Map(baseDocument.relationships.map(relationship => [relationship.id, relationship]));
  const viewById = new Map(baseDocument.views.map(view => [view.id, view]));

  canonical.elements = canonical.elements.map(element => ({
    ...element,
    sourcePath: elementById.get(element.id)?.sourcePath,
  }));

  canonical.relationships = canonical.relationships.map(relationship => ({
    ...relationship,
    sourcePath: relationshipById.get(relationship.id)?.sourcePath,
  }));

  canonical.views = canonical.views.map(view => ({
    ...view,
    sourcePath: viewById.get(view.id)?.sourcePath,
  }));

  canonical.metadata = {
    ...(baseDocument.metadata || {}),
    ...(canonical.metadata || {}),
    sourceFormat: baseDocument.metadata?.sourceFormat || canonical.metadata?.sourceFormat,
    coArchi: baseDocument.metadata?.coArchi,
  };

  return canonical;
}

function collectDeletedFragmentPaths(
  previous: { id: string; sourcePath?: string }[],
  nextIds: Set<string>,
): string[] {
  return previous
    .filter(entry => !!entry.sourcePath && !nextIds.has(entry.id))
    .map(entry => entry.sourcePath!)
    .sort((a, b) => a.localeCompare(b));
}

function fallbackElementLayout(
  model: OpenArchiModel,
  viewId: string,
  elementId: string,
): ElementViewLayout | undefined {
  const view = model.views.find(candidate => candidate.id === viewId);
  if (!view?.elementIds.includes(elementId)) return undefined;
  const element = model.elements.find(candidate => candidate.id === elementId);
  if (!element) return undefined;
  return {
    x: element.x,
    y: element.y,
    w: element.w,
    h: element.h,
    linkedViewId: element.linkedViewId,
    zIndex: element.zIndex,
    style: element.style,
  };
}

function fallbackRelationshipLayout(
  model: OpenArchiModel,
  viewId: string,
  relationshipId: string,
): RelationshipViewLayout | undefined {
  const view = model.views.find(candidate => candidate.id === viewId);
  const relationship = model.relationships.find(candidate => candidate.id === relationshipId);
  if (!view || !relationship) return undefined;
  const memberIds = new Set(view.elementIds || []);
  if (!memberIds.has(relationship.sourceId) || !memberIds.has(relationship.targetId)) return undefined;
  return {
    waypoints: relationship.waypoints || [],
    labelPos: relationship.labelPos ?? 0.5,
    relativeBendpoints: relationship.relativeBendpoints,
  };
}

function applyLayoutsToCanonical(
  canonical: CanonicalModelDocument,
  model: OpenArchiModel,
  elementLayouts?: ElementLayoutsByView,
  relationshipLayouts?: RelationshipLayoutsByView,
  baseDocument?: CanonicalModelDocument,
): CanonicalModelDocument {
  if (!baseDocument) return canonical;

  const elementById = new Map(canonical.elements.map(element => [element.id, element]));
  const relationshipById = new Map(canonical.relationships.map(relationship => [relationship.id, relationship]));
  const baseViewNodesByViewId = new Map<string, typeof baseDocument.viewNodes>();
  const baseViewConnectionsByViewId = new Map<string, typeof baseDocument.viewConnections>();

  for (const node of baseDocument.viewNodes) {
    if (!baseViewNodesByViewId.has(node.viewId)) baseViewNodesByViewId.set(node.viewId, []);
    baseViewNodesByViewId.get(node.viewId)!.push(node);
  }

  for (const connection of baseDocument.viewConnections) {
    if (!baseViewConnectionsByViewId.has(connection.viewId)) baseViewConnectionsByViewId.set(connection.viewId, []);
    baseViewConnectionsByViewId.get(connection.viewId)!.push(connection);
  }

  const nextViewNodes: CanonicalModelDocument['viewNodes'] = [];
  const nextViewConnections: CanonicalModelDocument['viewConnections'] = [];

  for (const view of canonical.views) {
    const memberIds = new Set(model.views.find(candidate => candidate.id === view.id)?.elementIds || []);
    const relMemberIds = new Set<string>();
    for (const relationship of canonical.relationships) {
      if (memberIds.has(relationship.sourceId) && memberIds.has(relationship.targetId)) {
        relMemberIds.add(relationship.id);
      }
    }

    const baseNodes = baseViewNodesByViewId.get(view.id) || [];
    const baseConnections = baseViewConnectionsByViewId.get(view.id) || [];
    const representedElementIds = new Set<string>();
    const representedRelationshipIds = new Set<string>();

    for (const baseNode of baseNodes) {
      if (!memberIds.has(baseNode.elementId) || !elementById.has(baseNode.elementId)) continue;
      const layout = elementLayouts?.[view.id]?.[baseNode.elementId]
        || fallbackElementLayout(model, view.id, baseNode.elementId);
      nextViewNodes.push({
        ...baseNode,
        x: layout?.x ?? baseNode.x,
        y: layout?.y ?? baseNode.y,
        width: layout?.w ?? baseNode.width,
        height: layout?.h ?? baseNode.height,
        linkedViewId: layout?.linkedViewId ?? baseNode.linkedViewId,
        style: layout?.style
          ? {
            ...baseNode.style,
            fillColor: layout.style.fillColor ?? baseNode.style?.fillColor,
            lineColor: layout.style.lineColor ?? baseNode.style?.lineColor,
            fontColor: layout.style.fontColor ?? baseNode.style?.fontColor,
          }
          : baseNode.style,
      });
      representedElementIds.add(baseNode.elementId);
    }

    for (const elementId of memberIds) {
      if (representedElementIds.has(elementId) || !elementById.has(elementId)) continue;
      const layout = elementLayouts?.[view.id]?.[elementId] || fallbackElementLayout(model, view.id, elementId);
      if (!layout) continue;
      nextViewNodes.push({
        id: `${view.id}::${elementId}`,
        viewId: view.id,
        elementId,
        x: layout.x,
        y: layout.y,
        width: layout.w,
        height: layout.h,
        linkedViewId: layout.linkedViewId,
        nestingDepth: layout.zIndex ?? 0,
        style: layout.style ? {
          fillColor: layout.style.fillColor,
          lineColor: layout.style.lineColor,
          fontColor: layout.style.fontColor,
        } : undefined,
      });
    }

    for (const baseConnection of baseConnections) {
      if (!relMemberIds.has(baseConnection.relationshipId) || !relationshipById.has(baseConnection.relationshipId)) continue;
      const layout = relationshipLayouts?.[view.id]?.[baseConnection.relationshipId]
        || fallbackRelationshipLayout(model, view.id, baseConnection.relationshipId);
      nextViewConnections.push({
        ...baseConnection,
        waypoints: layout?.waypoints ?? baseConnection.waypoints,
        labelPosition: layout?.labelPos ?? baseConnection.labelPosition,
        relativeBendpoints: layout?.relativeBendpoints ?? baseConnection.relativeBendpoints,
      });
      representedRelationshipIds.add(baseConnection.relationshipId);
    }

    for (const relationshipId of relMemberIds) {
      if (representedRelationshipIds.has(relationshipId) || !relationshipById.has(relationshipId)) continue;
      const layout = relationshipLayouts?.[view.id]?.[relationshipId]
        || fallbackRelationshipLayout(model, view.id, relationshipId);
      nextViewConnections.push({
        id: `${view.id}::${relationshipId}`,
        viewId: view.id,
        relationshipId,
        waypoints: layout?.waypoints || [],
        labelPosition: layout?.labelPos ?? 0.5,
        relativeBendpoints: layout?.relativeBendpoints,
      });
    }
  }

  canonical.viewNodes = nextViewNodes;
  canonical.viewConnections = nextViewConnections;
  return canonical;
}

export function listModelFormats(): ModelFormatAdapter[] {
  return registry.list();
}

export function detectModelFormatByFileName(fileName: string): ModelFormatAdapter | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.openarchi.json') || lower.endsWith('.json')) return registry.getById('openarchi-json');
  if (lower.endsWith('.coarchi.xml') || lower.endsWith('.coarchi')) return registry.getById('coarchi-xml');
  if (lower.endsWith('.archimate.xml') || lower.endsWith('.archimate')) return registry.getById('coarchi-xml');
  return registry.detectByFileName(fileName);
}

export function importEditorModelFromText(raw: string, formatId: string): ModelImportResult {
  const adapter = registry.getById(formatId);
  if (!adapter) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'FORMAT_NOT_SUPPORTED',
          message: `Format '${formatId}' is not supported.`,
        },
      ],
    };
  }

  const parsed = adapter.parse(raw);
  if (!parsed.model || hasDiagnosticErrors(parsed.diagnostics)) {
    return {
      diagnostics: parsed.diagnostics,
    };
  }

  return {
    model: canonicalToEditorModel(parsed.model),
    document: parsed.model,
    diagnostics: parsed.diagnostics,
  };
}

/**
 * Detect whether a set of directory files looks like a fragmented coArchi model
 * (individual XML files per element/relationship, typically under model/, relations/, views/).
 */
export function isFragmentedModelDirectory(files: OpenFileEntry[]): boolean {
  const xmlFiles = files.filter(f => f.relativePath.toLowerCase().endsWith('.xml'));
  if (xmlFiles.length < 2) return false;

  // Check for typical coArchi/GRAFICO directory structure patterns
  // The "model" folder can appear at any depth (root, or nested under project name)
  const graficoFolders = new Set(['model', 'relations', 'views', 'diagrams']);
  const hasModelSubdir = xmlFiles.some(f => {
    const parts = f.relativePath.toLowerCase().split('/');
    // Check the first few path segments for typical GRAFICO folder names
    return parts.length >= 2 && parts.slice(0, -1).some(p => graficoFolders.has(p));
  });

  if (hasModelSubdir) return true;

  // Fallback heuristic: if there are many small XML files and no single large model file,
  // it's likely fragmented. Check if any single file could be a complete model.
  const hasLargeModelFile = files.some(f => {
    const lower = f.relativePath.toLowerCase();
    return lower.endsWith('.archimate') ||
           lower.endsWith('.archimate.xml') ||
           lower.endsWith('.openarchi.json');
  });

  return !hasLargeModelFile && xmlFiles.length >= 3;
}

/**
 * Async generator that reads XML files one at a time via their OpenFileEntry.
 * Only one file's raw text is in memory at a time — the previous is released
 * before the next is read.
 */
async function* yieldFileContents(
  xmlFiles: OpenFileEntry[],
): AsyncGenerator<{ content: string; path: string }> {
  for (const file of xmlFiles) {
    try {
      const content = await file.readText();
      yield { content, path: file.relativePath };
    } catch {
      // Skipped — errors handled via diagnostics in the parser
    }
  }
}

/**
 * Import a fragmented coArchi model using streaming parsing.
 * Files are read and parsed one at a time to avoid holding all raw XML
 * strings + DOM trees in memory simultaneously — critical for 500MB+ models.
 */
export async function importFragmentedModel(
  files: OpenFileEntry[],
  onProgress?: ProgressCallback,
): Promise<ModelImportResult> {
  const xmlFiles = files.filter(f => f.relativePath.toLowerCase().endsWith('.xml'));

  if (xmlFiles.length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'NO_XML_FILES',
        message: 'No XML files found in the directory.',
      }],
    };
  }

  const parsed = await parseCoArchiFragmentsStreaming(
    yieldFileContents(xmlFiles),
    xmlFiles.length,
    onProgress,
  );

  if (!parsed.model || hasDiagnosticErrors(parsed.diagnostics)) {
    return { diagnostics: parsed.diagnostics };
  }

  // Use combined conversion to build model + layouts in a single pass
  const { model, elementLayouts, relationshipLayouts } = canonicalToEditorModelWithLayouts(parsed.model);

  return {
    model,
    document: parsed.model,
    diagnostics: parsed.diagnostics,
    elementLayouts,
    relationshipLayouts,
  };
}

export function exportEditorModelToText(model: OpenArchiModel, formatId: string): ModelExportResult {
  const adapter = registry.getById(formatId);
  if (!adapter) {
    return {
      content: '',
      mimeType: 'text/plain',
      suggestedFileName: 'model.txt',
      diagnostics: [
        {
          severity: 'error',
          code: 'FORMAT_NOT_SUPPORTED',
          message: `Format '${formatId}' is not supported.`,
        },
      ],
    };
  }

  const canonical = editorToCanonicalModel(model);
  return adapter.serialize(canonical);
}

/**
 * Export an editor model as fragmented coArchi/GRAFICO files.
 * Returns the list of { relativePath, content } pairs to write to disk.
 */
export function exportFragmentedEditorModel(
  model: OpenArchiModel,
  baseDocument?: CanonicalModelDocument,
  elementLayouts?: ElementLayoutsByView,
  relationshipLayouts?: RelationshipLayoutsByView,
): FragmentedSerializeResult {
  const canonical = applyLayoutsToCanonical(
    mergeEditorModelIntoCanonical(model, baseDocument),
    model,
    elementLayouts,
    relationshipLayouts,
    baseDocument,
  );
  const result = serializeCoArchiFragmented(canonical);

  if (!baseDocument) return result;

  const nextElementIds = new Set(canonical.elements.map(element => element.id));
  const nextRelationshipIds = new Set(canonical.relationships.map(relationship => relationship.id));
  const nextViewIds = new Set(canonical.views.map(view => view.id));

  const deletedPaths = [
    ...collectDeletedFragmentPaths(baseDocument.elements, nextElementIds),
    ...collectDeletedFragmentPaths(baseDocument.relationships, nextRelationshipIds),
    ...collectDeletedFragmentPaths(baseDocument.views, nextViewIds),
  ];

  return {
    ...result,
    deletedPaths,
    document: canonical,
  };
}
