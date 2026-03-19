import { useRef, useEffect } from 'react';
import { ICONS, ICON_MAP } from '../core';

interface CanvasIconProps {
  type: string;
  size?: number;
  color?: string;
}

export function CanvasIcon({ type, size = 18, color = '#777' }: CanvasIconProps) {
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

    if (type === 'viewReference') {
      const box = size * 0.62;
      const left = (size - box) / 2;
      const top = (size - box) / 2;
      const right = left + box;
      const bottom = top + box;

      ctx.beginPath();
      ctx.rect(left, top, box, box);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(left + box * 0.35, bottom - box * 0.28);
      ctx.lineTo(right - box * 0.18, top + box * 0.18);
      ctx.moveTo(right - box * 0.45, top + box * 0.18);
      ctx.lineTo(right - box * 0.18, top + box * 0.18);
      ctx.lineTo(right - box * 0.18, top + box * 0.45);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }

    const iconKey = ICON_MAP[type] || 'generic';
    const drawFn = ICONS[iconKey] || ICONS.generic;
    ctx.beginPath();
    drawFn(ctx, size / 2, size / 2, size * 0.34);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }, [type, size, color]);

  return <canvas ref={canvasRef} style={{ width: size, height: size, flexShrink: 0 }} />;
}
