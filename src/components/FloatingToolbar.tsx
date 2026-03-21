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

// Shared glass popover style
const popoverGlass: React.CSSProperties = {
  background: 'var(--glass-strong, rgba(255,255,255,0.92))',
  backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
  WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))' as string,
  border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
  boxShadow: 'var(--shadow-xl, 0 8px 40px rgba(0,0,0,0.10))',
};

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
        marginBottom: 10,
        ...popoverGlass,
        borderRadius: 12,
        padding: '8px 6px', width: 300, fontFamily: FONT, maxHeight: 380, overflow: 'auto',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div style={{
        padding: '4px 8px 8px', fontSize: 10, fontWeight: 600, color: L?.text || '#666',
        textTransform: 'uppercase', letterSpacing: '0.5px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: 2,
          background: L?.fill === 'transparent' ? '#e0e0e4' : L?.fill,
          border: `1.5px solid ${L?.stroke || '#ccc'}`,
        }} />
        {L?.label || 'Elements'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        {items.map(([k, d]) => (
          <button key={k} onClick={() => { onAddElement(k); onClose(); }} title={d.desc || d.label}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px',
              borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text-secondary, #555)',
              textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden',
              transition: 'background var(--transition-fast, 0.12s ease)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = L?.fill === 'transparent' ? 'var(--surface-hover)' : (L?.fill || 'var(--surface-hover)'); }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <CanvasIcon type={k} size={20} color={L?.stroke || '#666'} />
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
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: '100%', padding: '6px 12px', border: 'none', background: 'transparent',
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--text-secondary, #555)',
        borderRadius: 4, margin: '0 2px', boxSizing: 'border-box',
        transition: 'background var(--transition-fast, 0.12s ease)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span>{label}</span>
      {shortcut && <span style={{ fontSize: 11, color: 'var(--text-faint, #b0b0b8)', fontWeight: 500, fontFamily: 'inherit' }}>{shortcut}</span>}
    </button>
  );

  return (
    <div style={{
      position: 'absolute', bottom: '100%', right: 0, marginBottom: 10,
      ...popoverGlass,
      borderRadius: 10, padding: '4px 2px', width: 200, fontFamily: FONT,
    }} onMouseDown={e => e.stopPropagation()}>
      <Row label="Open Directory" onClick={() => { onOpenDir(); onClose(); }} />
      <Row label="Import" onClick={() => { onImport(); onClose(); }} />
      <Row label="Export" onClick={() => { onExport(); onClose(); }} />
      {canSave && <Row label={isDirty ? 'Save *' : 'Save'} shortcut={'\u2318S'} onClick={() => { onSave(); onClose(); }} />}
      {dirState && dirFiles.length > 1 && (<>
        <div style={{ height: 1, background: 'var(--border, rgba(0,0,0,0.06))', margin: '3px 8px' }} />
        <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 500, color: 'var(--text-faint, #b0b0b8)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Files</div>
        <div style={{ maxHeight: 120, overflow: 'auto' }}>
          {dirFiles.map(f => (
            <button key={f.relativePath} onClick={() => { onSelectFile(f.relativePath); onClose(); }}
              style={{
                display: 'block', width: '100%', padding: '4px 12px', border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                background: f.relativePath === activeFilePath ? 'var(--surface-selected, rgba(37,99,235,0.07))' : 'transparent',
                color: f.relativePath === activeFilePath ? 'var(--accent-text, #1d4ed8)' : 'var(--text-secondary, #555)',
                fontWeight: f.relativePath === activeFilePath ? 500 : 400,
                borderRadius: 4,
                transition: 'background var(--transition-fast, 0.12s ease)',
              }}
              onMouseEnter={e => { if (f.relativePath !== activeFilePath) e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))'; }}
              onMouseLeave={e => { if (f.relativePath !== activeFilePath) e.currentTarget.style.background = 'transparent'; }}
            >{f.relativePath}</button>
          ))}
        </div>
      </>)}
      <div style={{ height: 1, background: 'var(--border, rgba(0,0,0,0.06))', margin: '3px 8px' }} />
      <div style={{ padding: '4px 10px' }}>
        <select value={ioFormatId} onChange={e => onFormatChange(e.target.value)}
          style={{
            width: '100%', padding: '4px 6px', borderRadius: 5,
            border: '1px solid var(--border, rgba(0,0,0,0.06))',
            background: 'var(--surface-solid, #fff)', fontFamily: 'inherit',
            fontSize: 12, color: 'var(--text-secondary, #555)',
          }}>
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

  const iconColor = 'var(--text-muted, #8a8a90)';
  const iconColorDisabled = 'var(--text-faint, #b0b0b8)';

  const tb = (active?: boolean, disabled?: boolean): React.CSSProperties => ({
    width: 36, height: 36, borderRadius: 8, border: 'none', padding: 0, flexShrink: 0,
    background: active ? 'var(--surface-active, rgba(0,0,0,0.06))' : 'transparent',
    color: disabled ? iconColorDisabled : active ? 'var(--text-secondary, #555)' : iconColor,
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background var(--transition-fast, 0.12s ease), color var(--transition-fast, 0.12s ease)',
    opacity: disabled ? 0.4 : 1,
  });

  const hover = (e: React.MouseEvent, active?: boolean) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover, rgba(0,0,0,0.035))';
  };
  const unhover = (e: React.MouseEvent, active?: boolean) => {
    if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
  };

  const div = <div style={{ width: 1, height: 20, background: 'var(--border, rgba(0,0,0,0.06))', margin: '0 3px', flexShrink: 0 }} />;

  return (
    <div ref={ref} style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', zIndex: 100, fontFamily: FONT }}>
      {pickerLayer && <ElementPicker layerKey={pickerLayer} onAddElement={(type) => { onLayerChange(pickerLayer); onAddElement(type); }} onClose={() => setPickerLayer(null)} />}
      {showMenu && <FileMenu onOpenDir={onOpenDir} onImport={onImport} onExport={onExport} onSave={onSave} canSave={canSave} isDirty={isDirty} dirState={dirState} dirFiles={dirFiles} activeFilePath={activeFilePath} onSelectFile={onSelectFile} ioFormatId={ioFormatId} onFormatChange={onFormatChange} modelFormats={modelFormats} onClose={() => setShowMenu(false)} />}

      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: 'var(--glass, rgba(255,255,255,0.82))',
        backdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))',
        WebkitBackdropFilter: 'var(--glass-blur, blur(20px) saturate(1.8))' as string,
        border: '1px solid var(--glass-border, rgba(255,255,255,0.55))',
        borderRadius: 14,
        boxShadow: 'var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.08))',
        padding: '5px 8px',
        height: 48,
      }}>
        {/* Layer dots */}
        {LAYER_ORDER.map(k => {
          const L = LAYERS[k];
          const fill = L.fill === 'transparent' ? '#dddde0' : L.fill;
          const isOpen = pickerLayer === k;
          return (
            <button key={k}
              onClick={() => { setPickerLayer(prev => prev === k ? null : k); setShowMenu(false); }}
              title={L.label}
              style={{
                width: 24, height: 24, borderRadius: '50%', padding: 0, flexShrink: 0,
                background: `radial-gradient(circle at 40% 35%, ${fill}, ${L.stroke}40)`,
                border: isOpen ? `2px solid ${L.stroke}` : `1.5px solid ${L.stroke}60`,
                cursor: 'pointer',
                transition: 'transform var(--transition-fast, 0.12s ease), border-color var(--transition-fast, 0.12s ease), box-shadow var(--transition-fast, 0.12s ease)',
                boxSizing: 'border-box',
                boxShadow: isOpen
                  ? `0 0 0 3px ${L.accent}20, inset 0 1px 2px rgba(255,255,255,0.4)`
                  : 'inset 0 1px 2px rgba(255,255,255,0.3)',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.15)'; e.currentTarget.style.borderColor = L.stroke; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; if (!isOpen) e.currentTarget.style.borderColor = `${L.stroke}60`; }}
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
