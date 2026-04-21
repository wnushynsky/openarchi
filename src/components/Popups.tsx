import { useState } from 'react';
import type { ModelElement, ModelRelationship, ModelView, CtxMenuItem, RelationshipTypeDef } from '../types';
import { RELATIONSHIP_TYPES, ELEMENT_TYPES, LAYERS, FONT } from '../core';
import { CanvasIcon } from './CanvasIcon';

/** Mini SVG preview of a relationship line + arrowhead, matching the actual rendered style */
function RelArrowPreview({ def }: { def: RelationshipTypeDef }) {
  const w = 36, h = 14, mx = w - 4, my = h / 2;
  const col = '#666';
  const dash = def.dash ? (def.dashPattern ? def.dashPattern.join(',') : '6,3') : undefined;

  let srcDeco: React.ReactNode = null;
  let tgtDeco: React.ReactNode = null;
  let lineStart = 4;
  let lineEnd = mx;

  // Source decorations
  if (def.head === 'diamond_filled' || def.head === 'diamond') {
    const dw = 4, dh = 3;
    srcDeco = <polygon points={`4,${my} ${4+dw},${my-dh} ${4+dw*2},${my} ${4+dw},${my+dh}`} fill={def.head === 'diamond_filled' ? col : '#fff'} stroke={col} strokeWidth="1" />;
    lineStart = 4 + dw * 2;
  } else if (def.head === 'filled_dot') {
    srcDeco = <circle cx="7" cy={my} r="2.5" fill={col} />;
    lineStart = 10;
  }

  // Target decorations
  if (def.head === 'filled_arrow') {
    tgtDeco = <polygon points={`${mx},${my} ${mx-7},${my-4} ${mx-7},${my+4}`} fill={col} stroke="none" />;
    lineEnd = mx - 7;
  } else if (def.head === 'open_arrow') {
    tgtDeco = <polyline points={`${mx-7},${my-4} ${mx},${my} ${mx-7},${my+4}`} fill="none" stroke={col} strokeWidth="1.2" />;
    lineEnd = mx - 2;
  } else if (def.head === 'hollow_arrow') {
    tgtDeco = <polygon points={`${mx},${my} ${mx-7},${my-4} ${mx-7},${my+4}`} fill="#fff" stroke={col} strokeWidth="1" />;
    lineEnd = mx - 7;
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ flexShrink: 0 }}>
      <line x1={lineStart} y1={my} x2={lineEnd} y2={my} stroke={col} strokeWidth="1.2" strokeDasharray={dash} />
      {srcDeco}
      {tgtDeco}
    </svg>
  );
}

// Shared glass surface
const glassPanel: React.CSSProperties = {
  background: 'var(--glass-strong, rgba(255,255,255,0.92))',
  backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
  WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
  border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
};

const itemHover = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))';
};
const itemUnhover = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = 'transparent';
};

// ============================================================
// Relationship picker (shown after connecting two elements)
// ============================================================

interface RelPickerProps {
  x: number;
  y: number;
  onSelect: (type: string) => void;
  onCancel: () => void;
}

export function RelPicker({ x, y, onSelect, onCancel }: RelPickerProps) {
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, zIndex: 200,
        ...glassPanel,
        borderRadius: 10,
        boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.10))',
        padding: '4px 0', width: 240, fontFamily: FONT,
      }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <div style={{
        padding: '6px 14px', fontSize: 10, fontWeight: 500,
        color: 'var(--text-faint, #b0b0b8)',
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>
        Relationship
      </div>
      {Object.entries(RELATIONSHIP_TYPES).map(([k, v]) => (
        <button
          key={k}
          onClick={() => onSelect(k)}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            width: '100%', padding: '5px 14px', border: 'none',
            background: 'transparent', cursor: 'pointer',
            fontSize: 13, color: 'var(--text-secondary, #555)',
            fontFamily: 'inherit', textAlign: 'left',
            borderRadius: 4, margin: '0 2px', boxSizing: 'border-box',
            transition: 'background var(--transition-fast, 0.12s ease)',
          }}
          onMouseEnter={itemHover}
          onMouseLeave={itemUnhover}
        >
          <RelArrowPreview def={v} />
          <span style={{ fontWeight: 500 }}>{v.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint, #b0b0b8)' }}>{v.desc}</span>
        </button>
      ))}
      <div style={{ borderTop: '1px solid var(--border, rgba(0,0,0,0.06))', padding: '2px 0', margin: '2px 8px 0' }}>
        <button onClick={onCancel} style={{
          width: '100%', padding: '5px 6px', border: 'none',
          background: 'transparent', cursor: 'pointer',
          fontSize: 12, color: 'var(--text-muted, #8a8a90)',
          fontFamily: 'inherit', fontWeight: 500, borderRadius: 4,
          transition: 'background var(--transition-fast, 0.12s ease)',
        }}
          onMouseEnter={itemHover} onMouseLeave={itemUnhover}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Context menu (right-click)
// ============================================================

interface CtxMenuProps {
  x: number;
  y: number;
  items: CtxMenuItem[];
  onClose: () => void;
}

function CtxMenuItemRow({ item, onClose }: { item: CtxMenuItem; onClose: () => void }) {
  const [subOpen, setSubOpen] = useState(false);
  const children = item.children ?? [];
  const hasChildren = children.length > 0;

  if (item.separator) {
    return <div style={{ height: 1, background: 'var(--border, rgba(0,0,0,0.06))', margin: '3px 8px' }} />;
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => hasChildren && setSubOpen(true)}
      onMouseLeave={() => hasChildren && setSubOpen(false)}
    >
      <button
        onClick={() => { if (item.action) { item.action(); onClose(); } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 12px',
          border: 'none', background: 'transparent',
          cursor: item.action || hasChildren ? 'pointer' : 'default',
          fontSize: 13, color: item.color || 'var(--text-secondary, #555)', fontFamily: 'inherit',
          textAlign: 'left', fontWeight: 400, borderRadius: 4,
          transition: 'background var(--transition-fast, 0.12s ease)',
        }}
        onMouseEnter={itemHover}
        onMouseLeave={itemUnhover}
      >
        {item.icon && <CanvasIcon type={item.icon} size={20} color={item.iconColor || '#666'} />}
        <span style={{ flex: 1 }}>{item.label}</span>
        {hasChildren && <span style={{ fontSize: 9, color: 'var(--text-faint, #b0b0b8)', marginLeft: 4 }}>{'\u25B6'}</span>}
      </button>

      {hasChildren && subOpen && (
        <div style={{
          position: 'absolute', left: '100%', top: -3, zIndex: 210,
          ...glassPanel,
          borderRadius: 8,
          boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
          padding: '3px 0',
          minWidth: 200, maxHeight: 340, overflowY: 'auto',
          fontFamily: FONT,
        }}>
          {children.map((child, j) => (
            <CtxMenuItemRow key={j} item={child} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CtxMenu({ x, y, items, onClose }: CtxMenuProps) {
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, zIndex: 200,
        ...glassPanel,
        borderRadius: 8,
        boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
        padding: '3px 0', minWidth: 190, fontFamily: FONT,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <CtxMenuItemRow key={i} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

// ============================================================
// Search panel — command palette style
// ============================================================

interface SearchPanelProps {
  elements: ModelElement[];
  relationships: ModelRelationship[];
  views: ModelView[];
  onSelectElement: (id: string) => void;
  onSelectRelationship: (id: string) => void;
  onSelectView: (id: string) => void;
  onClose: () => void;
}

export function SearchPanel({ elements, relationships, views, onSelectElement, onSelectRelationship, onSelectView, onClose }: SearchPanelProps) {
  const [q, setQ] = useState('');
  const lq = q.toLowerCase();

  const matchEls = q
    ? elements.filter(e => e.name?.toLowerCase().includes(lq) || ELEMENT_TYPES[e.type]?.label.toLowerCase().includes(lq) || e.documentation?.toLowerCase().includes(lq)).slice(0, 12)
    : [];
  const matchRels = q
    ? relationships.filter(r => {
      const typeDef = RELATIONSHIP_TYPES[r.type];
      const srcName = elements.find(e => e.id === r.sourceId)?.name || '';
      const tgtName = elements.find(e => e.id === r.targetId)?.name || '';
      const label = r.name || `${srcName} → ${tgtName}`;
      return label.toLowerCase().includes(lq) || typeDef?.label.toLowerCase().includes(lq) || r.documentation?.toLowerCase().includes(lq);
    }).slice(0, 8)
    : [];
  const matchViews = q ? views.filter(v => v.name.toLowerCase().includes(lq)).slice(0, 6) : [];

  return (
    <div
      style={{
        position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
        zIndex: 300, width: 440,
        ...glassPanel,
        borderRadius: 12,
        boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.10)), 0 0 0 1px var(--border, rgba(0,0,0,0.06))',
        fontFamily: FONT, overflow: 'hidden',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))', gap: 8,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="7" cy="7" r="4.5" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.3" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search elements, views..."
          style={{
            flex: 1, border: 'none', outline: 'none', fontSize: 14,
            fontFamily: 'inherit', color: 'var(--text-primary, #1a1a1a)',
            background: 'transparent', fontWeight: 400,
          }}
          onKeyDown={e => e.key === 'Escape' && onClose()}
        />
        <span style={{
          fontSize: 10, color: 'var(--text-faint, #b0b0b8)',
          padding: '2px 5px', borderRadius: 4,
          border: '1px solid var(--border, rgba(0,0,0,0.06))',
          fontWeight: 500, lineHeight: 1.4,
        }}>ESC</span>
      </div>
      {q && (
        <div style={{ maxHeight: 340, overflow: 'auto', padding: '2px 0' }}>
          {matchViews.length > 0 && (
            <div>
              <div style={{
                padding: '8px 14px 4px', fontSize: 10, fontWeight: 500,
                color: 'var(--text-faint, #b0b0b8)',
                textTransform: 'uppercase', letterSpacing: '0.4px',
              }}>Views</div>
              {matchViews.map(v => (
                <button
                  key={v.id}
                  onClick={() => { onSelectView(v.id); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 14px', border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    fontSize: 13, color: 'var(--text-secondary, #555)',
                    fontFamily: 'inherit', textAlign: 'left', borderRadius: 4,
                    transition: 'background var(--transition-fast, 0.12s ease)',
                  }}
                  onMouseEnter={itemHover}
                  onMouseLeave={itemUnhover}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                    <rect x="1.5" y="3" width="11" height="8.5" rx="1" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" />
                    <path d="M1.5 3h4l1.5 -1.5h4a1 1 0 011 1V3" stroke="var(--text-faint, #b0b0b8)" strokeWidth="1.2" strokeLinejoin="round" />
                  </svg>
                  {v.name}
                </button>
              ))}
            </div>
          )}
          {matchEls.length > 0 && (
            <div>
              <div style={{
                padding: '8px 14px 4px', fontSize: 10, fontWeight: 500,
                color: 'var(--text-faint, #b0b0b8)',
                textTransform: 'uppercase', letterSpacing: '0.4px',
              }}>Elements</div>
              {matchEls.map(el => (
                <button
                  key={el.id}
                  onClick={() => { onSelectElement(el.id); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '6px 14px', border: 'none',
                    background: 'transparent', cursor: 'pointer',
                    fontSize: 13, color: 'var(--text-secondary, #555)',
                    fontFamily: 'inherit', textAlign: 'left', borderRadius: 4,
                    transition: 'background var(--transition-fast, 0.12s ease)',
                  }}
                  onMouseEnter={itemHover}
                  onMouseLeave={itemUnhover}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: LAYERS[ELEMENT_TYPES[el.type]?.layer]?.fill || '#eee',
                    border: `1.5px solid ${LAYERS[ELEMENT_TYPES[el.type]?.layer]?.stroke || '#ccc'}`,
                  }} />
                  <span style={{ fontWeight: 500 }}>{el.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint, #b0b0b8)' }}>{ELEMENT_TYPES[el.type]?.label}</span>
                </button>
              ))}
            </div>
          )}
          {matchRels.length > 0 && (
            <div>
              <div style={{
                padding: '8px 14px 4px', fontSize: 10, fontWeight: 500,
                color: 'var(--text-faint, #b0b0b8)',
                textTransform: 'uppercase', letterSpacing: '0.4px',
              }}>Relationships</div>
              {matchRels.map(r => {
                const srcName = elements.find(e => e.id === r.sourceId)?.name || '?';
                const tgtName = elements.find(e => e.id === r.targetId)?.name || '?';
                const typeDef = RELATIONSHIP_TYPES[r.type];
                return (
                  <button
                    key={r.id}
                    onClick={() => { onSelectRelationship(r.id); onClose(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '6px 14px', border: 'none',
                      background: 'transparent', cursor: 'pointer',
                      fontSize: 13, color: 'var(--text-secondary, #555)',
                      fontFamily: 'inherit', textAlign: 'left', borderRadius: 4,
                      transition: 'background var(--transition-fast, 0.12s ease)',
                    }}
                    onMouseEnter={itemHover}
                    onMouseLeave={itemUnhover}
                  >
                    <span style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', flexShrink: 0 }}>{'→'}</span>
                    <span style={{ fontWeight: 500 }}>{r.name || `${srcName} → ${tgtName}`}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint, #b0b0b8)' }}>{typeDef?.label || r.type}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!matchEls.length && !matchRels.length && !matchViews.length && (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--text-faint, #b0b0b8)', fontSize: 13 }}>No results</div>
          )}
        </div>
      )}
    </div>
  );
}
