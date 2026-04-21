import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ModelView, ModelElement, ModelRelationship, PropertyRecord } from '../types';
import { LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, FONT } from '../core';
import { VIEWPOINTS, getViewpointDefinition } from '../model/viewpoints';
import { CanvasIcon } from './CanvasIcon';

const iS: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid var(--border, rgba(0,0,0,0.06))',
  background: 'rgba(0,0,0,0.015)', color: 'var(--text-primary, #1a1a1a)', fontSize: 12.5, fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box' as const, fontWeight: 400,
  transition: 'border-color var(--transition-fast, 0.12s ease), box-shadow var(--transition-fast, 0.12s ease)',
};

function PF({ label, children, c }: { label: string; children: React.ReactNode; c?: boolean }) {
  return (
    <div style={{ flex: c ? 1 : undefined }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      {children}
    </div>
  );
}

function PropertyListEditor({
  properties,
  onChange,
}: {
  properties?: PropertyRecord[];
  onChange: (properties: PropertyRecord[]) => void;
}) {
  const [query, setQuery] = useState('');
  const rows = properties && properties.length > 0 ? properties : [];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows
    .map((property, index) => ({ property, index }))
    .filter(({ property }) => {
      if (!normalizedQuery) return true;
      return property.key.toLowerCase().includes(normalizedQuery) || property.value.toLowerCase().includes(normalizedQuery);
    });

  const updateRow = (index: number, key: 'key' | 'value', value: string) => {
    const next = rows.map((property, propertyIndex) => (
      propertyIndex === index ? { ...property, [key]: value } : property
    ));
    onChange(next);
  };

  const addRow = () => onChange([...rows, { key: '', value: '' }]);
  const removeRow = (index: number) => onChange(rows.filter((_, propertyIndex) => propertyIndex !== index));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Filter properties..."
        style={{ ...iS, fontSize: 12 }}
      />
      {rows.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1.5 }}>
          No properties yet.
        </div>
      )}
      {rows.length > 0 && visibleRows.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1.5 }}>
          No properties match "{query}".
        </div>
      )}
      {visibleRows.map(({ property, index }) => (
        <div key={`${index}:${property.key}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'start' }}>
          <input
            value={property.key}
            onChange={e => updateRow(index, 'key', e.target.value)}
            placeholder="key"
            style={iS}
          />
          <input
            value={property.value}
            onChange={e => updateRow(index, 'value', e.target.value)}
            placeholder="value"
            style={iS}
          />
          <button
            onClick={() => removeRow(index)}
            title="Remove property"
            style={{
              marginTop: 2,
              width: 24,
              height: 24,
              borderRadius: 5,
              border: '1px solid var(--border, rgba(0,0,0,0.06))',
              background: 'var(--surface-hover, rgba(0,0,0,0.035))',
              cursor: 'pointer',
              color: 'var(--text-muted, #8a8a90)',
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            {'\u00D7'}
          </button>
        </div>
      ))}
      <button
        onClick={addRow}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 8px',
          borderRadius: 5,
          border: '1px solid var(--border, rgba(0,0,0,0.06))',
          background: 'var(--surface-hover, rgba(0,0,0,0.035))',
          cursor: 'pointer',
          color: 'var(--text-secondary, #555)',
          fontSize: 11.5,
          fontFamily: 'inherit',
        }}
      >
        Add Property
      </button>
    </div>
  );
}

function FolderPathEditor({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft === value) return;
    onCommit(draft);
  };

  return (
    <input
      value={draft}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          (event.currentTarget as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      style={iS}
    />
  );
}

function ElementRelationshipList({
  title,
  relationships,
  elementsById,
  onSelectRelationship,
}: {
  title: string;
  relationships: ModelRelationship[];
  elementsById: Map<string, ModelElement>;
  onSelectRelationship?: (relationshipId: string) => void;
}) {
  return (
    <PF label={title}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {relationships.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1.5 }}>
            None.
          </div>
        ) : relationships.map(relationship => {
          const counterpartId = title === 'Outgoing' ? relationship.targetId : relationship.sourceId;
          const counterpart = elementsById.get(counterpartId);
          const typeLabel = RELATIONSHIP_TYPES[relationship.type]?.label || relationship.type;
          const relationshipLabel = relationship.name?.trim();
          return (
            <button
              key={relationship.id}
              onClick={() => onSelectRelationship?.(relationship.id)}
              style={{
                textAlign: 'left',
                width: '100%',
                borderRadius: 8,
                border: '1px solid var(--border, rgba(0,0,0,0.06))',
                background: 'var(--surface-hover, rgba(0,0,0,0.025))',
                padding: '7px 8px',
                cursor: onSelectRelationship ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-primary, #1a1a1a)' }}>
                {counterpart?.name || '\u2014'}
              </div>
              <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--text-muted, #8a8a90)', lineHeight: 1.4 }}>
                {typeLabel}
                {relationshipLabel ? ` • ${relationshipLabel}` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </PF>
  );
}

// ============================================================
// View navigator — tree with search, breadcrumbs, element counts
// ============================================================

interface ViewNavProps {
  views: ModelView[];
  currentViewId: string;
  onNavigate: (id: string) => void;
  onAddView?: (parentViewId?: string) => void;
  onViewContextMenu?: (viewId: string, x: number, y: number) => void;
}

function buildParentMap(views: ModelView[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of views) {
    for (const cid of v.childViewIds || []) {
      map.set(cid, v.id);
    }
  }
  return map;
}

function getAncestorChain(viewId: string, parentMap: Map<string, string>, viewById: Map<string, ModelView>): ModelView[] {
  const chain: ModelView[] = [];
  let cur = viewId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const v = viewById.get(cur);
    if (v) chain.unshift(v);
    const parent = parentMap.get(cur);
    if (!parent) break;
    cur = parent;
  }
  return chain;
}

function getRootViews(views: ModelView[], parentMap: Map<string, string>): ModelView[] {
  return views.filter(v => !parentMap.has(v.id));
}

function viewMatchesSearch(view: ModelView, query: string, viewById: Map<string, ModelView>): boolean {
  if (view.name.toLowerCase().includes(query)) return true;
  for (const cid of view.childViewIds || []) {
    const child = viewById.get(cid);
    if (child && viewMatchesSearch(child, query, viewById)) return true;
  }
  return false;
}

function TreeNode({ view, depth, currentViewId, onNavigate, onViewContextMenu, expanded, onToggle, viewById, searchQuery, elementCountById }: {
  view: ModelView;
  depth: number;
  currentViewId: string;
  onNavigate: (id: string) => void;
  onViewContextMenu?: (viewId: string, x: number, y: number) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  viewById: Map<string, ModelView>;
  searchQuery: string;
  elementCountById: Map<string, number>;
}) {
  const children = (view.childViewIds || [])
    .map(cid => viewById.get(cid))
    .filter((c): c is ModelView => !!c)
    .filter(c => !searchQuery || viewMatchesSearch(c, searchQuery, viewById));

  const hasChildren = children.length > 0;
  const isExpanded = expanded.has(view.id);
  const isCurrent = view.id === currentViewId;
  const elCount = elementCountById.get(view.id) ?? 0;
  const isFolder = hasChildren && elCount === 0;

  const renderName = () => {
    if (!searchQuery) return view.name;
    const idx = view.name.toLowerCase().indexOf(searchQuery);
    if (idx === -1) return view.name;
    return (
      <>
        {view.name.slice(0, idx)}
        <span style={{ background: 'var(--accent-ring, rgba(37,99,235,0.12))', borderRadius: 2, padding: '0 1px' }}>{view.name.slice(idx, idx + searchQuery.length)}</span>
        {view.name.slice(idx + searchQuery.length)}
      </>
    );
  };

  return (
    <>
      <div
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('application/openarchi-view', JSON.stringify({ viewId: view.id, viewName: view.name }));
          e.dataTransfer.effectAllowed = 'copy';
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 1,
          padding: `2px 8px 2px ${8 + depth * 14}px`,
          cursor: 'pointer',
          background: isCurrent ? 'var(--surface-selected, rgba(37,99,235,0.07))' : 'transparent',
          borderRadius: 5,
          margin: '0 4px',
          transition: 'background var(--transition-fast, 0.12s ease)',
          minHeight: 26,
        }}
        onClick={() => isFolder ? onToggle(view.id) : onNavigate(view.id)}
        onContextMenu={event => {
          if (!onViewContextMenu) return;
          event.preventDefault();
          onViewContextMenu(view.id, event.clientX, event.clientY);
        }}
        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
      >
        <span
          onClick={e => { e.stopPropagation(); if (hasChildren) onToggle(view.id); }}
          style={{
            width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, color: hasChildren ? 'var(--text-muted, #8a8a90)' : 'transparent',
            flexShrink: 0, userSelect: 'none',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform var(--transition-fast, 0.12s ease)',
          }}
        >
          {hasChildren ? '\u25B6' : '\u00B7'}
        </span>

        <span style={{
          flex: 1, fontSize: 12, fontWeight: isCurrent ? 500 : 400,
          color: isFolder ? 'var(--text-muted, #8a8a90)' : isCurrent ? 'var(--accent-text, #1d4ed8)' : 'var(--text-secondary, #555)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: '20px', paddingLeft: 2,
          fontStyle: isFolder ? 'italic' : 'normal',
        }}>
          {renderName()}
        </span>

        {elCount > 0 && (
          <span style={{
            fontSize: 10, color: 'var(--text-faint, #b0b0b8)', fontWeight: 400,
            flexShrink: 0, minWidth: 14, textAlign: 'right',
          }}>
            {elCount}
          </span>
        )}
      </div>

      {isExpanded && children.map(c => (
        <TreeNode
          key={c.id} view={c} depth={depth + 1}
          currentViewId={currentViewId} onNavigate={onNavigate} onViewContextMenu={onViewContextMenu}
          expanded={expanded} onToggle={onToggle}
          viewById={viewById} searchQuery={searchQuery}
          elementCountById={elementCountById}
        />
      ))}
    </>
  );
}

export function ViewNav({ views, currentViewId, onNavigate, onAddView, onViewContextMenu }: ViewNavProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const viewById = useMemo(() => {
    const m = new Map<string, ModelView>();
    for (const v of views) m.set(v.id, v);
    return m;
  }, [views]);

  const parentMap = useMemo(() => buildParentMap(views), [views]);

  const elementCountById = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of views) m.set(v.id, (v.elementIds || []).length);
    return m;
  }, [views]);

  const current = viewById.get(currentViewId);

  const breadcrumbs = useMemo(() => {
    if (!current) return [];
    return getAncestorChain(currentViewId, parentMap, viewById);
  }, [currentViewId, parentMap, viewById, current]);

  useEffect(() => {
    if (!current) return;
    const chain = getAncestorChain(currentViewId, parentMap, viewById);
    setExpanded(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const v of chain) {
        if (!next.has(v.id)) { next.add(v.id); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [currentViewId, parentMap, viewById, current]);

  const onToggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const query = searchQuery.toLowerCase().trim();

  const rootViews = useMemo(() => {
    const roots = getRootViews(views, parentMap);
    if (!query) return roots;
    return roots.filter(v => viewMatchesSearch(v, query, viewById));
  }, [views, parentMap, query, viewById]);

  useEffect(() => {
    const el = scrollRef.current?.parentElement;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, []);

  if (!current) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Views</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)', fontWeight: 400, opacity: 0.7 }}>{views.length}</span>
          {onAddView && (
            <button
              onClick={() => onAddView()}
              title="New View"
              style={{
                width: 18, height: 18, padding: 0, border: 'none', borderRadius: 4,
                background: 'transparent', cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-faint, #b0b0b8)',
                transition: 'background 0.12s ease, color 0.12s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.05))'; e.currentTarget.style.color = 'var(--text-secondary, #555)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint, #b0b0b8)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '0 8px 6px', position: 'relative' }}>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ position: 'absolute', left: 16, top: 7, pointerEvents: 'none' }}>
          <circle cx="6" cy="6" r="4" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" />
          <line x1="9" y1="9" x2="12" y2="12" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Filter..."
          style={{
            ...iS,
            fontSize: 12,
            padding: '5px 8px 5px 26px',
            background: 'rgba(0,0,0,0.02)',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute', right: 16, top: 5,
              width: 16, height: 16, borderRadius: 8,
              border: 'none', background: 'var(--surface-hover, rgba(0,0,0,0.035))',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'var(--text-muted, #8a8a90)', lineHeight: 1,
              transition: 'background var(--transition-fast, 0.12s ease)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-active, rgba(0,0,0,0.06))'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
          >
            {'\u00D7'}
          </button>
        )}
      </div>

      {/* Breadcrumbs */}
      {breadcrumbs.length > 1 && !query && (
        <div style={{
          padding: '0 10px 6px', display: 'flex', alignItems: 'center', gap: 1,
          flexWrap: 'wrap', lineHeight: '16px',
        }}>
          {breadcrumbs.map((v, i) => (
            <span key={v.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              {i > 0 && <span style={{ fontSize: 8, color: 'var(--text-faint, #b0b0b8)', margin: '0 1px' }}>{'\u203A'}</span>}
              {v.id === currentViewId ? (
                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--accent-text, #1d4ed8)' }}>{v.name}</span>
              ) : (
                <button
                  onClick={() => onNavigate(v.id)}
                  style={{
                    fontSize: 11, color: 'var(--text-muted, #8a8a90)', background: 'transparent',
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '1px 2px',
                    fontWeight: 400, borderRadius: 3,
                    transition: 'color var(--transition-fast, 0.12s ease), background var(--transition-fast, 0.12s ease)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-secondary, #555)'; e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted, #8a8a90)'; e.currentTarget.style.background = 'transparent'; }}
                >
                  {v.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Tree */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', paddingBottom: 6 }}>
        {rootViews.length === 0 && query && (
          <div style={{ padding: '12px 14px', color: 'var(--text-faint, #b0b0b8)', fontSize: 12 }}>No views matching "{searchQuery}"</div>
        )}
        {rootViews.map(v => (
          <TreeNode
            key={v.id} view={v} depth={0}
            currentViewId={currentViewId} onNavigate={onNavigate} onViewContextMenu={onViewContextMenu}
            expanded={expanded} onToggle={onToggle}
            viewById={viewById} searchQuery={query}
            elementCountById={elementCountById}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Property panel
// ============================================================

interface PropertyPanelProps {
  selEl: ModelElement | null;
  selRel: ModelRelationship | null;
  elements: ModelElement[];
  relationships: ModelRelationship[];
  onUpdateElement: (key: string, value: unknown) => void;
  onUpdateRelationship: (key: string, value: unknown) => void;
  onSelectRelationship?: (relationshipId: string) => void;
  onUpdateView?: (viewId: string, key: string, value: unknown) => void;
  side: 'left' | 'right';
  onToggleSide: () => void;
  currentView?: ModelView | null;
  onRenameView?: (viewId: string, name: string) => void;
  elementFolderPath?: string;
  relationshipFolderPath?: string;
  viewFolderPath?: string;
  onMoveElementToFolder?: (folderPath: string) => void;
  onMoveRelationshipToFolder?: (folderPath: string) => void;
  onMoveViewToFolder?: (folderPath: string) => void;
}

export function PropertyPanel({
  selEl,
  selRel,
  elements,
  relationships,
  onUpdateElement,
  onUpdateRelationship,
  onSelectRelationship,
  onUpdateView,
  side,
  onToggleSide,
  currentView,
  onRenameView,
  elementFolderPath,
  relationshipFolderPath,
  viewFolderPath,
  onMoveElementToFolder,
  onMoveRelationshipToFolder,
  onMoveViewToFolder,
}: PropertyPanelProps) {
  const isRight = side === 'right';
  const elementsById = useMemo(
    () => new Map(elements.map(element => [element.id, element])),
    [elements],
  );
  const outgoingRelationships = useMemo(
    () => selEl ? relationships.filter(relationship => relationship.sourceId === selEl.id) : [],
    [relationships, selEl],
  );
  const incomingRelationships = useMemo(
    () => selEl ? relationships.filter(relationship => relationship.targetId === selEl.id) : [],
    [relationships, selEl],
  );
  return (
    <div style={{
      background: 'transparent',
      ...(isRight ? { flex: 1 } : { borderTop: '1px solid var(--border, rgba(0,0,0,0.06))' }),
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '10px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Properties</span>
        <button
          onClick={onToggleSide}
          title={isRight ? 'Move to left' : 'Move to right'}
          style={{
            background: 'var(--surface-hover, rgba(0,0,0,0.035))',
            border: '1px solid var(--border, rgba(0,0,0,0.06))',
            borderRadius: 4, cursor: 'pointer', fontSize: 10,
            color: 'var(--text-faint, #b0b0b8)', padding: '1px 5px',
            lineHeight: 1.4, fontWeight: 400,
            transition: 'background var(--transition-fast, 0.12s ease)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-active, rgba(0,0,0,0.06))'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
        >
          {isRight ? '\u25C0' : '\u25B6'}
        </button>
      </div>

      {selEl ? (
        <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          <PF label={ELEMENT_TYPES[selEl.type]?.isNote ? 'Text' : 'Name'}>
            <textarea value={selEl.name} onChange={e => onUpdateElement('name', e.target.value)} rows={ELEMENT_TYPES[selEl.type]?.isNote ? 4 : 1} style={{ ...iS, resize: 'vertical' }} />
          </PF>
          {!ELEMENT_TYPES[selEl.type]?.isNote && (
            <>
              <PF label="Type">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CanvasIcon type={selEl.type} size={18} color={LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.stroke || '#666'} />
                  <select value={selEl.type} onChange={e => onUpdateElement('type', e.target.value)} style={{ ...iS, flex: 1 }}>
                    {Object.entries(ELEMENT_TYPES).filter(([, v]) => !v.isNote).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </PF>
              {ELEMENT_TYPES[selEl.type]?.desc && (
                <div style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1.5, padding: '0 2px', fontStyle: 'italic', fontWeight: 400 }}>
                  {ELEMENT_TYPES[selEl.type].desc}
                </div>
              )}
              <PF label="Layer">
                <span style={{ fontSize: 12, fontWeight: 400, color: LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.text }}>{LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.label}</span>
              </PF>
              <PF label="Docs">
                <textarea value={selEl.documentation || ''} onChange={e => onUpdateElement('documentation', e.target.value)} rows={3} style={{ ...iS, resize: 'vertical' }} />
              </PF>
              <PF label="Properties">
                <PropertyListEditor properties={selEl.properties} onChange={properties => onUpdateElement('properties', properties)} />
              </PF>
              {onMoveElementToFolder && elementFolderPath !== undefined && (
                <PF label="Folder">
                  <FolderPathEditor
                    value={elementFolderPath}
                    onCommit={onMoveElementToFolder}
                    placeholder="application/domain"
                  />
                </PF>
              )}
            </>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <PF label="X" c><input type="number" value={selEl.x} onChange={e => onUpdateElement('x', +e.target.value)} style={iS} /></PF>
            <PF label="Y" c><input type="number" value={selEl.y} onChange={e => onUpdateElement('y', +e.target.value)} style={iS} /></PF>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <PF label="W" c><input type="number" value={selEl.w} onChange={e => onUpdateElement('w', Math.max(60, +e.target.value))} style={iS} /></PF>
            <PF label="H" c><input type="number" value={selEl.h} onChange={e => onUpdateElement('h', Math.max(40, +e.target.value))} style={iS} /></PF>
          </div>
          <ElementRelationshipList
            title="Outgoing"
            relationships={outgoingRelationships}
            elementsById={elementsById}
            onSelectRelationship={onSelectRelationship}
          />
          <ElementRelationshipList
            title="Incoming"
            relationships={incomingRelationships}
            elementsById={elementsById}
            onSelectRelationship={onSelectRelationship}
          />
        </div>
      ) : selRel ? (
        <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PF label="Label"><input value={selRel.name || ''} onChange={e => onUpdateRelationship('name', e.target.value)} style={iS} placeholder="Double-click arrow to edit" /></PF>
          <PF label="Type">
            <select value={selRel.type} onChange={e => onUpdateRelationship('type', e.target.value)} style={iS}>
              {Object.entries(RELATIONSHIP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </PF>
          <PF label="Source"><span style={{ fontSize: 12, color: 'var(--text-secondary, #555)', fontWeight: 400 }}>{elements.find(e => e.id === selRel.sourceId)?.name || '\u2014'}</span></PF>
          <PF label="Target"><span style={{ fontSize: 12, color: 'var(--text-secondary, #555)', fontWeight: 400 }}>{elements.find(e => e.id === selRel.targetId)?.name || '\u2014'}</span></PF>
          <PF label="Docs"><textarea value={selRel.documentation || ''} onChange={e => onUpdateRelationship('documentation', e.target.value)} rows={3} style={{ ...iS, resize: 'vertical' }} /></PF>
          <PF label="Properties">
            <PropertyListEditor properties={selRel.properties} onChange={properties => onUpdateRelationship('properties', properties)} />
          </PF>
          {onMoveRelationshipToFolder && relationshipFolderPath !== undefined && (
            <PF label="Folder">
              <FolderPathEditor
                value={relationshipFolderPath}
                onCommit={onMoveRelationshipToFolder}
                placeholder="relations/integration"
              />
            </PF>
          )}
          <PF label="Waypoints"><span style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', fontWeight: 400 }}>{selRel.waypoints?.length || 0} points</span></PF>
          <PF label="Label position"><input type="range" min="0" max="100" value={Math.round((selRel.labelPos ?? 0.5) * 100)} onChange={e => onUpdateRelationship('labelPos', +e.target.value / 100)} style={{ width: '100%', accentColor: 'var(--accent, #2563eb)' }} /></PF>
        </div>
      ) : currentView && onRenameView ? (
        <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
          <PF label="View Name">
            <input value={currentView.name} onChange={e => onRenameView(currentView.id, e.target.value)} style={iS} />
          </PF>
          <PF label="Docs">
            <textarea
              value={currentView.documentation || ''}
              onChange={e => onUpdateView?.(currentView.id, 'documentation', e.target.value)}
              rows={3}
              style={{ ...iS, resize: 'vertical' }}
            />
          </PF>
          <PF label="Viewpoint">
            <select
              value={currentView.viewpoint || ''}
              onChange={e => onUpdateView?.(currentView.id, 'viewpoint', e.target.value || undefined)}
              style={iS}
            >
              <option value="">None</option>
              {VIEWPOINTS.map(viewpoint => (
                <option key={viewpoint.id} value={viewpoint.id}>{viewpoint.label}</option>
              ))}
            </select>
          </PF>
          {currentView.viewpoint && getViewpointDefinition(currentView.viewpoint) && (
            <div style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', lineHeight: 1.5, padding: '0 2px', fontStyle: 'italic', fontWeight: 400 }}>
              {getViewpointDefinition(currentView.viewpoint)?.description}
            </div>
          )}
          <PF label="Purpose">
            <textarea
              value={currentView.purpose || ''}
              onChange={e => onUpdateView?.(currentView.id, 'purpose', e.target.value)}
              rows={2}
              style={{ ...iS, resize: 'vertical' }}
            />
          </PF>
          <PF label="Properties">
            <PropertyListEditor
              properties={currentView.properties}
              onChange={properties => onUpdateView?.(currentView.id, 'properties', properties)}
            />
          </PF>
          {onMoveViewToFolder && viewFolderPath !== undefined && (
            <PF label="Folder">
              <FolderPathEditor
                value={viewFolderPath}
                onCommit={onMoveViewToFolder}
                placeholder="views/landscape"
              />
            </PF>
          )}
          <PF label="Elements">
            <span style={{ fontSize: 12, color: 'var(--text-secondary, #555)', fontWeight: 400 }}>{currentView.elementIds?.length ?? 0}</span>
          </PF>
          {(currentView.childViewIds?.length ?? 0) > 0 && (
            <PF label="Child Views">
              <span style={{ fontSize: 12, color: 'var(--text-secondary, #555)', fontWeight: 400 }}>{currentView.childViewIds.length}</span>
            </PF>
          )}
        </div>
      ) : (
        <div style={{ padding: '12px', color: 'var(--text-faint, #b0b0b8)', fontSize: 12, lineHeight: 1.8, fontWeight: 400 }}>Select an element or relationship.</div>
      )}
    </div>
  );
}
