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
import { useTheme } from './context/ThemeContext';
import { Activity, Sliders, UploadCloud, ShieldAlert, Sparkles, Loader2 } from 'lucide-react';

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

  // Start with no log; auto-load the bundled real Rotorflight sample (.bbl) on mount
  const [logs, setLogs] = useState<BlackboxLog[]>([]);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const [currentLogIndex, setCurrentLogIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showUploaderModal, setShowUploaderModal] = useState<boolean>(false);

  // Active view tab: 'dashboard' | 'tuning'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tuning'>('dashboard');

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

  // Auto-load the bundled real sample log once
  useEffect(() => { loadRealSample(); }, [loadRealSample]);

  // Selected FFT Window in seconds
  const [selectedWindow, setSelectedWindow] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: currentLog?.durationSec || 30,
  }));

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

  // When log changes, update window and detected RPM
  useEffect(() => {
    if (currentLog && isRotorflight) {
      console.log('[useEffect] Setting selectedWindow:', { start: 0, end: currentLog.durationSec });
      setSelectedWindow({ start: 0, end: currentLog.durationSec });

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

  const handleLogLoaded = (newLogs: BlackboxLog[]) => {
    setLogs(newLogs);
    setCurrentLogIndex(0);
    setShowUploaderModal(false);
  };

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
                실제 Rotorflight 블랙박스 샘플 로그({DEFAULT_SAMPLE.title})를 불러오는 중...
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
            {/* Navigation Tabs */}
            <div
              className={`flex flex-wrap items-center justify-between gap-3 pb-2 border-b ${
                isDark ? 'border-slate-800/80' : 'border-slate-200'
              }`}
            >
              <div
                className={`flex items-center rounded-xl p-1 border text-xs font-semibold ${
                  isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200 shadow-xs'
                }`}
              >
                <button
                  id="tab-dashboard"
                  onClick={() => setActiveTab('dashboard')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition cursor-pointer ${
                    activeTab === 'dashboard'
                      ? 'bg-cyan-600 text-white shadow-xs font-bold'
                      : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>진동 종합 & FFT 스펙트럼</span>
                </button>

                <button
                  id="tab-tuning"
                  onClick={() => setActiveTab('tuning')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg transition cursor-pointer ${
                    activeTab === 'tuning'
                      ? 'bg-cyan-600 text-white shadow-xs font-bold'
                      : isDark
                      ? 'text-slate-400 hover:text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>기어비 & 하모닉 튜너</span>
                </button>
               </div>
             </div>

            {/* Tab 1: Dashboard (Vibration Overview + FFT Spectrum + Timeline) */}
            {activeTab === 'dashboard' && (
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
                />
              </div>
            )}

            {/* Tab 2: Harmonics & Rotorflight Filter Tuner */}
            {activeTab === 'tuning' && (
              <div className="flex flex-col gap-5">
                <HarmonicsTuningAdvisor
                  config={heliConfig}
                  onConfigChange={setHeliConfig}
                  detectedRpm={vibrationSummary.detectedHeadSpeedRpm}
                />

                <FftSpectrumView
                  fft={activeFft}
                  headSpeedRpm={heliConfig.mainRpm}
                  config={heliConfig}
                  activeWindowSec={selectedWindow}
                  onHeadSpeedRpmChange={handleHeadSpeedRpmChange}
                  analysisNotice={
                    logTooShort
                      ? `비행 기록 ${currentLog.durationSec.toFixed(1)}초 — 최소 ${MIN_ANALYSIS_SEC}초가 못 되어 분석하지 않습니다.`
                      : null
                  }
                />
              </div>
            )}
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
