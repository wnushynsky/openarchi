import type { ModelElement, ModelRelationship, ModelView } from '../types';
import type { CanonicalModelDocument, CoArchiFolderEntry } from './canonical';

export type OrganizationItemKind = 'view' | 'element' | 'relationship';

export interface OrganizationItemNode {
  kind: OrganizationItemKind;
  id: string;
  name: string;
  type?: string;
  sourcePath?: string;
}

export interface OrganizationFolderNode {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  itemCount: number;
  children: OrganizationTreeNode[];
}

export type OrganizationTreeNode = OrganizationFolderNode | OrganizationItemNode;

export interface OrganizationTree {
  rootName: string;
  nodes: OrganizationTreeNode[];
  itemCount: number;
}

interface BuildOrganizationTreeInput {
  document?: CanonicalModelDocument | null;
  elements: ModelElement[];
  relationships: ModelRelationship[];
  views: ModelView[];
}

interface MutableFolder {
  kind: 'folder';
  id: string;
  name: string;
  path: string;
  folders: Map<string, MutableFolder>;
  items: OrganizationItemNode[];
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function getDirName(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function detectRootDir(document: CanonicalModelDocument): string {
  const rootFilePath = document.metadata?.coArchi?.rootFilePath;
  if (rootFilePath) return getDirName(rootFilePath);

  const candidates = [
    ...(document.metadata?.coArchi?.folders || []).map(folder => getDirName(folder.path)),
    ...document.elements.map(element => element.sourcePath).filter((path): path is string => !!path).map(getDirName),
    ...document.relationships.map(relationship => relationship.sourcePath).filter((path): path is string => !!path).map(getDirName),
    ...document.views.map(view => view.sourcePath).filter((path): path is string => !!path).map(getDirName),
  ].map(normalizePath).filter(Boolean);

  if (candidates.length === 0) return '';

  const first = candidates[0].split('/').filter(Boolean);
  let prefixLength = first.length;
  for (const candidate of candidates.slice(1)) {
    const parts = candidate.split('/').filter(Boolean);
    let index = 0;
    while (index < prefixLength && index < parts.length && first[index] === parts[index]) index += 1;
    prefixLength = index;
    if (prefixLength === 0) break;
  }

  return first.slice(0, prefixLength).join('/');
}

function toRelativeFolderPath(path: string, rootDir: string): string {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  if (!rootDir) return normalized;
  if (normalized === rootDir) return '';
  return normalized.startsWith(`${rootDir}/`) ? normalized.slice(rootDir.length + 1) : normalized;
}

function hasOrganizationData(document?: CanonicalModelDocument | null): document is CanonicalModelDocument {
  if (!document) return false;
  if ((document.metadata?.coArchi?.folders?.length || 0) > 0) return true;
  if (document.elements.some(element => !!element.sourcePath)) return true;
  if (document.relationships.some(relationship => !!relationship.sourcePath)) return true;
  return document.views.some(view => !!view.sourcePath);
}

function buildFolderLabelMap(folders: CoArchiFolderEntry[] | undefined, rootDir: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const folder of folders || []) {
    const dir = toRelativeFolderPath(getDirName(folder.path), rootDir);
    if (!labels.has(dir)) labels.set(dir, folder.name || getBaseName(dir) || 'Folder');
  }
  return labels;
}

function createFolder(path: string, name: string): MutableFolder {
  return {
    kind: 'folder',
    id: `folder:${path || '__root__'}`,
    name,
    path,
    folders: new Map(),
    items: [],
  };
}

function ensureFolder(root: MutableFolder, path: string, labels: Map<string, string>): MutableFolder {
  if (!path) return root;
  const segments = path.split('/').filter(Boolean);
  let current = root;
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    let child = current.folders.get(segment);
    if (!child) {
      child = createFolder(currentPath, labels.get(currentPath) || segment);
      current.folders.set(segment, child);
    }
    current = child;
  }
  return current;
}

function sortNodes(nodes: OrganizationTreeNode[]): OrganizationTreeNode[] {
  const order = (node: OrganizationTreeNode): number => {
    if (node.kind === 'folder') return 0;
    if (node.kind === 'view') return 1;
    if (node.kind === 'element') return 2;
    return 3;
  };

  return [...nodes].sort((left, right) => {
    const kindDelta = order(left) - order(right);
    if (kindDelta !== 0) return kindDelta;
    return left.name.localeCompare(right.name);
  });
}

function finalizeFolder(folder: MutableFolder): OrganizationFolderNode {
  const children = sortNodes([
    ...Array.from(folder.folders.values()).map(finalizeFolder),
    ...folder.items,
  ]);

  const itemCount = children.reduce((count, child) => count + (child.kind === 'folder' ? child.itemCount : 1), 0);
  return {
    kind: 'folder',
    id: folder.id,
    name: folder.name,
    path: folder.path,
    itemCount,
    children,
  };
}

function addItem(
  root: MutableFolder,
  labels: Map<string, string>,
  rootDir: string,
  item: OrganizationItemNode,
  sourcePath?: string,
): void {
  const folderPath = sourcePath
    ? toRelativeFolderPath(getDirName(sourcePath), rootDir)
    : '__unfiled__';
  const parent = ensureFolder(root, folderPath, labels);
  parent.items.push(item);
}

export function buildOrganizationTree({
  document,
  elements,
  relationships,
  views,
}: BuildOrganizationTreeInput): OrganizationTree | null {
  if (!hasOrganizationData(document)) return null;

  const rootDir = detectRootDir(document);
  const labels = buildFolderLabelMap(document.metadata?.coArchi?.folders, rootDir);
  labels.set('__unfiled__', 'Unfiled');

  const root = createFolder('', document.metadata?.coArchi?.modelName || 'Model');
  for (const folder of document.metadata?.coArchi?.folders || []) {
    ensureFolder(root, toRelativeFolderPath(getDirName(folder.path), rootDir), labels);
  }

  const canonicalElements = new Map(document.elements.map(element => [element.id, element]));
  const canonicalRelationships = new Map(document.relationships.map(relationship => [relationship.id, relationship]));
  const canonicalViews = new Map(document.views.map(view => [view.id, view]));

  for (const view of views) {
    const sourcePath = view.sourcePath || canonicalViews.get(view.id)?.sourcePath;
    addItem(root, labels, rootDir, {
      kind: 'view',
      id: view.id,
      name: view.name,
      sourcePath,
    }, sourcePath);
  }

  for (const element of elements) {
    const sourcePath = element.sourcePath || canonicalElements.get(element.id)?.sourcePath;
    addItem(root, labels, rootDir, {
      kind: 'element',
      id: element.id,
      name: element.name,
      type: element.type,
      sourcePath,
    }, sourcePath);
  }

  for (const relationship of relationships) {
    const sourcePath = relationship.sourcePath || canonicalRelationships.get(relationship.id)?.sourcePath;
    addItem(root, labels, rootDir, {
      kind: 'relationship',
      id: relationship.id,
      name: relationship.name || relationship.id,
      type: relationship.type,
      sourcePath,
    }, sourcePath);
  }

  const nodes = sortNodes([
    ...Array.from(root.folders.values()).map(finalizeFolder),
    ...root.items,
  ]);

  const itemCount = nodes.reduce((count, node) => count + (node.kind === 'folder' ? node.itemCount : 1), 0);
  return {
    rootName: root.name,
    nodes,
    itemCount,
  };
}
