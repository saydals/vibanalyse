import React, { useRef, useEffect, useState, useMemo } from 'react';
import { FftResult, HeliConfig } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';
import { Activity, ShieldAlert } from 'lucide-react';

interface FftSpectrumViewProps {
  fft: FftResult;
  headSpeedRpm: number;
  config?: HeliConfig;
  onHeadSpeedRpmChange?: (rpm: number) => void;
  maxFreqRange?: 250 | 500 | 1000;
  onMaxFreqRangeChange?: (range: 250 | 500 | 1000) => void;
  /** 분석 불가 안내(예: 선택 구간 < 30초). null이면 정상 스펙트럼 표시 */
  analysisNotice?: string | null;
}

interface DetectedPeak {
  axis: 'Roll' | 'Pitch' | 'Yaw';
  freq: number;
  amp: number;
  harmonicName?: string;
  color: string;
  bg: string;
}

export const FftSpectrumView: React.FC<FftSpectrumViewProps> = ({
  fft,
  headSpeedRpm,
  config,
  onHeadSpeedRpmChange,
  maxFreqRange = 250,
  onMaxFreqRangeChange,
  analysisNotice,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [localHeadSpeedRpm, setLocalHeadSpeedRpm] = useState<number>(headSpeedRpm);

  // View state
  const [internalMaxFreqRange, setInternalMaxFreqRange] = useState<250 | 500 | 1000>(maxFreqRange);
  const activeMaxFreqRange = onMaxFreqRangeChange ? maxFreqRange : internalMaxFreqRange;
  const setActiveMaxFreqRange = onMaxFreqRangeChange || setInternalMaxFreqRange;
  // X축 시작(스킵) 주파수: 0 ~ 50 Hz. 그래프의 X축 0점이 이 주파수로 설정된다.
  // (저주파 대역(< 25Hz)의 과도한 진동이 다른 주파수 표시를 압도하는 문제 해결)
  const [skipHz, setSkipHz] = useState<number>(25);
  const [showRoll, setShowRoll] = useState(true);
  const [showPitch, setShowPitch] = useState(true);
  const [showYaw, setShowYaw] = useState(true);
  // 피크 마커 / RPM 하모닉 항상 표시
  const showHarmonics = true;
  const showPeakMarkers = true;

  // Y-axis resolution mode: 'auto' | '0.2' | '0.5' | '1.0' | '2.0' | '5.0'
  const [yScalePreset, setYScalePreset] = useState<'auto' | '0.2' | '0.5' | '1.0' | '2.0' | '5.0'>('auto');

  // Hover state
  const [hoverInfo, setHoverInfo] = useState<{
    freq: number;
    rollVal?: number;
    pitchVal?: number;
    yawVal?: number;
    xPx: number;
    yPx: number;
    nearestHarmonic?: string;
  } | null>(null);

  // Harmonics calculations
  const main1P = headSpeedRpm / 60;
  const bladeCount = config?.bladeCount || 2;
  const main2P = main1P * bladeCount;
  const tailRatio = config?.tailGearRatio || 4.45;
  const tail1P = main1P * tailRatio;
  const motorRatio = (config?.mainGearTeeth || 110) / (config?.motorPinionTeeth || 11);
  const motor1P = main1P * motorRatio;

  useEffect(() => {
    setLocalHeadSpeedRpm(headSpeedRpm);
  }, [headSpeedRpm]);

  // Max observed amplitude in the visible frequency range (skipHz ~ maxFreqRange)
  const maxObservedAmp = useMemo(() => {
    let max = 0.05;
    const limitIdx = Math.min(
      fft.frequencies.length,
      Math.floor((maxFreqRange / (fft.sampleRate / 2)) * fft.frequencies.length)
    );
    // 항상 12Hz 미만의 잡음은 제외하고, 스킵 구간도 Y축 자동 스케일에 반영하지 않는다
    const minVisibleHz = Math.max(skipHz, 12);

    for (let i = 2; i < limitIdx; i++) {
      const f = fft.frequencies[i];
      if (f < minVisibleHz) continue; // Skip DC/sub-audible noise + skipHz band
      if (showRoll) max = Math.max(max, fft.roll[i]);
      if (showPitch) max = Math.max(max, fft.pitch[i]);
      if (showYaw) max = Math.max(max, fft.yaw[i]);
    }
    return max;
  }, [fft, maxFreqRange, skipHz, showRoll, showPitch, showYaw]);

  // Adaptive Y-axis configuration:
  // Peaks always appear at 90% of Y-axis height (maxAmp = maxObservedAmp / 0.9)
  // 0.02 단위까지 세분화하여 주파수 특성을 명확히 표시
  const yAxisConfig = useMemo(() => {
    let step = 0.2;
    let maxAmp = 1.0;

    if (yScalePreset !== 'auto') {
      step = parseFloat(yScalePreset);
      maxAmp = Math.max(step * 3, Math.ceil((maxObservedAmp / 0.9) / step) * step);
    } else {
      // Automatic adaptive subdivision: finer steps (down to 0.02) so peaks render near 90%
      if (maxObservedAmp <= 0.1) {
        step = 0.02;
        maxAmp = Math.max(0.06, Math.ceil((maxObservedAmp / 0.9) / 0.02) * 0.02);
      } else if (maxObservedAmp <= 0.35) {
        step = 0.05;
        maxAmp = Math.max(0.15, Math.ceil((maxObservedAmp / 0.9) / 0.05) * 0.05);
      } else if (maxObservedAmp <= 1.1) {
        step = 0.1;
        maxAmp = Math.max(0.3, Math.ceil((maxObservedAmp / 0.9) / 0.1) * 0.1);
      } else if (maxObservedAmp <= 2.4) {
        step = 0.2;
        maxAmp = Math.max(0.6, Math.ceil((maxObservedAmp / 0.9) / 0.2) * 0.2);
      } else if (maxObservedAmp <= 6.0) {
        step = 0.5;
        maxAmp = Math.max(1.5, Math.ceil((maxObservedAmp / 0.9) / 0.5) * 0.5);
      } else if (maxObservedAmp <= 14.0) {
        step = 1.0;
        maxAmp = Math.max(3.0, Math.ceil((maxObservedAmp / 0.9) / 1.0) * 1.0);
      } else if (maxObservedAmp <= 35.0) {
        step = 2.0;
        maxAmp = Math.max(8.0, Math.ceil((maxObservedAmp / 0.9) / 2.0) * 2.0);
      } else {
        step = 5.0;
        maxAmp = Math.max(15.0, Math.ceil((maxObservedAmp / 0.9) / 5.0) * 5.0);
      }
    }

    const ticks: number[] = [];
    const numSteps = Math.round(maxAmp / step);
    const decimals = step < 0.05 ? 2 : step < 1 ? 1 : 0;
    for (let i = 0; i <= numSteps; i++) {
      ticks.push(+(i * step).toFixed(decimals));
    }

    return {
      step,
      maxAmp,
      ticks,
      decimals,
      numSteps,
    };
  }, [maxObservedAmp, yScalePreset]);

  // Detect peaks anchored at harmonics: for each of Main 1P / Blade 2P / Tail 1P,
  // find the strongest bin of each visible axis (Roll/Pitch/Yaw) near that harmonic.
  // Display label is simplified to "**Hz(**/s)" only (no harmonic name prefix).
  const harmonicPeakTargets = useMemo(() => {
    const t: Array<{ key: 'main1P' | 'main2P' | 'tail1P'; freq: number; tol: number }> = [];
    if (main1P > 0) {
      t.push({ key: 'main1P', freq: main1P, tol: 4.5 });
      t.push({ key: 'main2P', freq: main2P, tol: 7.0 });
      t.push({ key: 'tail1P', freq: tail1P, tol: 14.0 });
    }
    return t;
  }, [main1P, main2P, tail1P]);

  const detectedPeaks = useMemo<DetectedPeak[]>(() => {
    const list: DetectedPeak[] = [];
    const limitIdx = Math.min(
      fft.frequencies.length,
      Math.floor((maxFreqRange / (fft.sampleRate / 2)) * fft.frequencies.length)
    );

    const channels: Array<{
      name: 'Roll' | 'Pitch' | 'Yaw';
      data: Float32Array;
      color: string;
      bg: string;
      active: boolean;
    }> = [
      { name: 'Roll', data: fft.roll, color: '#38bdf8', bg: '#0284c7', active: showRoll },
      { name: 'Pitch', data: fft.pitch, color: '#f59e0b', bg: '#d97706', active: showPitch },
      { name: 'Yaw', data: fft.yaw, color: '#10b981', bg: '#059669', active: showYaw },
    ];

    // Helper: strongest local-maximum bin of a channel within [center-tol, center+tol]
    const peakNear = (
      data: Float32Array,
      center: number,
      tol: number
    ): { freq: number; amp: number } | null => {
      let best: { freq: number; amp: number } | null = null;
      for (let i = 2; i < limitIdx - 1; i++) {
        const f = fft.frequencies[i];
        if (f < Math.max(skipHz, 15) || f > maxFreqRange) continue;
        if (Math.abs(f - center) > tol) continue;
        const val = data[i];
        if (val > data[i - 1] && val > data[i + 1]) {
          if (!best || val > best.amp) best = { freq: f, amp: val };
        }
      }
      // Fallback: window maximum when no strict local maximum exists
      if (!best) {
        for (let i = 2; i < limitIdx; i++) {
          const f = fft.frequencies[i];
          if (f < Math.max(skipHz, 15) || f > maxFreqRange) continue;
          if (Math.abs(f - center) > tol) continue;
          const val = data[i];
          if (!best || val > best.amp) best = { freq: f, amp: val };
        }
      }
      if (!best || best.amp < 0.04) return null;
      return best;
    };

    channels.forEach(ch => {
      if (!ch.active) return;
      harmonicPeakTargets.forEach(target => {
        // Skip harmonics outside the visible range
        if (target.freq < Math.max(skipHz, 15) || target.freq > maxFreqRange) return;
        const found = peakNear(ch.data, target.freq, target.tol);
        if (!found) return;
        list.push({
          axis: ch.name,
          freq: Math.round(found.freq * 10) / 10,
          amp: Math.round(found.amp * 100) / 100,
          harmonicName: undefined,
          color: ch.color,
          bg: ch.bg,
        });
      });
    });

    // De-duplicate: same axis + nearly same frequency (keep strongest)
    const deduped: DetectedPeak[] = [];
    list
      .sort((a, b) => b.amp - a.amp)
      .forEach(p => {
        if (
          !deduped.some(
            q => q.axis === p.axis && Math.abs(q.freq - p.freq) < 5
          )
        ) {
          deduped.push(p);
        }
      });

    // Sort by amplitude descending
    return deduped.sort((a, b) => b.amp - a.amp);
  }, [fft, maxFreqRange, skipHz, showRoll, showPitch, showYaw, harmonicPeakTargets]);

  // Overall highest peak
  const globalMaxPeak = detectedPeaks[0] || null;

  // Render Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI sharp rendering
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.scale(dpr, dpr);

    // Dynamic padding to fit Y-axis labels
    const padLeft = 52;
    const padRight = 30;
    const padTop = 32;
    const padBottom = 32;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Clear background
    ctx.fillStyle = isDark ? '#090d16' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // Draw Grid Lines & X-Axis (Frequency)
    ctx.lineWidth = 1;
    ctx.strokeStyle = isDark ? '#1e293b' : '#e2e8f0';
    ctx.fillStyle = isDark ? '#64748b' : '#475569';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';

    // X축 가시 범위: [skipHz, maxFreqRange] — X축 0점이 skipHz가 되도록 매핑
    const freqSpan = Math.max(1, maxFreqRange - skipHz);
    const freqToX = (f: number): number => padLeft + ((f - skipHz) / freqSpan) * plotW;

    const freqStep = maxFreqRange <= 250 ? 25 : maxFreqRange <= 500 ? 50 : 100;
    // 스킵 지점(X축 시작)을 원점으로 표시
    const originX = freqToX(skipHz);
    ctx.beginPath();
    ctx.moveTo(originX, padTop);
    ctx.lineTo(originX, padTop + plotH);
    ctx.stroke();
    ctx.fillText(`${skipHz}Hz`, originX, padTop + plotH + 18);

    // 그 외 눈금은 skipHz 이후의 정수 배수로 배치 (skipHz=0 이면 중복 방지)
    let startTick = Math.ceil(skipHz / freqStep) * freqStep;
    if (startTick === skipHz) startTick += freqStep;
    for (let f = startTick; f <= maxFreqRange; f += freqStep) {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();

      ctx.fillText(`${f} Hz`, x, padTop + plotH + 18);
    }

    // Y-Axis (Adaptive Amplitude Subdivisions)
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yAxisConfig.ticks.forEach(yVal => {
      const y = padTop + plotH - (yVal / yAxisConfig.maxAmp) * plotH;

      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();

      const label = `${yVal.toFixed(yAxisConfig.decimals)}°/s`;
      ctx.fillText(label, padLeft - 6, y);
    });

    // Max Peak Horizontal Guideline
    if (globalMaxPeak && globalMaxPeak.amp > 0.05) {
      const yPeak = padTop + plotH - Math.min(plotH, (globalMaxPeak.amp / yAxisConfig.maxAmp) * plotH);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.45)' : 'rgba(2, 132, 199, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(padLeft, yPeak);
      ctx.lineTo(padLeft + plotW, yPeak);
      ctx.stroke();
      ctx.restore();

      // Right-edge tag for maximum peak
      ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(241, 245, 249, 0.9)';
      const tagText = `▲ ${globalMaxPeak.amp.toFixed(2)}°/s`;
      const tagW = ctx.measureText(tagText).width + 8;
      ctx.beginPath();
      ctx.roundRect(padLeft + plotW - tagW, yPeak - 9, tagW, 16, 3);
      ctx.fill();
      ctx.fillStyle = isDark ? '#38bdf8' : '#0284c7';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(tagText, padLeft + plotW - tagW / 2, yPeak + 1);
    }

    // Harmonics Vertical Markers
    if (showHarmonics && main1P > 0) {
      const markers = [
        { freq: main1P, label: '1P Main', color: '#38bdf8', bg: '#0369a1' },
        { freq: main2P, label: `${bladeCount}P Blade`, color: '#a855f7', bg: '#7e22ce' },
        { freq: tail1P, label: 'Tail 1P', color: '#f59e0b', bg: '#b45309' },
        { freq: motor1P, label: 'Motor', color: '#ec4899', bg: '#be185d' },
      ];

      markers.forEach(({ freq, label, color, bg }) => {
        if (freq >= skipHz && freq <= maxFreqRange) {
          const x = freqToX(freq);

          // Dotted harmonic line
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, padTop);
          ctx.lineTo(x, padTop + plotH);
          ctx.stroke();
          ctx.restore();

          // Label pill at top
          ctx.fillStyle = bg;
          const txtW = ctx.measureText(label).width + 10;
          ctx.beginPath();
          ctx.roundRect(x - txtW / 2, padTop - 24, txtW, 16, 4);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(label, x, padTop - 12);
        }
      });
    }

    // Simulated Filter Response Curve (Notch Filter) — 삭제됨

    // Function to draw FFT line
    const drawSpectrumLine = (data: Float32Array, color: string, scaleFactor: number = 1.0) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.0;
      ctx.beginPath();

      const numPoints = fft.frequencies.length;
      let first = true;

      for (let i = 1; i < numPoints; i++) {
        const f = fft.frequencies[i];
        if (f < skipHz) continue; // Skip Hz 아래 대역은 그리지 않는다
        if (f > maxFreqRange) break;

        const val = data[i] * scaleFactor;
        const x = freqToX(f);
        const y = padTop + plotH - Math.min(plotH, (val / yAxisConfig.maxAmp) * plotH);

        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    // Draw active spectrum curves
    if (showRoll) drawSpectrumLine(fft.roll, '#38bdf8');   // Cyan Roll
    if (showPitch) drawSpectrumLine(fft.pitch, '#f59e0b'); // Amber Pitch
    if (showYaw) drawSpectrumLine(fft.yaw, '#10b981');     // Emerald Yaw

    // Distinct On-Canvas Vibration Peak Markers
    // 1P Main / 2P Blade / Tail harmonics x Roll/Pitch/Yaw axes (up to 9).
    // Label simplified to "**Hz(**/s)" only.
    if (showPeakMarkers && detectedPeaks.length > 0) {
      const placed: Array<{ x0: number; x1: number; y: number }> = [];
      detectedPeaks.slice(0, 9).forEach((peak, rank) => {
        const x = freqToX(peak.freq);
        const y = padTop + plotH - Math.min(plotH, (peak.amp / yAxisConfig.maxAmp) * plotH);

        if (x < padLeft || x > padLeft + plotW) return;

        // Peak point halo and circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = peak.color + '44'; // Translucent glow
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = peak.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Callout Pill Tag (simplified: no harmonic-name prefix)
        const text = `${peak.freq}Hz(${peak.amp.toFixed(2)}°/s)`;
        ctx.font = 'bold 10px sans-serif';
        const tw = ctx.measureText(text).width + 12;
        const pillX = Math.max(padLeft + 4, Math.min(padLeft + plotW - tw - 4, x - tw / 2));

        // Stagger vertically when pills would overlap horizontally
        let calloutY = Math.max(padTop + 14, y - 26 - rank * 2);
        for (let attempt = 0; attempt < 6; attempt++) {
          const overlap = placed.some(
            p =>
              Math.abs(pillX + tw / 2 - (p.x0 + p.x1) / 2) < (tw + (p.x1 - p.x0)) / 2 + 2 &&
              Math.abs(calloutY - p.y) < 20
          );
          if (!overlap) break;
          calloutY = Math.max(padTop + 14, calloutY - 20);
        }
        placed.push({ x0: pillX, x1: pillX + tw, y: calloutY });

        // Pin line up to callout
        ctx.beginPath();
        ctx.setLineDash([2, 2]);
        ctx.strokeStyle = peak.color;
        ctx.lineWidth = 1;
        ctx.moveTo(x, y - 4);
        ctx.lineTo(x, calloutY + 8);
        ctx.stroke();

        // Pointer triangle
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 5);
        ctx.lineTo(x + 4, y - 5);
        ctx.lineTo(x, y - 1);
        ctx.closePath();
        ctx.fillStyle = peak.color;
        ctx.fill();

        ctx.fillStyle = peak.bg;
        ctx.beginPath();
        ctx.roundRect(pillX, calloutY - 9, tw, 18, 5);
        ctx.fill();

        // Border around callout
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, pillX + tw / 2, calloutY);
        ctx.restore();
      });
    }

    // Hover Line & Marker
    if (hoverInfo && hoverInfo.xPx >= padLeft && hoverInfo.xPx <= padLeft + plotW) {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hoverInfo.xPx, padTop);
      ctx.lineTo(hoverInfo.xPx, padTop + plotH);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    fft,
    maxFreqRange,
    skipHz,
    showRoll,
    showPitch,
    showYaw,
    hoverInfo,
    yAxisConfig,
    detectedPeaks,
    globalMaxPeak,
    main1P,
    main2P,
    tail1P,
    motor1P,
    bladeCount,
    isDark,
  ]);

  // Mouse / Touch Move handling
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const padLeft = 52;
    const padRight = 30;
    const plotW = rect.width - padLeft - padRight;

    if (x < padLeft || x > padLeft + plotW) {
      setHoverInfo(null);
      return;
    }

    const freqFrac = (x - padLeft) / plotW;
    const targetFreq = skipHz + freqFrac * (maxFreqRange - skipHz);

    // Find nearest bin
    const freqStep = fft.sampleRate / (fft.frequencies.length * 2);
    const binIdx = Math.max(0, Math.min(fft.frequencies.length - 1, Math.round(targetFreq / freqStep)));

    const actualFreq = fft.frequencies[binIdx];
    const rollVal = fft.roll[binIdx];
    const pitchVal = fft.pitch[binIdx];
    const yawVal = fft.yaw[binIdx];

    // Check nearest harmonic
    let nearestHarmonic: string | undefined;
    if (Math.abs(actualFreq - main1P) < 3) nearestHarmonic = '메인 1P (언밸런스)';
    else if (Math.abs(actualFreq - main2P) < 4) nearestHarmonic = '메인 2P (블레이드 통과)';
    else if (Math.abs(actualFreq - tail1P) < 6) nearestHarmonic = '테일 1P (테일 진동)';
    else if (motor1P > 0 && Math.abs(actualFreq - motor1P) < 10) nearestHarmonic = '모터 회전 주파수';

    setHoverInfo({
      freq: Math.round(actualFreq * 10) / 10,
      rollVal: Math.round(rollVal * 100) / 100,
      pitchVal: Math.round(pitchVal * 100) / 100,
      yawVal: Math.round(yawVal * 100) / 100,
      xPx: x,
      yPx: y,
      nearestHarmonic,
    });
  };

  const handlePointerLeave = () => {
    setHoverInfo(null);
  };

  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm flex flex-col gap-3 transition-colors ${
        isDark ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}
    >
      {/* View Header & Controls */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b ${
          isDark ? 'border-slate-800/80' : 'border-slate-100'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className={`text-sm font-semibold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              <span>FFT 진동 주파수 스펙트럼</span>
            </h3>
          </div>
        </div>

        {/* Channel Toggles, Y-Axis Scaling & Range */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Axis Toggles */}
          <div
            className={`flex items-center rounded-lg p-0.5 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <button
              onClick={() => setShowRoll(!showRoll)}
              className={`px-2 py-1 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                showRoll
                  ? isDark
                    ? 'bg-cyan-950 text-cyan-400 border border-cyan-700/50'
                    : 'bg-white text-cyan-700 border border-cyan-300 shadow-xs'
                  : isDark
                  ? 'text-slate-500 hover:text-slate-300'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              Roll
            </button>
            <button
              onClick={() => setShowPitch(!showPitch)}
              className={`px-2 py-1 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                showPitch
                  ? isDark
                    ? 'bg-amber-950 text-amber-400 border border-amber-700/50'
                    : 'bg-white text-amber-700 border border-amber-300 shadow-xs'
                  : isDark
                  ? 'text-slate-500 hover:text-slate-300'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              Pitch
            </button>
            <button
              onClick={() => setShowYaw(!showYaw)}
              className={`px-2 py-1 rounded font-medium transition flex items-center gap-1 cursor-pointer ${
                showYaw
                  ? isDark
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                    : 'bg-white text-emerald-700 border border-emerald-300 shadow-xs'
                  : isDark
                  ? 'text-slate-500 hover:text-slate-300'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              Yaw
            </button>
          </div>

          {/* Y-Axis Step / Scale Preset Selector (dropdown) */}
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
            title="진동 크기에 따른 세로축 세분화 단위 설정"
          >
            <span className={`text-[11px] font-medium whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Y축
            </span>
            <select
              value={yScalePreset}
              onChange={e => setYScalePreset(e.target.value as typeof yScalePreset)}
              className={`rounded px-1 py-0.5 font-mono text-xs outline-none cursor-pointer ${
                isDark
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'bg-white text-slate-900 border border-slate-300'
              }`}
            >
              <option value="auto">자동 ({yAxisConfig.step}°)</option>
              <option value="0.2">0.2°</option>
              <option value="0.5">0.5°</option>
              <option value="1.0">1.0°</option>
              <option value="2.0">2.0°</option>
              <option value="5.0">5.0°</option>
            </select>
          </div>

          {/* Head Speed RPM Input */}
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
            title="헤드스피드 RPM을 입력하면 하모닉 마커 주파수가 함께 변경됩니다"
          >
            <span className={`text-[11px] font-medium whitespace-nowrap ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              헤드스피드
            </span>
            <input
              type="number"
              value={localHeadSpeedRpm}
              onChange={e => {
                const val = Math.max(0, Math.min(10000, Number(e.target.value) || 0));
                setLocalHeadSpeedRpm(val);
                onHeadSpeedRpmChange?.(val);
              }}
              style={{ width: `${Math.max(4, String(localHeadSpeedRpm ?? '').length + 1.5)}ch` }}
              className={`rounded px-1.5 py-0.5 font-mono text-xs outline-none cursor-pointer ${
                isDark
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'bg-white text-slate-900 border border-slate-300'
              }`}
              min="0"
              max="10000"
              step="50"
            />
            <span className={`text-[11px] font-medium whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              RPM
            </span>
          </div>

          {/* Max Frequency Range Selector (dropdown: 250 / 500 / 1000) */}
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
          >
            <select
              value={activeMaxFreqRange}
              onChange={e => setActiveMaxFreqRange(Number(e.target.value) as 250 | 500 | 1000)}
              className={`rounded px-1 py-0.5 font-mono text-xs outline-none cursor-pointer ${
                isDark
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'bg-white text-slate-900 border border-slate-300'
              }`}
            >
              {([250, 500, 1000] as const).map(range => (
                <option key={range} value={range}>
                  {range}Hz
                </option>
              ))}
            </select>
          </div>

          {/* Skip Hz — X축 시작(스킵) 주파수 0 ~ 50Hz */}
          <div
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border text-xs ${
              isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-100 border-slate-200'
            }`}
            title="X축 0점(시작 주파수)을 이 값으로 설정합니다. 25Hz 미만의 과도한 저주파 진동이 다른 주파수를 압도할 때 올려서 숨기세요."
          >
            <span className={`text-[10px] font-medium whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Skip Hz
            </span>
            <select
              value={skipHz}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                setSkipHz(Number.isFinite(v) ? Math.max(0, Math.min(50, v)) : 0);
              }}
              className={`rounded px-1 py-0.5 font-mono text-xs outline-none cursor-pointer ${
                isDark
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'bg-white text-slate-900 border border-slate-300'
              }`}
            >
              {Array.from({ length: 11 }, (_, i) => i * 5).map(v => (
                <option key={v} value={v}>
                  {v}Hz
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className={`relative w-full h-72 sm:h-84 rounded-xl overflow-hidden cursor-crosshair border transition-colors ${
          isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
          className="w-full h-full block touch-none"
        />

        {/* Analysis unavailable notice (e.g. selected window < 30s) */}
        {analysisNotice && (
          <div className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 backdrop-blur-xs ${
            isDark ? 'bg-slate-950/80' : 'bg-white/80'
          }`}>
            <ShieldAlert className={`w-8 h-8 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
            <p className={`text-sm font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>
              {analysisNotice}
            </p>
          </div>
        )}

        {/* Interactive Tooltip Card */}
        {hoverInfo && (
          <div
            className={`pointer-events-none absolute z-20 rounded-xl px-3 py-2 text-xs shadow-xl backdrop-blur-xs flex flex-col gap-1 min-w-[170px] border ${
              isDark ? 'bg-slate-900/95 border-slate-700 text-white' : 'bg-white/95 border-slate-200 text-slate-900'
            }`}
            style={{
              left: Math.min(window.innerWidth > 600 ? hoverInfo.xPx + 15 : 10, containerRef.current ? containerRef.current.clientWidth - 190 : 200),
              top: 15,
            }}
          >
            <div className={`flex items-center justify-between pb-1 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
              <span className={`font-mono font-bold ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>{hoverInfo.freq} Hz</span>
              <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                ~{Math.round(hoverInfo.freq * 60)} RPM
              </span>
            </div>
            {hoverInfo.nearestHarmonic && (
              <span className={`px-1.5 py-0.5 rounded border text-[11px] font-medium ${
                isDark ? 'bg-blue-950/80 border-blue-700/50 text-blue-300' : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}>
                🎯 {hoverInfo.nearestHarmonic}
              </span>
            )}
            <div className="grid grid-cols-3 gap-1 pt-0.5 font-mono text-[11px]">
              {showRoll && (
                <div className={isDark ? 'text-cyan-400' : 'text-cyan-600'}>
                  <span className="text-slate-400 text-[9px] block">R:</span>
                  {hoverInfo.rollVal}°/s
                </div>
              )}
              {showPitch && (
                <div className={isDark ? 'text-amber-400' : 'text-amber-600'}>
                  <span className="text-slate-400 text-[9px] block">P:</span>
                  {hoverInfo.pitchVal}°/s
                </div>
              )}
              {showYaw && (
                <div className={isDark ? 'text-emerald-400' : 'text-emerald-600'}>
                  <span className="text-slate-400 text-[9px] block">Y:</span>
                  {hoverInfo.yawVal}°/s
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
