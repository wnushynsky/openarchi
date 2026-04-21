import { useEffect, useMemo, useRef, useState } from 'react';
import type { SelectionType } from '../types';
import type { OrganizationItemNode, OrganizationTree, OrganizationTreeNode } from '../model/organization';
import { FONT, RELATIONSHIP_TYPES } from '../core';
import { CanvasIcon } from './CanvasIcon';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 5,
  border: '1px solid var(--border, rgba(0,0,0,0.06))',
  background: 'rgba(0,0,0,0.015)',
  color: 'var(--text-primary, #1a1a1a)',
  fontSize: 12.5,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
  fontWeight: 400,
  transition: 'border-color var(--transition-fast, 0.12s ease), box-shadow var(--transition-fast, 0.12s ease)',
};

interface ModelTreeProps {
  tree: OrganizationTree;
  currentViewId: string;
  selectedId: string | null;
  selectedType: SelectionType;
  onSelectView: (id: string) => void;
  onSelectElement: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onMoveItemToFolder: (item: { kind: 'view' | 'element' | 'relationship'; id: string }, folderPath: string) => void;
  onCreateFolder: (parentFolderPath: string) => void;
  onRenameFolder: (folderPath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
}

const TREE_ITEM_MIME = 'application/openarchi-model-tree-item';

interface DraggedTreeItem {
  kind: 'view' | 'element' | 'relationship';
  id: string;
}

function parseDraggedTreeItem(dataTransfer: DataTransfer): DraggedTreeItem | null {
  const raw = dataTransfer.getData(TREE_ITEM_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.kind !== 'view' && parsed.kind !== 'element' && parsed.kind !== 'relationship') || typeof parsed.id !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildAncestorMap(nodes: OrganizationTreeNode[], ancestors: string[] = [], map = new Map<string, string[]>()) {
  for (const node of nodes) {
    if (node.kind === 'folder') {
      map.set(node.id, ancestors);
      buildAncestorMap(node.children, [...ancestors, node.id], map);
      continue;
    }
    map.set(`${node.kind}:${node.id}`, ancestors);
  }
  return map;
}

function matchesQuery(node: OrganizationTreeNode, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLowerCase();
  if (node.name.toLowerCase().includes(normalized)) return true;
  if (node.kind !== 'folder' && node.type?.toLowerCase().includes(normalized)) return true;
  if (node.kind === 'folder') return node.children.some(child => matchesQuery(child, query));
  return false;
}

function selectionKey(node: OrganizationItemNode): string {
  return `${node.kind}:${node.id}`;
}

function RelationshipGlyph({ type }: { type?: string }) {
  const color = 'var(--text-faint, #b0b0b8)';
  const dash = type ? RELATIONSHIP_TYPES[type]?.dash : false;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <line
        x1="2"
        y1="8"
        x2="13"
        y2="8"
        stroke={color}
        strokeWidth="1.2"
        strokeDasharray={dash ? '3 2' : undefined}
        strokeLinecap="round"
      />
      <path d="M10.5 5.5L13.5 8L10.5 10.5" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  setExpanded,
  searchQuery,
  currentViewId,
  selectedId,
  selectedType,
  onSelectView,
  onSelectElement,
  onSelectRelationship,
  onMoveItemToFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  dropFolderId,
  onDropFolderChange,
}: {
  node: OrganizationTreeNode;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  searchQuery: string;
  currentViewId: string;
  selectedId: string | null;
  selectedType: SelectionType;
  onSelectView: (id: string) => void;
  onSelectElement: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onMoveItemToFolder: (item: DraggedTreeItem, folderPath: string) => void;
  onCreateFolder: (parentFolderPath: string) => void;
  onRenameFolder: (folderPath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  dropFolderId: string | null;
  onDropFolderChange: (folderId: string | null) => void;
}) {
  if (!matchesQuery(node, searchQuery)) return null;

  if (node.kind === 'folder') {
    const visibleChildren = node.children.filter(child => matchesQuery(child, searchQuery));
    const isExpanded = searchQuery ? true : expanded.has(node.id);
    const isDropTarget = dropFolderId === node.id;
    return (
      <>
        <div
          onClick={() => setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(node.id)) next.delete(node.id);
            else next.add(node.id);
            return next;
          })}
          style={{
            width: 'calc(100% - 8px)',
            margin: '0 4px',
            padding: `3px 8px 3px ${8 + depth * 14}px`,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: 'none',
            background: isDropTarget ? 'var(--surface-selected, rgba(37,99,235,0.07))' : 'transparent',
            borderRadius: 5,
            cursor: 'pointer',
            minHeight: 26,
            boxShadow: isDropTarget ? 'inset 0 0 0 1px rgba(37,99,235,0.18)' : 'none',
          }}
          onMouseEnter={e => {
            if (!isDropTarget) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))';
          }}
          onMouseLeave={e => {
            if (!isDropTarget) e.currentTarget.style.background = 'transparent';
          }}
          onDragEnter={event => {
            if (!parseDraggedTreeItem(event.dataTransfer)) return;
            onDropFolderChange(node.id);
            if (!isExpanded) {
              setExpanded(prev => {
                const next = new Set(prev);
                next.add(node.id);
                return next;
              });
            }
          }}
          onDragOver={event => {
            const draggedItem = parseDraggedTreeItem(event.dataTransfer);
            if (!draggedItem) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dropFolderId !== node.id) onDropFolderChange(node.id);
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              if (dropFolderId === node.id) onDropFolderChange(null);
            }
          }}
          onDrop={event => {
            const draggedItem = parseDraggedTreeItem(event.dataTransfer);
            if (!draggedItem) return;
            event.preventDefault();
            onDropFolderChange(null);
            onMoveItemToFolder(draggedItem, node.path);
          }}
        >
          <span
            style={{
              width: 14,
              fontSize: 8,
              color: 'var(--text-muted, #8a8a90)',
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform var(--transition-fast, 0.12s ease)',
            }}
          >
            {'\u25B6'}
          </span>
          <span style={{ flex: 1, textAlign: 'left', fontSize: 12, color: 'var(--text-secondary, #555)', fontStyle: 'italic' }}>{node.name}</span>
          <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)' }}>{node.itemCount}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              title="Create Folder"
              onClick={event => {
                event.stopPropagation();
                onCreateFolder(node.path);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-faint, #b0b0b8)',
                cursor: 'pointer',
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              +
            </button>
            <button
              title="Rename Folder"
              onClick={event => {
                event.stopPropagation();
                onRenameFolder(node.path);
              }}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-faint, #b0b0b8)',
                cursor: 'pointer',
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              {'\u270E'}
            </button>
            {node.itemCount === 0 && node.children.length === 0 && (
              <button
                title="Delete Folder"
                onClick={event => {
                  event.stopPropagation();
                  onDeleteFolder(node.path);
                }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-faint, #b0b0b8)',
                  cursor: 'pointer',
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                {'\u00D7'}
              </button>
            )}
          </span>
        </div>
        {isExpanded && visibleChildren.map(child => (
          <TreeRow
            key={child.kind === 'folder' ? child.id : `${child.kind}:${child.id}`}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            setExpanded={setExpanded}
            searchQuery={searchQuery}
            currentViewId={currentViewId}
            selectedId={selectedId}
            selectedType={selectedType}
            onSelectView={onSelectView}
            onSelectElement={onSelectElement}
            onSelectRelationship={onSelectRelationship}
            onMoveItemToFolder={onMoveItemToFolder}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            dropFolderId={dropFolderId}
            onDropFolderChange={onDropFolderChange}
          />
        ))}
      </>
    );
  }

  const isCurrentView = node.kind === 'view' && node.id === currentViewId;
  const isSelected = node.id === selectedId && selectedType === node.kind;
  const active = isCurrentView || isSelected;

  const icon = node.kind === 'view'
    ? <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center', color: 'var(--text-faint, #b0b0b8)', fontSize: 11 }}>{'\u25A3'}</span>
    : node.kind === 'element'
      ? <CanvasIcon type={node.type || 'grouping'} size={16} color="var(--text-faint, #b0b0b8)" />
      : <RelationshipGlyph type={node.type} />;

  const typeLabel = node.kind === 'view' ? 'view' : node.type;
  const onClick = () => {
    if (node.kind === 'view') onSelectView(node.id);
    else if (node.kind === 'element') onSelectElement(node.id);
    else onSelectRelationship(node.id);
  };

  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={event => {
        const payload: DraggedTreeItem = { kind: node.kind, id: node.id };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(TREE_ITEM_MIME, JSON.stringify(payload));
        event.dataTransfer.setData('text/plain', node.name);
      }}
      onDragEnd={() => onDropFolderChange(null)}
      style={{
        width: 'calc(100% - 8px)',
        margin: '0 4px',
        padding: `3px 8px 3px ${22 + depth * 14}px`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        border: 'none',
        background: active ? 'var(--surface-selected, rgba(37,99,235,0.07))' : 'transparent',
        borderRadius: 5,
        cursor: 'pointer',
        minHeight: 26,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', width: 16, justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <span
        style={{
          flex: 1,
          textAlign: 'left',
          fontSize: 12,
          color: active ? 'var(--accent-text, #1d4ed8)' : 'var(--text-secondary, #555)',
          fontWeight: active ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {node.name}
      </span>
      {typeLabel && (
        <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
          {typeLabel}
        </span>
      )}
    </button>
  );
}

export function ModelTree({
  tree,
  currentViewId,
  selectedId,
  selectedType,
  onSelectView,
  onSelectElement,
  onSelectRelationship,
  onMoveItemToFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: ModelTreeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ancestorMap = useMemo(() => buildAncestorMap(tree.nodes), [tree]);

  useEffect(() => {
    const key = selectedId && selectedType ? `${selectedType}:${selectedId}` : `view:${currentViewId}`;
    const ancestors = ancestorMap.get(key);
    if (!ancestors || ancestors.length === 0) return;
    setExpanded(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const ancestor of ancestors) {
        if (!next.has(ancestor)) {
          next.add(ancestor);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [ancestorMap, currentViewId, selectedId, selectedType]);

  useEffect(() => {
    const element = scrollRef.current?.parentElement;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, []);

  const visibleNodes = tree.nodes.filter(node => matchesQuery(node, searchQuery));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {tree.rootName}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)' }}>{tree.itemCount}</span>
          <button
            title="Create Folder"
            onClick={() => onCreateFolder('')}
            style={{
              width: 18,
              height: 18,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'var(--text-faint, #b0b0b8)',
              cursor: 'pointer',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>
      </div>

      <div style={{ padding: '0 8px 6px', position: 'relative' }}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', left: 16, top: 7, pointerEvents: 'none' }}>
          <circle cx="6" cy="6" r="4" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" />
          <line x1="9" y1="9" x2="12" y2="12" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Filter model..."
          style={{
            ...inputStyle,
            fontSize: 12,
            padding: '5px 8px 5px 26px',
            background: 'rgba(0,0,0,0.02)',
          }}
        />
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', paddingBottom: 6 }}>
        {visibleNodes.length === 0 ? (
          <div style={{ padding: '12px 14px', color: 'var(--text-faint, #b0b0b8)', fontSize: 12 }}>
            {searchQuery ? `No model items matching "${searchQuery}"` : 'No organized model items yet.'}
          </div>
        ) : (
          visibleNodes.map(node => (
            <TreeRow
              key={node.kind === 'folder' ? node.id : selectionKey(node)}
              node={node}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              searchQuery={searchQuery.trim()}
              currentViewId={currentViewId}
              selectedId={selectedId}
              selectedType={selectedType}
              onSelectView={onSelectView}
              onSelectElement={onSelectElement}
              onSelectRelationship={onSelectRelationship}
              onMoveItemToFolder={onMoveItemToFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              dropFolderId={dropFolderId}
              onDropFolderChange={setDropFolderId}
            />
          ))
        )}
      </div>
    </div>
  );
}
