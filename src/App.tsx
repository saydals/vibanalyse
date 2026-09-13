import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { BlackboxLog, HeliConfig, VibrationSummary, FftResult } from './types/blackbox';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { VibrationOverview } from './components/VibrationOverview';
import { FftSpectrumView } from './components/FftSpectrumView';
import { TimeDomainView } from './components/TimeDomainView';
import { HarmonicsTuningAdvisor } from './components/HarmonicsTuningAdvisor';
import { NonRotorflightNotice } from './components/NonRotorflightNotice';
import { OfflineIndicator } from './components/OfflineIndicator';
import { DEFAULT_SAMPLE, REAL_SAMPLES, fetchSampleLogs } from './utils/samples';
import { computeMultiAxisFft } from './utils/fft';
import { analyzeVibrations, MIN_ANALYSIS_SEC } from './utils/blackboxParser';
import { estimateRpmForLogAsync, getRpmForSelection } from './utils/rpmEstimator';
import { useTheme } from './context/ThemeContext';
import { UploadCloud, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';

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
  const [showUploaderModal, setShowUploaderModal] = useState<boolean>(false);
  const [maxFreqRange, setMaxFreqRange] = useState<250 | 500>(250);
  const [rpmEstimating, setRpmEstimating] = useState<boolean>(false);
  const [rpmEstimateMsg, setRpmEstimateMsg] = useState<string | null>(null);

  const currentLog = logs[currentLogIndex] || logs[0];
  const isRotorflight = currentLog?.rotorflightValidation?.isRotorflight ?? true;

  const loadRealSample = useCallback(async (sampleId: string = DEFAULT_SAMPLE.id) => {
    const sample = REAL_SAMPLES.find(s => s.id === sampleId) ?? DEFAULT_SAMPLE;
    setSampleError(null);
    try {
      console.log('[loadRealSample] Fetching:', sample.file);
      const loaded = await fetchSampleLogs(sample);
      console.log('[loadRealSample] Loaded:', loaded.length, 'logs, first:', loaded[0]?.filename);
      setLogs(loaded);
      setCurrentLogIndex(0);
      setShowUploaderModal(false);
    } catch (e: any) {
      console.error('[loadRealSample] Error:', e);
      setSampleError(e?.message || '샘플 로그를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => { loadRealSample(); }, [loadRealSample]);

  // Selected FFT Window in seconds (기본값: 호버링/비행중 구간)
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
  // RPM 센서 없으면 Gyro STFT로 추정 RPM을 기존 rpm 배열과 동일 인터페이스로 주입.
  useEffect(() => {
    if (currentLog && isRotorflight) {
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
  }, [currentLog, isRotorflight]);

  // RPM 센서 없는 로그: 자이로 STFT 추정 (비동기 청크 처리, 메인스레드 블로킹 방지)
  useEffect(() => {
    if (!currentLog || !isRotorflight) return;
    if (currentLog.rpmSource !== 'none') {
      setRpmEstimateMsg(null);
      return;
    }
    if (currentLog.totalFrames < 100 || currentLog.sampleRateHz <= 0) {
      setRpmEstimateMsg('RPM 추정 불가 (데이터 부족)');
      return;
    }
    let cancelled = false;
    setRpmEstimating(true);
    setRpmEstimateMsg('RPM 자이로 추정 중…');
    estimateRpmForLogAsync(currentLog, () => {}).then(estimated => {
      if (cancelled) return;
      setRpmEstimating(false);
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
          setRpmEstimateMsg(`RPM 추정 완료 (평균 ${avg.toLocaleString()} RPM ✱추정)`);
        } else {
          setRpmEstimateMsg('RPM 추정 실패 — 1P 피크를 찾지 못했습니다');
        }
      } else {
        setRpmEstimateMsg('RPM 추정 실패 — 1P 피크를 찾지 못했습니다');
      }
    }).catch(e => {
      if (cancelled) return;
      console.error('[rpmEstimate] failed:', e);
      setRpmEstimating(false);
      setRpmEstimateMsg('RPM 추정 실패 — 1P 피크를 찾지 못했습니다');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLog?.filename, currentLog?.totalFrames, isRotorflight]);

  const handleHeadSpeedRpmChange = (rpm: number) => {
    setHeliConfig(prev => ({ ...prev, mainRpm: rpm }));
  };

  // 로그 전체 길이가 MIN_ANALYSIS_SEC 미만이면 진동 분석을 하지 않는다.
  // (빠른 구간 선택/수동 선택과 무관하게 30초 미만 로그는 분석 대상이 아니다.)
  const logTooShort = !!currentLog && currentLog.durationSec < MIN_ANALYSIS_SEC;
  const activeFft = useMemo<FftResult>(() => {
    if (!currentLog || !isRotorflight || logTooShort) {
      return emptyFftResult();
    }

    const startIdx = Math.max(0, Math.floor(selectedWindow.start * currentLog.sampleRateHz));
    const endIdx = Math.min(currentLog.totalFrames, Math.floor(selectedWindow.end * currentLog.sampleRateHz));

    return computeMultiAxisFft(
      currentLog.gyro,
      currentLog.acc,
      currentLog.sampleRateHz,
      startIdx,
      endIdx,
      1024
    );
  }, [currentLog, selectedWindow, isRotorflight, logTooShort]);

  // Compute Overall Vibration Summary (only if Rotorflight)
  const vibrationSummary = useMemo<VibrationSummary>(() => {
    console.log('[vibrationSummary] currentLog:', currentLog?.filename, 'isRotorflight:', isRotorflight, 'logTooShort:', logTooShort, 'selectedWindow:', selectedWindow);
    if (!currentLog || !isRotorflight) {
      console.log('[vibrationSummary] Early return: !currentLog || !isRotorflight');
      return {
        gyroRms: { roll: 0, pitch: 0, yaw: 0, overall: 0 },
        accRms: { x: 0, y: 0, z: 0, overall: 0 },
        gyroPeak: { roll: 0, pitch: 0, yaw: 0 },
        overallGrade: 'EXCELLENT',
        detectedHeadSpeedRpm: 2100,
        harmonics: { main1P: 35, main2P: 70, tail1P: 155, motor1P: 350 },
        peaks: [],
        diagnostics: [],
      };
    }
    if (logTooShort) {
      console.log('[vibrationSummary] Early return: logTooShort');
      return {
        gyroRms: { roll: 0, pitch: 0, yaw: 0, overall: 0 },
        accRms: { x: 0, y: 0, z: 0, overall: 0 },
        gyroPeak: { roll: 0, pitch: 0, yaw: 0 },
        overallGrade: 'EXCELLENT',
        detectedHeadSpeedRpm: 2100,
        harmonics: { main1P: 35, main2P: 70, tail1P: 155, motor1P: 350 },
        peaks: [],
        diagnostics: [{
          type: 'warning',
          title: `비행 기록이 ${MIN_ANALYSIS_SEC}초 미만이므로 분석하지 않습니다`,
          description: `이 로그의 비행 구간은 ${currentLog.durationSec.toFixed(1)}초입니다. 신뢰할 수 있는 진동 분석을 위해서는 최소 ${MIN_ANALYSIS_SEC}초 이상의 비행 기록이 필요합니다.`,
          action: '더 긴 비행 로그를 불러오거나, 새로 비행하여 블랙박스를 기록하세요.',
        }],
      };
    }
    const result = analyzeVibrations(currentLog, heliConfig, selectedWindow);
    console.log('[vibrationSummary] analyzeVibrations result:', result.gyroRms);
    return result;
  }, [currentLog, heliConfig, isRotorflight, logTooShort, selectedWindow]);

  const handleLogLoaded = (newLogs: BlackboxLog[], fileName: string) => {
    setLogs(newLogs);
    setCurrentLogIndex(0);
    setShowUploaderModal(false);
  };

  // 타임라인 바 RPM 조회 (파란 범위/빨간 지점 통합 — 센서/추정 공용)
  const selectionRpm = useMemo(() => {
    if (!currentLog) return { rpm: NaN, mode: 'range' as const, count: 0 };
    return getRpmForSelection(currentLog, selectedWindow, currentTimeSec);
  }, [currentLog, selectedWindow, currentTimeSec]);

  // 선택 구간 평균 RPM이 바뀌면 헤드스피드 표시도 추종 (수동 입력은 유지 — 추정/센서 주입 시에만 반영)
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
        onNewFileClick={() => setShowUploaderModal(true)}
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
                  샘플 로그 다시 불러오기
                </button>
              </>
            ) : (
              <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                기본 샘플 로그를 불러오는 중...
              </p>
            )}
          </div>
        ) : !isRotorflight ? (
          <div className="flex flex-col gap-4">
            <NonRotorflightNotice
              log={currentLog}
              onOpenNewFile={() => setShowUploaderModal(true)}
              onLoadValidSample={() => loadRealSample()}
            />
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
                  <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>기체:</span>
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
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>시간:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.durationSec.toFixed(1)}초
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>샘플:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.sampleRateHz} Hz
                    </span>
                  </span>
                  <span className="flex items-center gap-1 hidden md:inline-flex">
                    <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>프레임:</span>
                    <span className={isDark ? 'text-white' : 'text-slate-800 font-semibold'}>
                      {currentLog.totalFrames.toLocaleString()}
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Main Content */}
            <div className="flex flex-col gap-5">
              {/* Top Vibration Health & Metrics */}
              <VibrationOverview
                summary={vibrationSummary}
                log={currentLog}
                onSelectPeak={freq => {
                  // Focus on peak if needed
                }}
              />

               {/* Interactive FFT Spectrum Chart */}
              <FftSpectrumView
                fft={activeFft}
                headSpeedRpm={heliConfig.mainRpm}
                config={heliConfig}
                activeWindowSec={selectedWindow}
                onHeadSpeedRpmChange={handleHeadSpeedRpmChange}
                maxFreqRange={maxFreqRange}
                onMaxFreqRangeChange={setMaxFreqRange}
                rpmSource={currentLog.rpmSource}
                rpmEstimateMsg={rpmEstimateMsg}
                rpmEstimating={rpmEstimating}
                analysisNotice={
                  logTooShort
                    ? `비행 기록 ${currentLog.durationSec.toFixed(1)}초 — 최소 ${MIN_ANALYSIS_SEC}초가 못 되어 분석하지 않습니다.`
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
                selectionRpm={selectionRpm}
              />

              {/* Harmonics & Rotorflight Filter Tuner */}
              <HarmonicsTuningAdvisor
                config={heliConfig}
                onConfigChange={setHeliConfig}
                detectedRpm={vibrationSummary.detectedHeadSpeedRpm}
              />
            </div>
          </>
        )}
      </main>

      {/* File Uploader Modal */}
      {showUploaderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div
            className={`w-full max-w-3xl rounded-3xl border p-6 shadow-2xl relative my-8 transition-colors ${
              isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'
            }`}
          >
            <div
              className={`flex items-center justify-between pb-4 mb-4 border-b ${
                isDark ? 'border-slate-800' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-cyan-500" />
                <h3 className={`text-base font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  Rotorflight 블랙박스 파일 불러오기
                </h3>
              </div>
              <button
                onClick={() => setShowUploaderModal(false)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  isDark
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                닫기 ✕
              </button>
            </div>

            <FileUploader
              onLogLoaded={handleLogLoaded}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          </div>
        </div>
      )}

      {/* Offline Status Indicator */}
      <OfflineIndicator />
    </div>
  );
}
