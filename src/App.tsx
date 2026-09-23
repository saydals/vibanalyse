import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { BlackboxLog, HeliConfig, FftResult } from './types/blackbox';
import { Header } from './components/Header';
import { FftSpectrumView } from './components/FftSpectrumView';
import { TimeDomainView } from './components/TimeDomainView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { DEFAULT_SAMPLE, REAL_SAMPLES, fetchSampleLogs } from './utils/samples';
import { computeMultiAxisFft } from './utils/fft';
import { MIN_ANALYSIS_SEC, parseBlackboxFile } from './utils/blackboxParser';
import { estimateRpmForLogAsync, getRpmForSelection } from './utils/rpmEstimator';
import { useTheme } from './context/ThemeContext';
import { Loader2 } from 'lucide-react';

function emptyFftResult(): FftResult {
  return {
    frequencies: new Float32Array(512),
    roll: new Float32Array(512),
    pitch: new Float32Array(512),
    yaw: new Float32Array(512),
    accX: new Float32Array(512),
    accY: new Float32Array(512),
    accZ: new Float32Array(512),
    sampleRate: 2000,
  };
}

export default function App() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [logs, setLogs] = useState<BlackboxLog[]>([]);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [currentLogIndex, setCurrentLogIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [maxFreqRange, setMaxFreqRange] = useState<250 | 500 | 1000>(250);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentLog = logs[currentLogIndex] || logs[0];

  const loadRealSample = useCallback(async (sampleId: string = DEFAULT_SAMPLE.id) => {
    const sample = REAL_SAMPLES.find(s => s.id === sampleId) ?? DEFAULT_SAMPLE;
    setSampleError(null);
    try {
      console.log('[loadRealSample] Fetching:', sample.file);
      const loaded = await fetchSampleLogs(sample);
      console.log('[loadRealSample] Loaded:', loaded.length, 'logs, first:', loaded[0]?.filename);
      setLogs(loaded);
      setCurrentLogIndex(0);
    } catch (e: any) {
      console.error('[loadRealSample] Error:', e);
      setSampleError(e?.message || 'Could not load the sample log.');
    }
  }, []);

  useEffect(() => { loadRealSample(); }, [loadRealSample]);

  // Selected FFT window in seconds (default: hovering / in-flight section)
  const [selectedWindow, setSelectedWindow] = useState<{ start: number; end: number }>(() => {
    const dur = currentLog?.durationSec || 30;
    if (dur >= 60) return { start: 30, end: dur - 30 };
    if (dur >= 30) return { start: 20, end: dur - 10 };
    return { start: 0, end: dur };
  });

  // Current playhead time
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);

  // Helicopter mechanical config
  const [heliConfig, setHeliConfig] = useState<HeliConfig>({
    mainRpm: 2300,
    tailGearRatio: 4.45,
    motorPinionTeeth: 11,
    mainGearTeeth: 110,
    motorKv: 1100,
    batteryCells: 6,
    bladeCount: 2,
  });

  // When log changes, update window and detected RPM.
  // When the log has no RPM sensor, inject the gyro-STFT estimate through the same interface as the rpm array.
  // Note: the estimate is always attempted regardless of the header format (non-Rotorflight logs such as Betaflight are allowed)
  useEffect(() => {
    if (currentLog) {
      const dur = currentLog.durationSec;
      if (dur >= 60) {
        setSelectedWindow({ start: 30, end: dur - 30 });
      } else if (dur >= 30) {
        setSelectedWindow({ start: 20, end: dur - 10 });
      } else {
        setSelectedWindow({ start: 0, end: dur });
      }
      setCurrentTimeSec(0);

      // Check if log contains RPM
      if (currentLog.rpm && currentLog.rpm.length > 0) {
        let sum = 0, count = 0;
        for (let i = 0; i < currentLog.rpm.length; i++) {
          const r = currentLog.rpm[i];
          if (r > 800 && r < 4500) {
            sum += r;
            count++;
          }
        }
        if (count > 50) {
          const avgRpm = Math.round(sum / count);
          setHeliConfig(prev => ({ ...prev, mainRpm: avgRpm }));
        }
      }
    }
  }, [currentLog]);

  // Logs without an RPM sensor: gyro STFT estimate (chunked asynchronously so the main thread stays responsive)
  // Note: the "RPM estimate complete" UI item was removed — the estimation itself is still active
  useEffect(() => {
    if (!currentLog) return;
    if (currentLog.rpmSource !== 'none') {
      return;
    }
    if (currentLog.totalFrames < 100 || currentLog.sampleRateHz <= 0) {
      return;
    }
    let cancelled = false;
    estimateRpmForLogAsync(currentLog, () => {}).then(estimated => {
      if (cancelled) return;
      if (estimated.length === currentLog.totalFrames && estimated.length > 0) {
        let sum = 0; let count = 0;
        for (let i = 0; i < estimated.length; i++) {
          const v = estimated[i];
          if (Number.isFinite(v) && v > 800 && v < 6000) { sum += v; count++; }
        }
        if (count > 50) {
          const avg = Math.round(sum / count);
          setLogs(prev => prev.map(l =>
            l === currentLog ? { ...l, rpm: estimated, rpmSource: 'stft_estimated' as const } : l,
          ));
          setHeliConfig(prev => ({ ...prev, mainRpm: avg }));
        }
      }
    }).catch(e => {
      if (cancelled) return;
      console.error('[rpmEstimate] failed:', e);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLog?.filename, currentLog?.totalFrames]);

  const handleHeadSpeedRpmChange = (rpm: number) => {
    setHeliConfig(prev => ({ ...prev, mainRpm: rpm }));
  };

  // Skip vibration analysis when the whole log is shorter than MIN_ANALYSIS_SEC.
  const logTooShort = !!currentLog && currentLog.durationSec < MIN_ANALYSIS_SEC;

  // Gyro data source used for FFT analysis: filtered=gyroADC (after the gyro filters), raw=gyroRAW (unfiltered)
  const [gyroSource, setGyroSource] = useState<'filtered' | 'raw'>('filtered');
  const gyroSourceAvailable = useMemo(
    () => ({
      // Logs without the flag (legacy path) keep the previous behavior: report Filtered
      filtered: currentLog ? currentLog.hasGyroFiltered !== false : false,
      raw: !!currentLog?.hasGyroRaw,
    }),
    [currentLog],
  );
  // When the selected source is not logged, no graph is drawn (empty spectrum)
  const gyroSourceLogged = gyroSourceAvailable[gyroSource];

  // When the log changes, auto-select a source that is logged (an explicit user choice is preserved).
  const gyroSourceLogRef = useRef<BlackboxLog | null>(null);
  useEffect(() => {
    if (!currentLog || gyroSourceLogRef.current === currentLog) return;
    gyroSourceLogRef.current = currentLog;
    if (currentLog.hasGyroFiltered) setGyroSource('filtered');
    else if (currentLog.hasGyroRaw) setGyroSource('raw');
  }, [currentLog]);

  const activeFft = useMemo<FftResult>(() => {
    if (!currentLog || logTooShort || !gyroSourceLogged) {
      return emptyFftResult();
    }

    const startIdx = Math.max(0, Math.floor(selectedWindow.start * currentLog.sampleRateHz));
    const endIdx = Math.min(currentLog.totalFrames, Math.floor(selectedWindow.end * currentLog.sampleRateHz));

    // Logs without a gyroRAW field fall back to gyro (the fallback data) as-is.
    const gyroSeries = gyroSource === 'raw'
      ? (currentLog.gyroRaw ?? currentLog.gyro)
      : currentLog.gyro;

    return computeMultiAxisFft(
      gyroSeries,
      currentLog.acc,
      currentLog.sampleRateHz,
      startIdx,
      endIdx,
      1024
    );
  }, [currentLog, selectedWindow, logTooShort, gyroSource, gyroSourceLogged]);

  // Compute Overall Vibration Summary

  const openFileExplorer = () => fileInputRef.current?.click();

  const handleBblFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setFileError(null);
    setIsLoading(true);
    try {
      const result = await parseBlackboxFile(file, file.name);
      if (result.logs.length === 0) {
        throw new Error('No valid blackbox flight log found in the file.');
      }
      setLogs(result.logs);
      setCurrentLogIndex(0);
    } catch (err: any) {
      console.error(err);
      setFileError(err?.message || 'Something went wrong while analyzing the file. Please check that it is a valid .BBL or .CSV file.');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Timeline bar RPM lookup (merges the blue range / red marker — shared by sensor and estimate)
  const selectionRpm = useMemo(() => {
    if (!currentLog) return { rpm: NaN, mode: 'range' as const, count: 0 };
    return getRpmForSelection(currentLog, selectedWindow, currentTimeSec);
  }, [currentLog, selectedWindow, currentTimeSec]);

  // Keep the displayed head speed in sync when the average RPM of the selected window changes
  useEffect(() => {
    if (!currentLog?.rpm || currentLog.rpm.length === 0) return;
    if (Number.isFinite(selectionRpm.rpm) && selectionRpm.count > 10) {
      const avg = Math.round(selectionRpm.rpm);
      setHeliConfig(prev => (Math.abs(prev.mainRpm - avg) >= 1 ? { ...prev, mainRpm: avg } : prev));
    }
  }, [selectionRpm.rpm, selectionRpm.count, currentLog]);

  return (
    <div
      className={`min-h-screen flex flex-col font-sans pb-12 transition-colors duration-200 ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-800'
      }`}
    >
      {/* Top Header */}
      <Header
        logs={logs}
        currentLogIndex={currentLogIndex}
        onSelectLog={setCurrentLogIndex}
        onNewFileClick={openFileExplorer}
      />
      {/* Hidden file input: the "Open BBL" button opens the file picker directly */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".bbl,.BBL,.csv,.CSV,.txt,.TXT"
        className="hidden"
        onChange={e => handleBblFileSelected(e.target.files)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 flex flex-col gap-5">
        {/* Sample log is still loading / failed */}
        {!currentLog ? (
          <div
            className={`flex flex-col items-center justify-center gap-3 rounded-3xl border p-12 text-center transition-colors ${
              isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <Loader2 className={`w-8 h-8 animate-spin ${sampleError ? 'text-rose-500' : 'text-cyan-500'}`} />
            {sampleError ? (
              <>
                <p className={`text-sm font-semibold ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>{sampleError}</p>
                <button
                  onClick={() => loadRealSample()}
                  className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition ${
                    isDark ? 'bg-cyan-600 hover:bg-cyan-500 text-white' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                >
                  Reload Sample Log
                </button>
              </>
            ) : (
              <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                Loading the built-in sample log...
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Log Info Bar */}
            {currentLog && (
              <div
                className={`flex flex-wrap items-center justify-between gap-2 text-xs border-b pb-2 ${
                  isDark ? 'border-slate-800/80 text-slate-400' : 'border-slate-200 text-slate-500'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 overflow-hidden">
                  <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Craft:</span>
                  <span className={`font-semibold truncate max-w-[160px] sm:max-w-none ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {currentLog.craftName || 'Rotorflight Helicopter'}
                  </span>
                  <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>|</span>
                  <span className={`font-mono ${isDark ? 'text-cyan-300' : 'text-cyan-700 font-semibold'}`}>
                    {currentLog.filename}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                  <span className="flex items-center gap-1">
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Time:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.durationSec.toFixed(1)}s
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Samples:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.sampleRateHz} Hz
                    </span>
                  </span>
                  <span className="flex items-center gap-1 hidden md:inline-flex">
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Frames:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.totalFrames.toLocaleString()}
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Main content — only the FFT and timeline boxes are kept */}
            <div className="flex flex-col gap-5">
              {fileError && (
                <p className={`text-xs font-semibold ${isDark ? 'text-rose-300' : 'text-rose-600'}`}>
                  {fileError}
                </p>
              )}
              {isLoading && (
                <p className={`text-xs font-semibold ${isDark ? 'text-cyan-300' : 'text-cyan-700'}`}>
                  Loading BBL file...
                </p>
              )}
              {/* Interactive FFT Spectrum Chart */}
              <FftSpectrumView
                fft={activeFft}
                headSpeedRpm={heliConfig.mainRpm}
                config={heliConfig}
                onHeadSpeedRpmChange={handleHeadSpeedRpmChange}
                maxFreqRange={maxFreqRange}
                onMaxFreqRangeChange={setMaxFreqRange}
                gyroSource={gyroSource}
                onGyroSourceChange={setGyroSource}
                gyroSourceAvailable={gyroSourceAvailable}
                analysisNotice={
                  logTooShort
                    ? `Flight log is ${currentLog.durationSec.toFixed(1)}s — shorter than the ${MIN_ANALYSIS_SEC}s minimum, so it is not analyzed.`
                    : !gyroSourceLogged
                    ? `The selected data source ${
                        gyroSource === 'raw' ? 'Raw Gyro (gyroRAW)' : 'Filtered Gyro (gyroADC)'
                      } is not logged in this log.`
                    : null
                }
              />

              {/* Time Domain Timeline & Window Selection */}
              <TimeDomainView
                log={currentLog}
                selectedWindow={selectedWindow}
                onWindowChange={setSelectedWindow}
                currentTimeSec={currentTimeSec}
                onTimeChange={setCurrentTimeSec}
              />
            </div>
          </>
        )}
      </main>

      {/* Offline Status Indicator */}
      <OfflineIndicator />
    </div>
  );
}
