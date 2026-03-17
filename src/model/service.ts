import type { OpenArchiModel } from '../types';
import { AdapterRegistry } from '../io/adapter';
import { openArchiJsonAdapter } from '../io/adapters/openarchi-json';
import { coArchiXmlAdapter } from '../io/adapters/coarchi-xml';
import { archiMateExchangeXmlAdapter } from '../io/adapters/archimate-exchange-xml';
import { canonicalToEditorModel, editorToCanonicalModel } from './mapper';
import { hasDiagnosticErrors, type ModelDiagnostic } from './diagnostics';
import type { CanonicalModelDocument } from './canonical';

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
