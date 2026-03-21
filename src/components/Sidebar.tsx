import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ModelView, ModelElement, ModelRelationship, SelectionType } from '../types';
import { LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, FONT } from '../core';
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

// ============================================================
// View navigator — tree with search, breadcrumbs, element counts
// ============================================================

interface ViewNavProps {
  views: ModelView[];
  currentViewId: string;
  onNavigate: (id: string) => void;
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

function TreeNode({ view, depth, currentViewId, onNavigate, expanded, onToggle, viewById, searchQuery, elementCountById }: {
  view: ModelView;
  depth: number;
  currentViewId: string;
  onNavigate: (id: string) => void;
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
        onClick={() => onNavigate(view.id)}
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
          color: isCurrent ? 'var(--accent-text, #1d4ed8)' : 'var(--text-secondary, #555)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          lineHeight: '20px', paddingLeft: 2,
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
          currentViewId={currentViewId} onNavigate={onNavigate}
          expanded={expanded} onToggle={onToggle}
          viewById={viewById} searchQuery={searchQuery}
          elementCountById={elementCountById}
        />
      ))}
    </>
  );
}

export function ViewNav({ views, currentViewId, onNavigate }: ViewNavProps) {
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
        <span style={{ fontSize: 10, color: 'var(--text-faint, #b0b0b8)', fontWeight: 400, opacity: 0.7 }}>{views.length}</span>
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
            currentViewId={currentViewId} onNavigate={onNavigate}
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
  onUpdateElement: (key: string, value: unknown) => void;
  onUpdateRelationship: (key: string, value: unknown) => void;
  side: 'left' | 'right';
  onToggleSide: () => void;
}

export function PropertyPanel({ selEl, selRel, elements, onUpdateElement, onUpdateRelationship, side, onToggleSide }: PropertyPanelProps) {
  const isRight = side === 'right';
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
                  <CanvasIcon type={selEl.type} size={16} color={LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.accent || '#888'} />
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
          <PF label="Waypoints"><span style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', fontWeight: 400 }}>{selRel.waypoints?.length || 0} points</span></PF>
          <PF label="Label position"><input type="range" min="0" max="100" value={Math.round((selRel.labelPos ?? 0.5) * 100)} onChange={e => onUpdateRelationship('labelPos', +e.target.value / 100)} style={{ width: '100%', accentColor: 'var(--accent, #2563eb)' }} /></PF>
        </div>
      ) : (
        <div style={{ padding: '12px', color: 'var(--text-faint, #b0b0b8)', fontSize: 12, lineHeight: 1.8, fontWeight: 400 }}>Select an element or relationship.</div>
      )}
    </div>
  );
}
