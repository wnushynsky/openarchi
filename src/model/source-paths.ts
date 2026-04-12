import { ELEMENT_TYPES } from '../core';
import type {
  ModelElement,
  ModelRelationship,
  ModelView,
} from '../types';
import type {
  CanonicalElement,
  CanonicalModelDocument,
  CanonicalRelationship,
  CanonicalView,
  CoArchiFolderEntry,
} from './canonical';

const LAYER_FOLDER_MAP: Record<string, string> = {
  strategy: 'strategy',
  business: 'business',
  application: 'application',
  technology: 'technology',
  motivation: 'motivation',
  implementation: 'implementation_migration',
  composite: 'other',
};

function toPascalCase(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function elementTypeToXmlTag(type: string): string {
  if (type === 'andJunction' || type === 'orJunction') return 'Junction';
  if (type === 'note') return 'DiagramModelNote';
  if (type === 'grouping') return 'DiagramModelGroup';
  if (type === 'viewReference') return 'DiagramModelReference';
  return toPascalCase(type);
}

function relationshipTypeToXmlTag(type: string): string {
  return `${toPascalCase(type)}Relationship`;
}

export function normalizeRelativeFolderPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function getDirName(path: string): string {
  const normalized = normalizeRelativeFolderPath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function getBaseName(path: string): string {
  const normalized = normalizeRelativeFolderPath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function getCoArchiRootDir(document?: Pick<CanonicalModelDocument, 'metadata'> | null): string {
  const rootFilePath = document?.metadata?.coArchi?.rootFilePath;
  const rootDir = rootFilePath ? getDirName(rootFilePath) : '';
  return rootDir || 'model';
}

export function getDefaultElementFolder(type: string): string {
  const layer = ELEMENT_TYPES[type]?.layer ?? 'other';
  return LAYER_FOLDER_MAP[layer] ?? 'other';
}

export function getDefaultRelationshipFolder(): string {
  return 'relations';
}

export function getDefaultViewFolder(): string {
  return 'views';
}

export function getDefaultElementFileName(type: string, id: string): string {
  return `${elementTypeToXmlTag(type)}_${id}.xml`;
}

export function getDefaultRelationshipFileName(type: string, id: string): string {
  return `${relationshipTypeToXmlTag(type)}_${id}.xml`;
}

export function getDefaultViewFileName(id: string): string {
  return `${id}.xml`;
}

function joinPath(...parts: string[]): string {
  return parts
    .map(part => normalizeRelativeFolderPath(part))
    .filter(Boolean)
    .join('/');
}

function buildSourcePath(rootDir: string, relativeFolderPath: string, fileName: string): string {
  const folderPath = normalizeRelativeFolderPath(relativeFolderPath);
  return joinPath(rootDir, folderPath, fileName);
}

export function getRelativeFolderPathFromSourcePath(
  sourcePath: string | undefined,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
): string {
  if (!sourcePath) return '';
  const rootDir = getCoArchiRootDir(document);
  const directory = getDirName(sourcePath);
  if (!directory) return '';
  if (directory === rootDir) return '';
  return directory.startsWith(`${rootDir}/`) ? directory.slice(rootDir.length + 1) : directory;
}

export function moveElementSourcePath(
  element: Pick<ModelElement | CanonicalElement, 'id' | 'type' | 'sourcePath'>,
  folderPath: string,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
): string {
  const rootDir = getCoArchiRootDir(document);
  const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultElementFolder(element.type);
  const fileName = getBaseName(element.sourcePath || '') || getDefaultElementFileName(element.type, element.id);
  return buildSourcePath(rootDir, normalizedFolder, fileName);
}

export function moveRelationshipSourcePath(
  relationship: Pick<ModelRelationship | CanonicalRelationship, 'id' | 'type' | 'sourcePath'>,
  folderPath: string,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
): string {
  const rootDir = getCoArchiRootDir(document);
  const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultRelationshipFolder();
  const fileName = getBaseName(relationship.sourcePath || '') || getDefaultRelationshipFileName(relationship.type, relationship.id);
  return buildSourcePath(rootDir, normalizedFolder, fileName);
}

export function moveViewSourcePath(
  view: Pick<ModelView | CanonicalView, 'id' | 'sourcePath'>,
  folderPath: string,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
): string {
  const rootDir = getCoArchiRootDir(document);
  const normalizedFolder = normalizeRelativeFolderPath(folderPath) || getDefaultViewFolder();
  const fileName = getBaseName(view.sourcePath || '') || getDefaultViewFileName(view.id);
  return buildSourcePath(rootDir, normalizedFolder, fileName);
}

function expandRequiredFolderPaths(paths: string[], rootDir: string): string[] {
  const required = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeRelativeFolderPath(getDirName(path));
    if (!normalized) continue;
    if (normalized === rootDir || normalized.startsWith(`${rootDir}/`)) {
      required.add(normalized);
    }
  }
  return [...required].sort((left, right) => left.localeCompare(right));
}

function inferFolderType(relativeFolderPath: string): string {
  const topLevel = normalizeRelativeFolderPath(relativeFolderPath).split('/')[0] || 'other';
  if (topLevel === 'views') return 'diagrams';
  if (topLevel === 'relations') return 'relations';
  return topLevel;
}

function humanizeSegment(segment: string): string {
  if (!segment) return 'Folder';
  return segment
    .split(/[_-]/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function folderDisplayName(folderPath: string): string {
  const normalized = normalizeRelativeFolderPath(folderPath);
  const segment = normalized.split('/').filter(Boolean).slice(-1)[0] || 'folder';
  return humanizeSegment(segment);
}

export function relativeFolderPathToFolderXmlPath(
  folderPath: string,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
): string {
  const rootDir = getCoArchiRootDir(document);
  const normalized = normalizeRelativeFolderPath(folderPath);
  return normalized ? `${rootDir}/${normalized}/folder.xml` : `${rootDir}/folder.xml`;
}

export function isSameOrDescendantFolder(folderPath: string, ancestorFolderPath: string): boolean {
  const normalizedFolder = normalizeRelativeFolderPath(folderPath);
  const normalizedAncestor = normalizeRelativeFolderPath(ancestorFolderPath);
  if (!normalizedAncestor) return true;
  return normalizedFolder === normalizedAncestor || normalizedFolder.startsWith(`${normalizedAncestor}/`);
}

export function rebaseRelativeFolderPath(
  folderPath: string,
  fromFolderPath: string,
  toFolderPath: string,
): string {
  const normalizedFolder = normalizeRelativeFolderPath(folderPath);
  const normalizedFrom = normalizeRelativeFolderPath(fromFolderPath);
  const normalizedTo = normalizeRelativeFolderPath(toFolderPath);
  if (!normalizedFrom || normalizedFolder === normalizedFrom) return normalizedTo;
  if (!normalizedFolder.startsWith(`${normalizedFrom}/`)) return normalizedFolder;
  const suffix = normalizedFolder.slice(normalizedFrom.length + 1);
  return normalizedTo ? `${normalizedTo}/${suffix}` : suffix;
}

function buildFolderEntryFromRelativePath(
  folderPath: string,
  document?: Pick<CanonicalModelDocument, 'metadata'> | null,
  explicit: boolean = true,
): CoArchiFolderEntry {
  const normalized = normalizeRelativeFolderPath(folderPath);
  return {
    path: relativeFolderPathToFolderXmlPath(normalized, document),
    name: folderDisplayName(normalized),
    id: `folder-${normalized.replace(/\//g, '-') || 'root'}`,
    type: inferFolderType(normalized),
    explicit,
  };
}

export function upsertCoArchiFolderEntry(
  document: CanonicalModelDocument,
  folderPath: string,
): CanonicalModelDocument {
  const normalized = normalizeRelativeFolderPath(folderPath);
  if (!normalized) return document;
  const targetPath = relativeFolderPathToFolderXmlPath(normalized, document);
  const folders = [...(document.metadata?.coArchi?.folders || [])];
  if (!folders.some(folder => folder.path === targetPath)) {
    folders.push(buildFolderEntryFromRelativePath(normalized, document, true));
    folders.sort((left, right) => left.path.localeCompare(right.path));
  }
  return {
    ...document,
    metadata: {
      ...(document.metadata || {}),
      coArchi: {
        ...(document.metadata?.coArchi || {}),
        rootFilePath: document.metadata?.coArchi?.rootFilePath || `${getCoArchiRootDir(document)}/folder.xml`,
        folders,
      },
    },
  };
}

export function removeCoArchiFolderEntry(
  document: CanonicalModelDocument,
  folderPath: string,
): CanonicalModelDocument {
  const normalized = normalizeRelativeFolderPath(folderPath);
  const targetPath = relativeFolderPathToFolderXmlPath(normalized, document);
  return {
    ...document,
    metadata: {
      ...(document.metadata || {}),
      coArchi: {
        ...(document.metadata?.coArchi || {}),
        folders: (document.metadata?.coArchi?.folders || []).filter(folder => folder.path !== targetPath),
      },
    },
  };
}

export function renameCoArchiFolderEntries(
  document: CanonicalModelDocument,
  fromFolderPath: string,
  toFolderPath: string,
): CanonicalModelDocument {
  const normalizedFrom = normalizeRelativeFolderPath(fromFolderPath);
  const normalizedTo = normalizeRelativeFolderPath(toFolderPath);
  if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) return document;

  const folders = (document.metadata?.coArchi?.folders || []).map(folder => {
    const relativePath = getRelativeFolderPathFromSourcePath(`${getDirName(folder.path)}/placeholder.xml`, document);
    if (!isSameOrDescendantFolder(relativePath, normalizedFrom)) return folder;
    const rebased = rebaseRelativeFolderPath(relativePath, normalizedFrom, normalizedTo);
    const renamed = buildFolderEntryFromRelativePath(rebased, document, folder.explicit === true);
    return {
      ...folder,
      ...renamed,
    };
  });

  const deduped = new Map<string, CoArchiFolderEntry>();
  for (const folder of folders) deduped.set(folder.path, folder);

  return {
    ...document,
    metadata: {
      ...(document.metadata || {}),
      coArchi: {
        ...(document.metadata?.coArchi || {}),
        folders: [...deduped.values()].sort((left, right) => left.path.localeCompare(right.path)),
      },
    },
  };
}

export function ensureCanonicalSourcePaths(document: CanonicalModelDocument): CanonicalModelDocument {
  const rootDir = getCoArchiRootDir(document);

  const elements = document.elements.map(element => ({
    ...element,
    sourcePath: element.sourcePath || moveElementSourcePath(element, getDefaultElementFolder(element.type), document),
  }));

  const relationships = document.relationships.map(relationship => ({
    ...relationship,
    sourcePath: relationship.sourcePath || moveRelationshipSourcePath(relationship, getDefaultRelationshipFolder(), document),
  }));

  const views = document.views.map(view => ({
    ...view,
    sourcePath: view.sourcePath || moveViewSourcePath(view, getDefaultViewFolder(), document),
  }));

  const existingFolders = new Map((document.metadata?.coArchi?.folders || []).map(folder => [folder.path, folder]));
  const requiredFolderPaths = expandRequiredFolderPaths([
    ...elements.map(element => `${getDirName(element.sourcePath || '')}/folder.xml`),
    ...relationships.map(relationship => `${getDirName(relationship.sourcePath || '')}/folder.xml`),
    ...views.map(view => `${getDirName(view.sourcePath || '')}/folder.xml`),
  ], rootDir);

  const explicitFolderPaths = [...existingFolders.values()]
    .filter(folder => folder.explicit === true)
    .map(folder => getDirName(folder.path));

  const allFolderPaths = new Set<string>([
    ...explicitFolderPaths,
    ...requiredFolderPaths,
  ]);

  const folders: CoArchiFolderEntry[] = [...allFolderPaths].sort((left, right) => left.localeCompare(right)).map(path => {
    const folderXmlPath = `${path}/folder.xml`;
    const existing = existingFolders.get(folderXmlPath);
    if (existing) return existing;
    const relativeFolderPath = getRelativeFolderPathFromSourcePath(`${path}/placeholder.xml`, document);
    return buildFolderEntryFromRelativePath(relativeFolderPath, document, false);
  });

  return {
    ...document,
    elements,
    relationships,
    views,
    metadata: {
      ...(document.metadata || {}),
      coArchi: {
        ...(document.metadata?.coArchi || {}),
        rootFilePath: document.metadata?.coArchi?.rootFilePath || `${rootDir}/folder.xml`,
        folders,
      },
    },
  };
}
