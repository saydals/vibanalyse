import React, { useRef, useEffect, useMemo } from 'react';
import { BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';

interface TimeDomainViewProps {
  log: BlackboxLog;
  selectedWindow: { start: number; end: number };
  onWindowChange: (window: { start: number; end: number }) => void;
  currentTimeSec: number;
  onTimeChange: (time: number) => void;
}

export const TimeDomainView: React.FC<TimeDomainViewProps> = ({
  log,
  selectedWindow,
  onWindowChange,
  currentTimeSec,
  onTimeChange,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingStart = useRef(false);
  const isDraggingEnd = useRef(false);
  const isScrubbing = useRef(false);

  // 타임라인은 자이로만 표시

  // Downsample for ultra-fast 60fps canvas rendering (자이로만)
  const downsampledData = useMemo(() => {
    const targetPoints = 800;
    const total = log.time.length;
    const step = Math.max(1, Math.floor(total / targetPoints));
    const count = Math.floor(total / step);

    const times = new Float32Array(count);
    const r = new Float32Array(count);
    const p = new Float32Array(count);
    const y = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const idx = i * step;
      times[i] = log.time[idx];
      r[i] = log.gyro.roll[idx];
      p[i] = log.gyro.pitch[idx];
      y[i] = log.gyro.yaw[idx];
    }

    return { times, r, p, y, count };
  }, [log]);

  // Render Time Series Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);

    const padLeft = 40;
    const padRight = 16;
    const padTop = 14;
    const padBottom = 22;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    ctx.fillStyle = isDark ? '#060911' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    const dur = log.durationSec || 1;

    // Background Highlight for Selected Analysis Window
    const selStartX = padLeft + (selectedWindow.start / dur) * plotW;
    const selEndX = padLeft + (selectedWindow.end / dur) * plotW;

    ctx.fillStyle = isDark ? 'rgba(6, 182, 212, 0.12)' : 'rgba(6, 182, 212, 0.18)';
    ctx.fillRect(selStartX, padTop, Math.max(2, selEndX - selStartX), plotH);

    // Grid
    ctx.strokeStyle = isDark ? '#1e293b' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.fillStyle = isDark ? '#64748b' : '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';

    const numTimeSteps = 6;
    for (let i = 0; i <= numTimeSteps; i++) {
      const t = (dur / numTimeSteps) * i;
      const x = padLeft + (t / dur) * plotW;

      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      ctx.fillText(`${t.toFixed(1)}s`, x, padTop + plotH + 14);
    }

    // Zero baseline
    const zeroY = padTop + plotH / 2;
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)';
    ctx.beginPath();
    ctx.moveTo(padLeft, zeroY);
    ctx.lineTo(padLeft + plotW, zeroY);
    ctx.stroke();

    // Draw signals (자이로만)
    const { times, r, p, y, count } = downsampledData;

    const drawLine = (data: Float32Array, color: string, scale: number, yOffset: number = zeroY) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();

      for (let i = 0; i < count; i++) {
        const x = padLeft + (times[i] / dur) * plotW;
        const valY = yOffset - data[i] * scale;
        if (i === 0) ctx.moveTo(x, valY);
        else ctx.lineTo(x, valY);
      }
      ctx.stroke();
    };

    // Draw signals (자이로만)
    const gyroScale = plotH / 180; // +/- 90 deg/s range
    drawLine(r, '#38bdf8', gyroScale);
    drawLine(p, '#f59e0b', gyroScale);
    drawLine(y, '#10b981', gyroScale);

    // Selected Window Borders (Draggable handles)
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(selStartX, padTop);
    ctx.lineTo(selStartX, padTop + plotH);
    ctx.moveTo(selEndX, padTop);
    ctx.lineTo(selEndX, padTop + plotH);
    ctx.stroke();

    // Window Handles
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(selStartX - 3, padTop, 6, 12);
    ctx.fillRect(selEndX - 3, padTop, 6, 12);

    // Current Time Playhead
    if (currentTimeSec >= 0 && currentTimeSec <= dur) {
      const playX = padLeft + (currentTimeSec / dur) * plotW;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playX, padTop);
      ctx.lineTo(playX, padTop + plotH);
      ctx.stroke();
    }
  }, [downsampledData, selectedWindow, currentTimeSec, log.durationSec, isDark]);

  // Pointer interactions for scrub & window dragging
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 40;
    const plotW = rect.width - padLeft - 16;
    const dur = log.durationSec || 1;

    const selStartX = padLeft + (selectedWindow.start / dur) * plotW;
    const selEndX = padLeft + (selectedWindow.end / dur) * plotW;

    if (Math.abs(x - selStartX) < 14) {
      isDraggingStart.current = true;
    } else if (Math.abs(x - selEndX) < 14) {
      isDraggingEnd.current = true;
    } else {
      // Scrub time (1초 단위로 스냅)
      isScrubbing.current = true;
      const clickedTime = Math.max(0, Math.min(dur, Math.round(((x - padLeft) / plotW) * dur)));
      onTimeChange(clickedTime);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingStart.current && !isDraggingEnd.current && !isScrubbing.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const padLeft = 40;
    const plotW = rect.width - padLeft - 16;
    const dur = log.durationSec || 1;
    const targetT = Math.max(0, Math.min(dur, Math.round(((x - padLeft) / plotW) * dur)));

    if (isDraggingStart.current) {
      onWindowChange({
        start: Math.min(targetT, selectedWindow.end - 0.5),
        end: selectedWindow.end,
      });
    } else if (isDraggingEnd.current) {
      onWindowChange({
        start: selectedWindow.start,
        end: Math.max(targetT, selectedWindow.start + 0.5),
      });
    } else if (isScrubbing.current) {
      onTimeChange(Math.round(targetT));
    }
  };

  const handlePointerUp = () => {
    isDraggingStart.current = false;
    isDraggingEnd.current = false;
    isScrubbing.current = false;
  };

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm flex flex-col gap-3 transition-colors ${
        isDark ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      {/* View Header */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2 pb-2 border-b ${
          isDark ? 'border-slate-800/80' : 'border-slate-100'
        }`}
      >
        <div className="flex items-center gap-2">
          <div>
            <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              비행 타임라인 & FFT 분석 구간 선택
            </h3>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={`relative w-full h-36 rounded-xl overflow-hidden cursor-ew-resize border select-none transition-colors ${
          isDark ? 'bg-slate-950 border-slate-800/80' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full h-full block touch-none"
        />
      </div>
    </div>
  );
};
