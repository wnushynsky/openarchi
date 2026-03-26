import type { CanonicalModelDocument } from '../model/canonical';
import type { ModelDiagnostic } from '../model/diagnostics';

export interface ParseContext {
  fileName?: string;
  mimeType?: string;
}

export interface SerializeContext {
  fileNameBase?: string;
}

export interface ParseResult {
  model?: CanonicalModelDocument;
  diagnostics: ModelDiagnostic[];
}

export interface SerializeResult {
  content: string;
  diagnostics: ModelDiagnostic[];
  mimeType: string;
  suggestedFileName: string;
}

/** Result of serializing a model into multiple files (e.g. coArchi/GRAFICO directory) */
export interface FragmentedSerializeResult {
  files: { relativePath: string; content: string }[];
  diagnostics: ModelDiagnostic[];
  /** Paths that should be removed (elements deleted from the model) */
  deletedPaths?: string[];
}

export interface ModelFormatAdapter {
  id: string;
  label: string;
  extensions: string[];
  mimeTypes: string[];
  parse: (raw: string, context?: ParseContext) => ParseResult;
  serialize: (model: CanonicalModelDocument, context?: SerializeContext) => SerializeResult;
}

export class AdapterRegistry {
  private readonly adaptersById: Map<string, ModelFormatAdapter>;

  constructor(adapters: ModelFormatAdapter[]) {
    this.adaptersById = new Map(adapters.map(adapter => [adapter.id, adapter]));
  }

  list(): ModelFormatAdapter[] {
    return [...this.adaptersById.values()];
  }

  getById(id: string): ModelFormatAdapter | undefined {
    return this.adaptersById.get(id);
  }

  detectByFileName(fileName: string): ModelFormatAdapter | undefined {
    const lower = fileName.toLowerCase();
    return this.list().find(adapter =>
      adapter.extensions.some(extension => lower.endsWith(`.${extension.toLowerCase()}`)),
    );
  }
}

