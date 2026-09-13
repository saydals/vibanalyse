import React, { useRef, useEffect, useState, useMemo } from 'react';
import { BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';
import { Gauge, Play, Pause, RotateCcw } from 'lucide-react';
import type { SelectionRpm } from '../utils/rpmEstimator';

interface TimeDomainViewProps {
  log: BlackboxLog;
  selectedWindow: { start: number; end: number };
  onWindowChange: (window: { start: number; end: number }) => void;
  currentTimeSec: number;
  onTimeChange: (time: number) => void;
  selectionRpm?: SelectionRpm;
}

export const TimeDomainView: React.FC<TimeDomainViewProps> = ({
  log,
  selectedWindow,
  onWindowChange,
  currentTimeSec,
  onTimeChange,
  selectionRpm,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingStart = useRef(false);
  const isDraggingEnd = useRef(false);
  const isScrubbing = useRef(false);

  const [activeSignal, setActiveSignal] = useState<'gyro' | 'acc' | 'throttleRpm'>('gyro');

  // Downsample for ultra-fast 60fps canvas rendering
  const downsampledData = useMemo(() => {
    const targetPoints = 800;
    const total = log.time.length;
    const step = Math.max(1, Math.floor(total / targetPoints));
    const count = Math.floor(total / step);

    const times = new Float32Array(count);
    const r = new Float32Array(count);
    const p = new Float32Array(count);
    const y = new Float32Array(count);
    const ax = new Float32Array(count);
    const ay = new Float32Array(count);
    const az = new Float32Array(count);
    const thr = log.throttle ? new Float32Array(count) : undefined;
    const rpm = log.rpm ? new Float32Array(count) : undefined;

    for (let i = 0; i < count; i++) {
      const idx = i * step;
      times[i] = log.time[idx];
      r[i] = log.gyro.roll[idx];
      p[i] = log.gyro.pitch[idx];
      y[i] = log.gyro.yaw[idx];
      ax[i] = log.acc.x[idx];
      ay[i] = log.acc.y[idx];
      az[i] = log.acc.z[idx];
      if (thr && log.throttle) thr[i] = log.throttle[idx];
      if (rpm && log.rpm) rpm[i] = log.rpm[idx];
    }

    return { times, r, p, y, ax, ay, az, thr, rpm, count };
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

    // Draw signals
    const { times, r, p, y, ax, ay, az, thr, rpm, count } = downsampledData;

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

    if (activeSignal === 'gyro') {
      const gyroScale = plotH / 180; // +/- 90 deg/s range
      drawLine(r, '#38bdf8', gyroScale);
      drawLine(p, '#f59e0b', gyroScale);
      drawLine(y, '#10b981', gyroScale);
    } else if (activeSignal === 'acc') {
      const accScale = plotH / 6; // +/- 3G range
      drawLine(ax, '#f43f5e', accScale);
      drawLine(ay, '#8b5cf6', accScale);
      drawLine(az, '#ec4899', accScale);
    } else {
      // Throttle and RPM
      if (thr) {
        // 0 to 100%
        drawLine(thr, '#38bdf8', plotH / 120, padTop + plotH);
      }
      if (rpm) {
        // Scale RPM 0 to 3500
        drawLine(rpm, '#a855f7', plotH / 3500, padTop + plotH);
      }
    }

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
  }, [downsampledData, selectedWindow, currentTimeSec, activeSignal, log.durationSec]);

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
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
            <Gauge className="w-4 h-4" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              비행 타임라인 & FFT 분석 구간 선택
            </h3>
            <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              하늘색 구간 드래그로 특정 호버링/기동 구간을 지정해 해당 구간만 집중 FFT 분석합니다.
            </p>
          </div>
        </div>

        {/* Signal Mode & Reset */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`flex items-center rounded-lg p-0.5 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              onClick={() => setActiveSignal('gyro')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                activeSignal === 'gyro'
                  ? isDark
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'bg-white text-slate-900 font-semibold shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              자이로 (각속도)
            </button>
            <button
              onClick={() => setActiveSignal('acc')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                activeSignal === 'acc'
                  ? isDark
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'bg-white text-slate-900 font-semibold shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              가속도계 (G)
            </button>
            <button
              onClick={() => setActiveSignal('throttleRpm')}
              className={`px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                activeSignal === 'throttleRpm'
                  ? isDark
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'bg-white text-slate-900 font-semibold shadow-xs'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              RPM / Throttle
            </button>
          </div>

          <button
            onClick={() => onWindowChange({ start: 0, end: log.durationSec })}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition cursor-pointer ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200'
            }`}
            title="전체 비행 구간으로 초기화"
          >
            <RotateCcw className="w-3 h-3 text-cyan-500" />
            <span>전체 구간</span>
          </button>
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

      {/* Selected Range Status Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-2 text-xs pt-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        <div className="flex flex-wrap items-center gap-2 font-mono">
          <span className={`font-semibold ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
            선택된 FFT 구간: {selectedWindow.start.toFixed(2)}s ~ {selectedWindow.end.toFixed(2)}s
          </span>
          <span className="text-slate-400">
            ({(selectedWindow.end - selectedWindow.start).toFixed(2)}초 지속)
          </span>
          {selectionRpm && Number.isFinite(selectionRpm.rpm) && (
            <span
              className={`px-1.5 py-0.5 rounded border ${isDark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-700'}`}
              title={
                selectionRpm.mode === 'point'
                  ? '빨간 바 위치 ±0.5초 구간 평균 RPM'
                  : '파란 바 범위 전체 평균 RPM'
              }
            >
              평균 RPM: {Math.round(selectionRpm.rpm).toLocaleString()}
              {log.rpmSource === 'stft_estimated' ? ' ✱추정' : ''}
              <span className="text-slate-400"> ({selectionRpm.mode === 'point' ? '지점 ±0.5s' : '범위 전체'})</span>
            </span>
          )}
        </div>

        {/* Quick phase selectors — 빠른 구간 선택 */}
        <QuickPhaseSelector log={log} selectedWindow={selectedWindow} onWindowChange={onWindowChange} />
      </div>
    </div>
  );
};

/**
 * 빠른 구간 선택 규칙:
 *  - 스풀업: 전체 비행의 초반 30초. (전체 길이 < 30초면 분석 불가)
 *  - 호버링/비행중: 전체 길이 ≥ 60초면 앞 30초/뒤 30초를 제외한 나머지.
 *    전체 길이 < 60초면 앞 20초/뒤 10초를 제외한 나머지.
 *  - 전체 길이 < 30초면 분석하지 않는다 (버튼 비활성 + 안내).
 */
const QuickPhaseSelector: React.FC<{
  log: BlackboxLog;
  selectedWindow: { start: number; end: number };
  onWindowChange: (window: { start: number; end: number }) => void;
}> = ({ log, selectedWindow, onWindowChange }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const dur = log.durationSec || 0;
  const canAnalyze = dur >= 30;

  // 스풀업: 전체 비행 라인의 초반 30초
  const spoolUp: { start: number; end: number } | null = canAnalyze
    ? { start: 0, end: Math.min(30, dur) }
    : null;

  // 호버링/비행중: 스풀업 이후 + 착륙(마지막) 구간 제외
  const inFlight: { start: number; end: number } | null = (() => {
    if (!canAnalyze) return null;
    if (dur >= 60) return { start: 30, end: dur - 30 };
    return { start: 20, end: dur - 10 }; // 30초 ≤ dur < 60초
  })();

  const isSpoolActive = spoolUp && Math.abs(spoolUp.start - selectedWindow.start) < 0.01 && Math.abs(spoolUp.end - selectedWindow.end) < 0.01;
  const isInFlightActive = inFlight && Math.abs(inFlight.start - selectedWindow.start) < 0.01 && Math.abs(inFlight.end - selectedWindow.end) < 0.01;

  const baseBtn = `px-2 py-0.5 rounded text-[11px] transition border`;
  const enabledCls = isDark
    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 cursor-pointer';
  const activeCls = 'bg-cyan-600 text-white border-cyan-500 font-semibold cursor-pointer';
  const disabledCls = isDark
    ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed opacity-60'
    : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed opacity-60';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-slate-400 text-[11px]">빠른 구간 선택:</span>
      <button
        disabled={!spoolUp}
        onClick={() => spoolUp && onWindowChange(spoolUp)}
        title={
          !spoolUp
            ? '비행 구간이 30초 미만이어 스풀업 구간 분석이 불가능합니다.'
            : '전체 비행 라인의 초반 30초 (스풀업/공진 검사)'
        }
        className={`${baseBtn} ${!spoolUp ? disabledCls : isSpoolActive ? activeCls : enabledCls}`}
      >
        스풀업 (0~30초)
      </button>
      <button
        disabled={!inFlight}
        onClick={() => inFlight && onWindowChange(inFlight)}
        title={
          !inFlight
            ? '비행 구간이 30초 미만이어 호버링/비행중 분석이 불가능합니다.'
            : dur >= 60
            ? '앞 30초(스풀업)와 뒤 30초(착륙)를 제외한 나머지 비행 구간'
            : '앞 20초(스풀업)와 뒤 10초(착륙)를 제외한 나머지 비행 구간'
        }
        className={`${baseBtn} ${!inFlight ? disabledCls : isInFlightActive ? activeCls : enabledCls}`}
      >
        호버링/비행 중
      </button>
      {!canAnalyze && (
        <span className="text-rose-500 text-[11px] font-semibold">분석 불가 (30초 미만)</span>
      )}
    </div>
  );
};
