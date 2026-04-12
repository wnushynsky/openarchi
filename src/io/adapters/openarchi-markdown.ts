import { applyOpenArchiMarkdownPatch, isOpenArchiMarkdownPatch } from '../../ai/patch';
import type { CanonicalModelDocument } from '../../model/canonical';
import { serializeCanonicalToMarkdown } from '../../ai/markdown';
import type { ModelFormatAdapter, ParseResult, SerializeResult } from '../adapter';

function isCanonicalDocument(value: unknown): value is CanonicalModelDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.elements) &&
    Array.isArray(candidate.relationships) &&
    Array.isArray(candidate.views) &&
    Array.isArray(candidate.viewNodes) &&
    Array.isArray(candidate.viewConnections);
}

function extractJsonBlocks(raw: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Ignore non-JSON blocks; diagnostics handled later if needed.
    }
  }

  return blocks;
}

function parseOpenArchiMarkdown(raw: string): ParseResult {
  const blocks = extractJsonBlocks(raw);
  const baseDocument = blocks.find(isCanonicalDocument);
  const patch = blocks.find(isOpenArchiMarkdownPatch);

  if (!baseDocument) {
    return {
      diagnostics: [
        {
          severity: 'error',
          code: 'OPENARCHI_MARKDOWN_BASE_MISSING',
          message: 'OpenArchi AI Markdown must include a canonical JSON block.',
        },
      ],
    };
  }

  if (!patch) {
    return {
      model: baseDocument,
      diagnostics: [{
        severity: 'info',
        code: 'OPENARCHI_MARKDOWN_IMPORTED_CANONICAL',
        message: 'Imported canonical JSON from OpenArchi AI Markdown.',
      }],
    };
  }

  const result = applyOpenArchiMarkdownPatch(baseDocument, patch);
  return {
    model: result.document,
    diagnostics: [
      {
        severity: 'info',
        code: 'OPENARCHI_MARKDOWN_PATCH_APPLIED',
        message: 'Applied structured patch from OpenArchi AI Markdown.',
      },
      ...result.diagnostics,
    ],
  };
}

function serializeOpenArchiMarkdown(model: import('../../model/canonical').CanonicalModelDocument): SerializeResult {
  return {
    content: serializeCanonicalToMarkdown(model),
    diagnostics: [],
    mimeType: 'text/markdown',
    suggestedFileName: 'model.openarchi.md',
  };
}

export const openArchiMarkdownAdapter: ModelFormatAdapter = {
  id: 'openarchi-markdown',
  label: 'OpenArchi AI Markdown',
  extensions: ['openarchi.md'],
  mimeTypes: ['text/markdown', 'text/x-markdown'],
  parse: parseOpenArchiMarkdown,
  serialize: serializeOpenArchiMarkdown,
};
