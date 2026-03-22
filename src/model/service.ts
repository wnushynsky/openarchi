import type { OpenArchiModel } from '../types';
import { AdapterRegistry } from '../io/adapter';
import { openArchiJsonAdapter } from '../io/adapters/openarchi-json';
import { coArchiXmlAdapter, parseCoArchiFragments } from '../io/adapters/coarchi-xml';
import { archiMateExchangeXmlAdapter } from '../io/adapters/archimate-exchange-xml';
import { canonicalToEditorModel, editorToCanonicalModel } from './mapper';
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
}

export interface ModelExportResult {
  content: string;
  mimeType: string;
  suggestedFileName: string;
  diagnostics: ModelDiagnostic[];
}

export function listModelFormats() {
  return registry.list();
}

export function detectModelFormatByFileName(fileName: string) {
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
 * Import a fragmented coArchi model by reading all XML files in the directory
 * and merging them into a single model. Reads files in batches to avoid
 * overwhelming browser memory on large models.
 */
export async function importFragmentedModel(files: OpenFileEntry[]): Promise<ModelImportResult> {
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

  // Read files in batches to avoid memory pressure
  const BATCH_SIZE = 50;
  const contents: string[] = [];
  const paths: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < xmlFiles.length; i += BATCH_SIZE) {
    const batch = xmlFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(f => f.readText()),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled') {
        contents.push(result.value);
        paths.push(batch[j].relativePath);
      } else {
        errors.push(`Failed to read ${batch[j].relativePath}: ${result.reason}`);
      }
    }

    // Yield to the event loop between batches to avoid blocking the UI
    if (i + BATCH_SIZE < xmlFiles.length) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  if (contents.length === 0) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'ALL_READS_FAILED',
        message: 'Could not read any XML files from the directory.',
      }],
    };
  }

  const parsed = parseCoArchiFragments(contents, paths);

  if (!parsed.model || hasDiagnosticErrors(parsed.diagnostics)) {
    return { diagnostics: parsed.diagnostics };
  }

  // Add read errors as warnings
  const diagnostics = [...parsed.diagnostics];
  for (const err of errors) {
    diagnostics.push({ severity: 'warning', code: 'FILE_READ_FAILED', message: err });
  }

  return {
    model: canonicalToEditorModel(parsed.model),
    document: parsed.model,
    diagnostics,
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
