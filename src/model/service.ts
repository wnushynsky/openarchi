import type { OpenArchiModel } from '../types';
import { AdapterRegistry } from '../io/adapter';
import type { ModelFormatAdapter, FragmentedSerializeResult } from '../io/adapter';
import { openArchiJsonAdapter } from '../io/adapters/openarchi-json';
import { coArchiXmlAdapter, parseCoArchiFragmentsStreaming, serializeCoArchiFragmented } from '../io/adapters/coarchi-xml';
import type { ProgressCallback } from '../io/adapters/coarchi-xml';
import { archiMateExchangeXmlAdapter } from '../io/adapters/archimate-exchange-xml';
import { canonicalToEditorModel, canonicalToEditorModelWithLayouts, editorToCanonicalModel } from './mapper';
import type { ElementLayoutsByView, RelationshipLayoutsByView } from './mapper';
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
export function exportFragmentedEditorModel(model: OpenArchiModel): FragmentedSerializeResult {
  const canonical = editorToCanonicalModel(model);
  return serializeCoArchiFragmented(canonical);
}
