import { useState, useRef, useEffect } from 'react';
import { LAYERS, ELEMENT_TYPES, FONT } from '../core';
import { CanvasIcon } from './CanvasIcon';

// ============================================================
// SVG Icons — 18×18
// ============================================================

const I = ({ children }: { children: React.ReactNode }) => (
  <svg width="20" height="20" viewBox="0 0 18 18" fill="none">{children}</svg>
);

const NoteIcon = () => <I><path d="M3.5 2.5h8l3.5 3.5v9.5h-11.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M11.5 2.5v3.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></I>;
const GroupIcon = () => <I><rect x="3" y="3" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" /></I>;
const GridIcon = () => <I>{[5,9,13].map(x=>[5,9,13].map(y=><circle key={`${x}${y}`} cx={x} cy={y} r="1.1" fill="currentColor"/>))}</I>;
const SearchIcon = () => <I><circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.3" /><line x1="11.5" y1="11.5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></I>;
const MenuIcon = () => <I><line x1="3.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><line x1="3.5" y1="9" x2="14.5" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><line x1="3.5" y1="12.5" x2="14.5" y2="12.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></I>;
const DeleteIcon = () => <I><path d="M5.5 4.5V3.5a1.5 1.5 0 011.5-1.5h4a1.5 1.5 0 011.5 1.5v1" stroke="currentColor" strokeWidth="1.3" /><path d="M3 4.5h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M4.5 4.5l.7 10a1 1 0 001 .9h5.6a1 1 0 001-.9l.7-10" stroke="currentColor" strokeWidth="1.3" /></I>;

const LAYER_ORDER = ['strategy', 'business', 'application', 'technology', 'motivation', 'implementation', 'composite'] as const;

// ============================================================
// Element picker popover — opens from layer dot
// ============================================================

function ElementPicker({ layerKey, onAddElement, onClose }: { layerKey: string; onAddElement: (type: string) => void; onClose: () => void }) {
  const items = Object.entries(ELEMENT_TYPES).filter(([, d]) => d.layer === layerKey && !d.isNote);
  const L = LAYERS[layerKey];
  return (
    <div
      style={{
        position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
        marginBottom: 8,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(24px) saturate(1.8)', WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
        border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        padding: '10px 8px', width: 320, fontFamily: FONT, maxHeight: 400, overflow: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{ padding: '2px 8px 8px', fontSize: 11, fontWeight: 600, color: L?.text || '#666', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 9, height: 9, borderRadius: 3, background: L?.fill === 'transparent' ? '#e0e0e4' : L?.fill, border: `1.5px solid ${L?.stroke || '#ccc'}` }} />
        {L?.label || 'Elements'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        {items.map(([k, d]) => (
          <button key={k} onClick={() => { onAddElement(k); onClose(); }} title={d.desc || d.label}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#444', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden' }}
            onMouseEnter={e => { e.currentTarget.style.background = L?.fill === 'transparent' ? 'rgba(0,0,0,0.04)' : (L?.fill || 'rgba(0,0,0,0.04)'); }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <CanvasIcon type={k} size={20} color={L?.accent || '#888'} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// File menu popover
// ============================================================

function FileMenu({ onOpenDir, onImport, onExport, onSave, canSave, isDirty, dirState, dirFiles, activeFilePath, onSelectFile, ioFormatId, onFormatChange, modelFormats, onClose }: {
  onOpenDir: () => void; onImport: () => void; onExport: () => void; onSave: () => void;
  canSave: boolean; isDirty: boolean; dirState: boolean;
  dirFiles: { relativePath: string }[]; activeFilePath: string; onSelectFile: (p: string) => void;
  ioFormatId: string; onFormatChange: (id: string) => void; modelFormats: { id: string; label: string }[]; onClose: () => void;
}) {
  const Row = ({ label, shortcut, onClick }: { label: string; shortcut?: string; onClick: () => void }) => (
    <button onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '6px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: '#444' }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{label}</span>
      {shortcut && <span style={{ fontSize: 11, color: '#bbb', fontWeight: 500 }}>{shortcut}</span>}
    </button>
  );

  return (
    <div style={{
      position: 'absolute', bottom: '100%', right: 0, marginBottom: 8,
      background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(24px) saturate(1.8)', WebkitBackdropFilter: 'blur(24px) saturate(1.8)',
      border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      padding: '3px 0', width: 200, fontFamily: FONT,
    }} onMouseDown={e => e.stopPropagation()}>
      <Row label="Open Directory" onClick={() => { onOpenDir(); onClose(); }} />
      <Row label="Import" onClick={() => { onImport(); onClose(); }} />
      <Row label="Export" onClick={() => { onExport(); onClose(); }} />
      {canSave && <Row label={isDirty ? 'Save *' : 'Save'} shortcut={'\u2318S'} onClick={() => { onSave(); onClose(); }} />}
      {dirState && dirFiles.length > 1 && (<>
        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 0' }} />
        <div style={{ padding: '3px 12px', fontSize: 10, fontWeight: 500, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Files</div>
        <div style={{ maxHeight: 120, overflow: 'auto' }}>
          {dirFiles.map(f => (
            <button key={f.relativePath} onClick={() => { onSelectFile(f.relativePath); onClose(); }}
              style={{ display: 'block', width: '100%', padding: '4px 12px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left', background: f.relativePath === activeFilePath ? 'rgba(37,99,235,0.08)' : 'transparent', color: f.relativePath === activeFilePath ? '#1d4ed8' : '#666', fontWeight: f.relativePath === activeFilePath ? 500 : 400 }}
              onMouseEnter={e => { if (f.relativePath !== activeFilePath) e.currentTarget.style.background = 'rgba(0,0,0,0.03)'; }}
              onMouseLeave={e => { if (f.relativePath !== activeFilePath) e.currentTarget.style.background = 'transparent'; }}
            >{f.relativePath}</button>
          ))}
        </div>
      </>)}
      <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '2px 0' }} />
      <div style={{ padding: '4px 12px' }}>
        <select value={ioFormatId} onChange={e => onFormatChange(e.target.value)}
          style={{ width: '100%', padding: '4px 6px', borderRadius: 5, border: '1px solid rgba(0,0,0,0.1)', background: '#fff', fontFamily: 'inherit', fontSize: 12, color: '#555' }}>
          <option value="auto">Auto / JSON</option>
          {modelFormats.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
    </div>
  );
}

// ============================================================
// Main floating toolbar — single row
// ============================================================

export interface FloatingToolbarProps {
  activeLayer: string;
  onLayerChange: (layer: string) => void;
  onAddElement: (type: string) => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
  onOpenDir: () => void;
  onImport: () => void;
  onExport: () => void;
  onSave: () => void;
  canSave: boolean;
  isDirty: boolean;
  dirState: boolean;
  dirFiles: { relativePath: string }[];
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  ioFormatId: string;
  onFormatChange: (id: string) => void;
  modelFormats: { id: string; label: string }[];
  gridType: 'dot' | 'line';
  onToggleGrid: () => void;
  onSearch: () => void;
}

export function FloatingToolbar(props: FloatingToolbarProps) {
  const {
    activeLayer, onLayerChange, onAddElement, onDeleteSelected, hasSelection,
    onOpenDir, onImport, onExport, onSave, canSave, isDirty, dirState, dirFiles, activeFilePath, onSelectFile,
    ioFormatId, onFormatChange, modelFormats,
    gridType, onToggleGrid, onSearch,
  } = props;

  const [pickerLayer, setPickerLayer] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setPickerLayer(null);
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const close = () => { setPickerLayer(null); setShowMenu(false); };

  // Tool button color — softer than before
  const iconColor = '#8a8a90';
  const iconColorDisabled = '#cdcdd0';

  const tb = (active?: boolean, disabled?: boolean): React.CSSProperties => ({
    width: 38, height: 38, borderRadius: 9, border: 'none', padding: 0, flexShrink: 0,
    background: active ? 'rgba(0,0,0,0.08)' : 'transparent',
    color: disabled ? iconColorDisabled : active ? '#555' : iconColor,
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.1s, color 0.1s',
  });

  const hover = (e: React.MouseEvent, active?: boolean) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)';
  };
  const unhover = (e: React.MouseEvent, active?: boolean) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
  };

  const div = <div style={{ width: 1, height: 24, background: 'rgba(0,0,0,0.08)', margin: '0 4px', flexShrink: 0 }} />;

  return (
    <div ref={ref} style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 100, fontFamily: FONT }}>
      {/* Element picker — anchored to the layer dot that was clicked */}
      {pickerLayer && <ElementPicker layerKey={pickerLayer} onAddElement={(type) => { onLayerChange(pickerLayer); onAddElement(type); }} onClose={() => setPickerLayer(null)} />}
      {showMenu && <FileMenu onOpenDir={onOpenDir} onImport={onImport} onExport={onExport} onSave={onSave} canSave={canSave} isDirty={isDirty} dirState={dirState} dirFiles={dirFiles} activeFilePath={activeFilePath} onSelectFile={onSelectFile} ioFormatId={ioFormatId} onFormatChange={onFormatChange} modelFormats={modelFormats} onClose={() => setShowMenu(false)} />}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(245,246,248,0.82)',
        backdropFilter: 'blur(20px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 16,
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        padding: '6px 10px',
        height: 50,
      }}>
        {/* Layer dots — clicking opens element picker for that layer */}
        {LAYER_ORDER.map(k => {
          const L = LAYERS[k];
          const fill = L.fill === 'transparent' ? '#dddde0' : L.fill;
          const isOpen = pickerLayer === k;
          return (
            <button key={k}
              onClick={() => { setPickerLayer(prev => prev === k ? null : k); setShowMenu(false); }}
              title={L.label}
              style={{
                width: 26, height: 26, borderRadius: '50%', padding: 0, flexShrink: 0,
                background: fill,
                border: isOpen ? `2.5px solid ${L.stroke}` : `1.5px solid ${L.stroke}`,
                cursor: 'pointer',
                transition: 'transform 0.12s, border-color 0.12s',
                boxSizing: 'border-box',
                boxShadow: isOpen ? `0 0 0 2px ${L.accent}30` : 'none',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.18)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            />
          );
        })}

        {div}

        {/* Note */}
        <button onClick={() => { onAddElement('note'); close(); }} title="Note" style={tb()}
          onMouseEnter={e => hover(e)} onMouseLeave={e => unhover(e)}>
          <NoteIcon />
        </button>

        {/* Group */}
        <button onClick={() => { onAddElement('grouping'); close(); }} title="Group" style={tb()}
          onMouseEnter={e => hover(e)} onMouseLeave={e => unhover(e)}>
          <GroupIcon />
        </button>

        {div}

        {/* Grid */}
        <button onClick={() => { onToggleGrid(); close(); }} title={gridType === 'dot' ? 'Grid lines' : 'Dots'} style={tb()}
          onMouseEnter={e => hover(e)} onMouseLeave={e => unhover(e)}>
          <GridIcon />
        </button>

        {/* Search */}
        <button onClick={() => { onSearch(); close(); }} title="Search" style={tb()}
          onMouseEnter={e => hover(e)} onMouseLeave={e => unhover(e)}>
          <SearchIcon />
        </button>

        {div}

        {/* Delete */}
        <button onClick={() => { onDeleteSelected(); close(); }} title="Delete" disabled={!hasSelection} style={tb(false, !hasSelection)}
          onMouseEnter={e => { if (hasSelection) hover(e); }} onMouseLeave={e => { if (hasSelection) unhover(e); }}>
          <DeleteIcon />
        </button>

        {/* File menu */}
        <button onClick={() => { setShowMenu(v => !v); setPickerLayer(null); }} title="File" style={tb(showMenu)}
          onMouseEnter={e => hover(e, showMenu)} onMouseLeave={e => unhover(e, showMenu)}>
          <MenuIcon />
        </button>
      </div>
    </div>
  );
}
