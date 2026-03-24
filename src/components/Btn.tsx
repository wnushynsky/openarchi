interface BtnProps {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function Btn({ onClick, children, disabled }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '3px 8px',
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 450,
        background: 'transparent',
        color: disabled ? 'var(--text-faint, #b0b0b8)' : 'var(--text-muted, #8a8a90)',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        letterSpacing: '-0.01em',
        transition: 'background var(--transition-fast, 0.12s ease), color var(--transition-fast, 0.12s ease)',
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={e => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))';
          e.currentTarget.style.color = 'var(--text-secondary, #555)';
        }
      }}
      onMouseLeave={e => {
        if (!disabled) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-muted, #8a8a90)';
        }
      }}
      onMouseDown={e => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--surface-active, rgba(0,0,0,0.06))';
        }
      }}
      onMouseUp={e => {
        if (!disabled) {
          e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.035))';
        }
      }}
    >
      {children}
    </button>
  );
}
