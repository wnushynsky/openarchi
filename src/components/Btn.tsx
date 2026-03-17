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
        padding: '4px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 400,
        background: disabled ? 'transparent' : 'rgba(0,0,0,0.04)',
        color: disabled ? '#c0c0c4' : '#666',
        border: '1px solid rgba(0,0,0,0.08)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        letterSpacing: '-0.01em',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(0,0,0,0.07)'; }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
    >
      {children}
    </button>
  );
}
