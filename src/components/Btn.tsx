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
        background: disabled ? 'transparent' : 'transparent',
        color: disabled ? '#cdcdd0' : '#8a8a90',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        lineHeight: '1.5',
        letterSpacing: '-0.01em',
        transition: 'background 0.1s, color 0.1s',
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'rgba(0,0,0,0.05)'; e.currentTarget.style.color = '#555'; } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#8a8a90'; } }}
    >
      {children}
    </button>
  );
}
