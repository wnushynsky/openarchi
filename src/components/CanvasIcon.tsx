import { useRef, useEffect } from 'react';
import { ICON_MAP, drawIcon } from '../core';

interface CanvasIconProps {
  type: string;
  size?: number;
  color?: string;
}

export function CanvasIcon({ type, size = 18, color = '#666' }: CanvasIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const iconKey = ICON_MAP[type] || 'generic';
    drawIcon(ctx, iconKey, size / 2, size / 2, size * 0.88, color);
  }, [type, size, color]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, flexShrink: 0 }} />;
}
