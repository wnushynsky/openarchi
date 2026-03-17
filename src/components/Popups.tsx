import { useState } from 'react';
import type { ModelElement, ModelView, CtxMenuItem } from '../types';
import { RELATIONSHIP_TYPES, ELEMENT_TYPES, LAYERS, FONT } from '../core';
import { CanvasIcon } from './CanvasIcon';

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
      style={{ position: 'absolute', left: x, top: y, zIndex: 200, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: '4px 0', width: 250, fontFamily: FONT }}
      onMouseDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <div style={{ padding: '7px 14px', fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        Relationship
      </div>
      {Object.entries(RELATIONSHIP_TYPES).map(([k, v]) => (
        <button
          key={k}
          onClick={() => onSelect(k)}
          style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#444', fontFamily: 'inherit', textAlign: 'left' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 22, color: '#999', fontSize: 12, textAlign: 'center', flexShrink: 0 }}>{v.dash ? '\u2504\u25B8' : '\u2500\u25B8'}</span>
          <span style={{ fontWeight: 500 }}>{v.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{v.desc}</span>
        </button>
      ))}
      <div style={{ borderTop: '1px solid rgba(0,0,0,0.05)', padding: '3px 0' }}>
        <button onClick={onCancel} style={{ width: '100%', padding: '6px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#999', fontFamily: 'inherit', fontWeight: 500 }}>
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
  const hasChildren = item.children && item.children.length > 0;

  if (item.separator) {
    return <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '3px 0' }} />;
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
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 14px',
          border: 'none', background: 'transparent', cursor: item.action || hasChildren ? 'pointer' : 'default',
          fontSize: 13, color: '#555', fontFamily: 'inherit', textAlign: 'left', fontWeight: 400,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {item.icon && <CanvasIcon type={item.icon} size={18} color={item.iconColor || '#888'} />}
        <span style={{ flex: 1 }}>{item.label}</span>
        {hasChildren && <span style={{ fontSize: 10, color: '#bbb', marginLeft: 4 }}>{'\u25B6'}</span>}
      </button>

      {hasChildren && subOpen && (
        <div style={{
          position: 'absolute', left: '100%', top: -3, zIndex: 210,
          background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,0.1)', padding: '3px 0',
          minWidth: 200, maxHeight: 340, overflowY: 'auto',
          fontFamily: FONT,
        }}>
          {item.children!.map((child, j) => (
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
      style={{ position: 'absolute', left: x, top: y, zIndex: 200, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.1)', padding: '3px 0', minWidth: 190, fontFamily: FONT }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <CtxMenuItemRow key={i} item={item} onClose={onClose} />
      ))}
    </div>
  );
}

// ============================================================
// Search panel
// ============================================================

interface SearchPanelProps {
  elements: ModelElement[];
  views: ModelView[];
  onSelectElement: (id: string) => void;
  onSelectView: (id: string) => void;
  onClose: () => void;
}

export function SearchPanel({ elements, views, onSelectElement, onSelectView, onClose }: SearchPanelProps) {
  const [q, setQ] = useState('');
  const lq = q.toLowerCase();

  const matchEls = q
    ? elements.filter(e => e.name?.toLowerCase().includes(lq) || ELEMENT_TYPES[e.type]?.label.toLowerCase().includes(lq) || e.documentation?.toLowerCase().includes(lq)).slice(0, 12)
    : [];
  const matchViews = q ? views.filter(v => v.name.toLowerCase().includes(lq)).slice(0, 6) : [];

  return (
    <div
      style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 300, width: 420, background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', fontFamily: FONT, overflow: 'hidden' }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid rgba(0,0,0,0.05)', gap: 8 }}>
        <span style={{ color: '#bbb', fontSize: 16 }}>{'\u2315'}</span>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search elements, views..."
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: '#1a1a1a', background: 'transparent' }}
          onKeyDown={e => e.key === 'Escape' && onClose()}
        />
        <span style={{ fontSize: 10, color: '#bbb', padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(0,0,0,0.08)', fontWeight: 500 }}>ESC</span>
      </div>
      {q && (
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {matchViews.length > 0 && (
            <div>
              <div style={{ padding: '7px 14px', fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Views</div>
              {matchViews.map(v => (
                <button
                  key={v.id}
                  onClick={() => { onSelectView(v.id); onClose(); }}
                  style={{ display: 'block', width: '100%', padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#444', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
          {matchEls.length > 0 && (
            <div>
              <div style={{ padding: '7px 14px', fontSize: 10, fontWeight: 500, color: '#999', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Elements</div>
              {matchEls.map(el => (
                <button
                  key={el.id}
                  onClick={() => { onSelectElement(el.id); onClose(); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#444', fontFamily: 'inherit', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: LAYERS[ELEMENT_TYPES[el.type]?.layer]?.fill || '#eee', border: `1.5px solid ${LAYERS[ELEMENT_TYPES[el.type]?.layer]?.stroke || '#ccc'}`, flexShrink: 0 }} />
                  <span style={{ fontWeight: 500 }}>{el.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#aaa' }}>{ELEMENT_TYPES[el.type]?.label}</span>
                </button>
              ))}
            </div>
          )}
          {!matchEls.length && !matchViews.length && (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: '#bbb', fontSize: 13 }}>No results</div>
          )}
        </div>
      )}
    </div>
  );
}
