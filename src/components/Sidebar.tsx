import type { ModelView, ModelElement, ModelRelationship, SelectionType } from '../types';
import { LAYERS, ELEMENT_TYPES, RELATIONSHIP_TYPES, FONT } from '../core';
import { CanvasIcon } from './CanvasIcon';

const iS: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
  background: '#fafafa', color: '#2a2a2a', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  fontWeight: 400,
};

function PF({ label, children, c }: { label: string; children: React.ReactNode; c?: boolean }) {
  return (
    <div style={{ flex: c ? 1 : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: '#a0a0a0', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
      {children}
    </div>
  );
}

// ============================================================
// View navigator
// ============================================================

interface ViewNavProps {
  views: ModelView[];
  currentViewId: string;
  onNavigate: (id: string) => void;
}

export function ViewNav({ views, currentViewId, onNavigate }: ViewNavProps) {
  const current = views.find(v => v.id === currentViewId);
  if (!current) return null;

  const parents = views.filter(v => (v.childViewIds || []).includes(currentViewId));
  const children = views.filter(v => (current.childViewIds || []).includes(v.id));
  const currentElIds = new Set(current.elementIds || []);
  const related = views.filter(v => v.id !== currentViewId && (v.elementIds || []).some(eid => currentElIds.has(eid)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: FONT }}>
      <div style={{ padding: '14px 14px 7px', fontSize: 11, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Views</div>

      {parents.length > 0 && (
        <div style={{ padding: '0 14px 6px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {parents.map(p => (
            <button key={p.id} onClick={() => onNavigate(p.id)} style={{ fontSize: 12, color: '#999', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', padding: 0, fontWeight: 400 }}>{p.name}</button>
          ))}
          <span style={{ fontSize: 10, color: '#ccc' }}>{'\u203A'}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#555' }}>{current.name}</span>
        </div>
      )}

      <div style={{ padding: '6px 12px', margin: '0 10px', background: 'var(--accent-bg, #eef2ff)', borderRadius: 6, fontSize: 14, fontWeight: 500, color: 'var(--accent-text, #1d4ed8)' }}>{current.name}</div>

      {children.length > 0 && (
        <div style={{ padding: '8px 14px 4px' }}>
          <div style={{ fontSize: 11, color: '#aaa', fontWeight: 500, marginBottom: 4 }}>Sub-views</div>
          {children.map(c => (
            <button key={c.id} onClick={() => onNavigate(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#606060', fontFamily: 'inherit', textAlign: 'left', fontWeight: 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ color: '#ccc' }}>{'\u21B3'}</span> {c.name}
            </button>
          ))}
        </div>
      )}

      {related.length > 0 && (
        <div style={{ padding: '8px 14px 4px' }}>
          <div style={{ fontSize: 11, color: '#aaa', fontWeight: 500, marginBottom: 4 }}>Related</div>
          {related.map(r => (
            <button key={r.id} onClick={() => onNavigate(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 10px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#606060', fontFamily: 'inherit', textAlign: 'left', fontWeight: 400 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ color: '#ccc' }}>{'\u2194'}</span> {r.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: '8px 14px 4px', marginTop: 6, borderTop: '1px solid rgba(0,0,0,0.05)' }}>
        <div style={{ fontSize: 11, color: '#aaa', fontWeight: 500, marginBottom: 4 }}>All views</div>
        <div style={{ maxHeight: 220, overflow: 'auto' }}>
          {views.map(v => (
            <button key={v.id} onClick={() => onNavigate(v.id)} style={{ display: 'block', width: '100%', padding: '6px 10px', borderRadius: 6, border: 'none', background: v.id === currentViewId ? 'var(--accent-bg, #eef2ff)' : 'transparent', cursor: 'pointer', fontSize: 13, color: v.id === currentViewId ? 'var(--accent-text, #1d4ed8)' : '#666', fontFamily: 'inherit', fontWeight: v.id === currentViewId ? 500 : 400, textAlign: 'left' }}
              onMouseEnter={e => { if (v.id !== currentViewId) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
              onMouseLeave={e => { if (v.id !== currentViewId) e.currentTarget.style.background = 'transparent'; }}>
              {v.name}
            </button>
          ))}
        </div>
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
      width: isRight ? undefined : undefined,
      background: 'transparent',
      ...(isRight ? { flex: 1 } : { borderTop: '1px solid rgba(0,0,0,0.05)' }),
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#a0a0a0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Properties</span>
        <button
          onClick={onToggleSide}
          title={isRight ? 'Move to left' : 'Move to right'}
          style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, cursor: 'pointer', fontSize: 11, color: '#aaa', padding: '1px 6px', lineHeight: 1.4, fontWeight: 400 }}
        >
          {isRight ? '\u25C0' : '\u25B6'}
        </button>
      </div>

      {selEl ? (
        <div style={{ padding: '5px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          <PF label={ELEMENT_TYPES[selEl.type]?.isNote ? 'Text' : 'Name'}>
            <textarea value={selEl.name} onChange={e => onUpdateElement('name', e.target.value)} rows={ELEMENT_TYPES[selEl.type]?.isNote ? 4 : 1} style={{ ...iS, resize: 'vertical' }} />
          </PF>
          {!ELEMENT_TYPES[selEl.type]?.isNote && (
            <>
              <PF label="Type">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <CanvasIcon type={selEl.type} size={18} color={LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.accent || '#888'} />
                  <select value={selEl.type} onChange={e => onUpdateElement('type', e.target.value)} style={{ ...iS, flex: 1 }}>
                    {Object.entries(ELEMENT_TYPES).filter(([, v]) => !v.isNote).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </PF>
              {ELEMENT_TYPES[selEl.type]?.desc && (
                <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.5, padding: '0 2px', fontStyle: 'italic', fontWeight: 400 }}>
                  {ELEMENT_TYPES[selEl.type].desc}
                </div>
              )}
              <PF label="Layer">
                <span style={{ fontSize: 13, fontWeight: 400, color: LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.text }}>{LAYERS[ELEMENT_TYPES[selEl.type]?.layer]?.label}</span>
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
        <div style={{ padding: '5px 14px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PF label="Label"><input value={selRel.name || ''} onChange={e => onUpdateRelationship('name', e.target.value)} style={iS} placeholder="Double-click arrow to edit" /></PF>
          <PF label="Type">
            <select value={selRel.type} onChange={e => onUpdateRelationship('type', e.target.value)} style={iS}>
              {Object.entries(RELATIONSHIP_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </PF>
          <PF label="Source"><span style={{ fontSize: 13, color: '#777', fontWeight: 400 }}>{elements.find(e => e.id === selRel.sourceId)?.name || '\u2014'}</span></PF>
          <PF label="Target"><span style={{ fontSize: 13, color: '#777', fontWeight: 400 }}>{elements.find(e => e.id === selRel.targetId)?.name || '\u2014'}</span></PF>
          <PF label="Waypoints"><span style={{ fontSize: 12, color: '#aaa', fontWeight: 400 }}>{selRel.waypoints?.length || 0} points</span></PF>
          <PF label="Label position"><input type="range" min="0" max="100" value={Math.round((selRel.labelPos ?? 0.5) * 100)} onChange={e => onUpdateRelationship('labelPos', +e.target.value / 100)} style={{ width: '100%' }} /></PF>
        </div>
      ) : (
        <div style={{ padding: '14px', color: '#bbb', fontSize: 13, lineHeight: 1.8, fontWeight: 400 }}>Select an element or relationship.</div>
      )}
    </div>
  );
}
