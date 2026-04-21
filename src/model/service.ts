import type { OpenArchiModel } from '../types';
import { AdapterRegistry } from '../io/adapter';
import type { ModelFormatAdapter, FragmentedSerializeResult } from '../io/adapter';
import { openArchiJsonAdapter } from '../io/adapters/openarchi-json';
import { openArchiMarkdownAdapter } from '../io/adapters/openarchi-markdown';
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
import { validateCanonicalDocument } from './validation';
import { ensureCanonicalSourcePaths } from './source-paths';

const registry = new AdapterRegistry([
  openArchiJsonAdapter,
  openArchiMarkdownAdapter,
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
    summary: elementById.get(element.id)?.summary,
    tags: elementById.get(element.id)?.tags,
    properties: element.properties ?? elementById.get(element.id)?.properties,
    sourcePath: element.sourcePath || elementById.get(element.id)?.sourcePath,
  }));

  canonical.relationships = canonical.relationships.map(relationship => ({
    ...relationship,
    documentation: relationship.documentation ?? relationshipById.get(relationship.id)?.documentation,
    tags: relationshipById.get(relationship.id)?.tags,
    properties: relationship.properties ?? relationshipById.get(relationship.id)?.properties,
    sourcePath: relationship.sourcePath || relationshipById.get(relationship.id)?.sourcePath,
  }));

  canonical.views = canonical.views.map(view => ({
    ...view,
    documentation: view.documentation ?? viewById.get(view.id)?.documentation,
    purpose: view.purpose ?? viewById.get(view.id)?.purpose,
    viewpoint: view.viewpoint ?? viewById.get(view.id)?.viewpoint,
    tags: viewById.get(view.id)?.tags,
    properties: view.properties ?? viewById.get(view.id)?.properties,
    sourcePath: view.sourcePath || viewById.get(view.id)?.sourcePath,
  }));

  canonical.metadata = {
    ...(baseDocument.metadata || {}),
    ...(canonical.metadata || {}),
    sourceFormat: baseDocument.metadata?.sourceFormat || canonical.metadata?.sourceFormat,
    coArchi: baseDocument.metadata?.coArchi,
    ai: baseDocument.metadata?.ai,
  };

  return canonical;
}

function collectDeletedFragmentPaths(
  previous: { id: string; sourcePath?: string }[],
  nextEntries: { id: string; sourcePath?: string }[],
): string[] {
  const nextById = new Map(nextEntries.map(entry => [entry.id, entry.sourcePath]));
  return previous
    .filter(entry => {
      if (!entry.sourcePath) return false;
      if (!nextById.has(entry.id)) return true;
      return nextById.get(entry.id) !== entry.sourcePath;
    })
    .map(entry => entry.sourcePath!)
    .sort((a, b) => a.localeCompare(b));
}

function collectCreatedFragmentPaths(
  previous: { id: string; sourcePath?: string }[],
  nextEntries: { id: string; sourcePath?: string }[],
): string[] {
  const previousById = new Map(previous.map(entry => [entry.id, entry.sourcePath]));
  return nextEntries
    .filter(entry => {
      if (!entry.sourcePath) return false;
      if (!previousById.has(entry.id)) return true;
      return previousById.get(entry.id) !== entry.sourcePath;
    })
    .map(entry => entry.sourcePath!)
    .sort((a, b) => a.localeCompare(b));
}

function collectFolderManifestChanges(
  previousFolders: { path: string }[] = [],
  nextFolders: { path: string }[] = [],
): { createdFolderPaths: string[]; deletedFolderPaths: string[] } {
  const previousPaths = new Set(previousFolders.map(folder => folder.path));
  const nextPaths = new Set(nextFolders.map(folder => folder.path));

  const createdFolderPaths = [...nextPaths].filter(path => !previousPaths.has(path)).sort((a, b) => a.localeCompare(b));
  const deletedFolderPaths = [...previousPaths].filter(path => !nextPaths.has(path)).sort((a, b) => a.localeCompare(b));

  return { createdFolderPaths, deletedFolderPaths };
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

  if (Array.isArray(model.diagramNodes) && model.diagramNodes.length > 0) {
    const validViewIds = new Set(canonical.views.map(view => view.id));
    const baseNodeById = new Map(baseDocument.viewNodes.map(node => [node.id, node]));
    const baseConnectionById = new Map(baseDocument.viewConnections.map(connection => [connection.id, connection]));

    canonical.viewNodes = canonical.viewNodes
      .filter(node => validViewIds.has(node.viewId) && elementById.has(node.elementId))
      .map(node => {
        const baseNode = baseNodeById.get(node.id);
        return {
          ...baseNode,
          ...node,
          style: node.style ?? baseNode?.style,
        };
      });

    canonical.viewConnections = canonical.viewConnections
      .filter(connection => validViewIds.has(connection.viewId) && relationshipById.has(connection.relationshipId))
      .map(connection => {
        const baseConnection = baseConnectionById.get(connection.id);
        return {
          ...baseConnection,
          ...connection,
          style: connection.style ?? baseConnection?.style,
        };
      });

    return canonical;
  }

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
  if (lower.endsWith('.openarchi.md')) return registry.getById('openarchi-markdown');
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
  const validationDiagnostics = parsed.model ? validateCanonicalDocument(parsed.model) : [];
  const diagnostics = [...parsed.diagnostics, ...validationDiagnostics];
  if (!parsed.model || hasDiagnosticErrors(diagnostics)) {
    return {
      diagnostics,
    };
  }

  return {
    model: canonicalToEditorModel(parsed.model),
    document: parsed.model,
    diagnostics,
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
    return lower.endsWith('.openarchi.md') ||
           lower.endsWith('.archimate') ||
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
    const diagnostics = parsed.model
      ? [...parsed.diagnostics, ...validateCanonicalDocument(parsed.model)]
      : parsed.diagnostics;
    return { diagnostics };
  }

  const diagnostics = [...parsed.diagnostics, ...validateCanonicalDocument(parsed.model)];

  // Use combined conversion to build model + layouts in a single pass
  const { model, elementLayouts, relationshipLayouts } = canonicalToEditorModelWithLayouts(parsed.model);

  return {
    model,
    document: parsed.model,
    diagnostics,
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
  const validationDiagnostics = validateCanonicalDocument(canonical);
  const result = adapter.serialize(canonical);
  return {
    ...result,
    diagnostics: [...validationDiagnostics, ...result.diagnostics],
  };
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
  const canonicalWithLayouts = applyLayoutsToCanonical(
    mergeEditorModelIntoCanonical(model, baseDocument),
    model,
    elementLayouts,
    relationshipLayouts,
    baseDocument,
  );
  const sanitizedCanonical = sanitizeViewConnectionsForExport(canonicalWithLayouts);
  const canonical = ensureCanonicalSourcePaths(sanitizedCanonical);
  const validationDiagnostics = validateCanonicalDocument(canonical);
  const result = serializeCoArchiFragmented(canonical);

  if (!baseDocument) {
    return {
      ...result,
      diagnostics: [...validationDiagnostics, ...result.diagnostics],
    };
  }

  const deletedPaths = [
    ...collectDeletedFragmentPaths(baseDocument.elements, canonical.elements),
    ...collectDeletedFragmentPaths(baseDocument.relationships, canonical.relationships),
    ...collectDeletedFragmentPaths(baseDocument.views, canonical.views),
  ];

  const createdPaths = [
    ...collectCreatedFragmentPaths(baseDocument.elements, canonical.elements),
    ...collectCreatedFragmentPaths(baseDocument.relationships, canonical.relationships),
    ...collectCreatedFragmentPaths(baseDocument.views, canonical.views),
  ].sort((a, b) => a.localeCompare(b));

  const { createdFolderPaths, deletedFolderPaths } = collectFolderManifestChanges(
    baseDocument.metadata?.coArchi?.folders || [],
    canonical.metadata?.coArchi?.folders || [],
  );

  return {
    ...result,
    diagnostics: [...validationDiagnostics, ...result.diagnostics],
    deletedPaths: [...deletedPaths, ...deletedFolderPaths].sort((a, b) => a.localeCompare(b)),
    changeSet: {
      createdPaths,
      deletedPaths: [...deletedPaths, ...deletedFolderPaths].sort((a, b) => a.localeCompare(b)),
      createdFolderPaths,
      deletedFolderPaths,
    },
    document: canonical,
  };
}

function sanitizeViewConnectionsForExport(document: CanonicalModelDocument): CanonicalModelDocument {
  const nodeById = new Map(document.viewNodes.map(node => [node.id, node]));
  const relationshipById = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const nodeIdsByViewAndElement = new Map<string, string[]>();

  for (const node of document.viewNodes) {
    const key = `${node.viewId}::${node.elementId}`;
    const ids = nodeIdsByViewAndElement.get(key) || [];
    ids.push(node.id);
    nodeIdsByViewAndElement.set(key, ids);
  }

  const viewConnections = document.viewConnections.flatMap(connection => {
    const relationship = relationshipById.get(connection.relationshipId);
    if (!relationship) return [];

    const sourceKey = `${connection.viewId}::${relationship.sourceId}`;
    const targetKey = `${connection.viewId}::${relationship.targetId}`;
    const sourceCandidates = nodeIdsByViewAndElement.get(sourceKey) || [];
    const targetCandidates = nodeIdsByViewAndElement.get(targetKey) || [];

    const currentSource = connection.sourceNodeId ? nodeById.get(connection.sourceNodeId) : undefined;
    const currentTarget = connection.targetNodeId ? nodeById.get(connection.targetNodeId) : undefined;

    const sourceNodeId = currentSource?.viewId === connection.viewId && currentSource.elementId === relationship.sourceId
      ? currentSource.id
      : sourceCandidates[0];
    const targetNodeId = currentTarget?.viewId === connection.viewId && currentTarget.elementId === relationship.targetId
      ? currentTarget.id
      : targetCandidates[0];

    if (!sourceNodeId || !targetNodeId) return [];

    return [{
      ...connection,
      sourceNodeId,
      targetNodeId,
    }];
  });

  return {
    ...document,
    viewConnections,
  };
}
