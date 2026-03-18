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
  if (lower.endsWith('.archimate.xml') || lower.endsWith('.archimate')) return registry.getById('archimate-exchange-xml');
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

  // Check for typical coArchi directory structure patterns
  const hasModelSubdir = xmlFiles.some(f => {
    const parts = f.relativePath.toLowerCase().split('/');
    return parts.length >= 2 && (
      parts[0] === 'model' ||
      parts[0] === 'relations' ||
      parts[0] === 'views' ||
      // Also check one level deeper: e.g. project/model/business/...
      parts[1] === 'model' ||
      parts[1] === 'relations' ||
      parts[1] === 'views'
    );
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
 * and merging them into a single model.
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

  // Read all XML files in parallel
  const contents: string[] = [];
  const errors: string[] = [];

  const results = await Promise.allSettled(
    xmlFiles.map(async f => {
      const text = await f.readText();
      return text;
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      contents.push(result.value);
    } else {
      errors.push(`Failed to read ${xmlFiles[i].relativePath}: ${result.reason}`);
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

  const parsed = parseCoArchiFragments(contents);

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
