import React, { useState, useMemo, useEffect } from 'react';
import { BlackboxLog, HeliConfig, VibrationSummary, FftResult } from './types/blackbox';
import { Header } from './components/Header';
import { FileUploader } from './components/FileUploader';
import { VibrationOverview } from './components/VibrationOverview';
import { FftSpectrumView } from './components/FftSpectrumView';
import { TimeDomainView } from './components/TimeDomainView';
import { HarmonicsTuningAdvisor } from './components/HarmonicsTuningAdvisor';
import { NonRotorflightNotice } from './components/NonRotorflightNotice';
import { OfflineIndicator } from './components/OfflineIndicator';
import { generateSampleFlightLog } from './utils/sampleData';
import { computeMultiAxisFft } from './utils/fft';
import { analyzeVibrations } from './utils/blackboxParser';
import { useTheme } from './context/ThemeContext';
import { Activity, Sliders, UploadCloud, ShieldAlert, Sparkles } from 'lucide-react';

export default function App() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Initial state with pre-loaded clean helicopter log for instant preview
  const [logs, setLogs] = useState<BlackboxLog[]>(() => [generateSampleFlightLog('clean')]);
  const [currentLogIndex, setCurrentLogIndex] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [showUploaderModal, setShowUploaderModal] = useState<boolean>(false);

  // Active view tab: 'dashboard' | 'tuning'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'tuning'>('dashboard');

  const currentLog = logs[currentLogIndex] || logs[0];
  const isRotorflight = currentLog?.rotorflightValidation?.isRotorflight ?? true;

  // Selected FFT Window in seconds
  const [selectedWindow, setSelectedWindow] = useState<{ start: number; end: number }>(() => ({
    start: 0,
    end: currentLog?.durationSec || 15,
  }));

  // Current playhead time
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(3.5);

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
      setSelectedWindow({ start: 0, end: currentLog.durationSec });
      setCurrentTimeSec(Math.min(currentLog.durationSec, 3.5));

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

  // Compute FFT on the selected time window (only if Rotorflight)
  const activeFft = useMemo<FftResult>(() => {
    if (!currentLog || !isRotorflight) {
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
  }, [currentLog, selectedWindow, isRotorflight]);

  // Compute Overall Vibration Summary (only if Rotorflight)
  const vibrationSummary = useMemo<VibrationSummary>(() => {
    if (!currentLog || !isRotorflight) {
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
    return analyzeVibrations(currentLog, heliConfig);
  }, [currentLog, heliConfig, isRotorflight]);

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
        {/* If the current log is NOT Rotorflight, display rejection notice and DO NOT ANALYZE */}
        {!isRotorflight ? (
          <div className="flex flex-col gap-4">
            <NonRotorflightNotice
              log={currentLog}
              onOpenNewFile={() => setShowUploaderModal(true)}
              onLoadValidSample={() => handleLogLoaded([generateSampleFlightLog('clean')])}
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

              {/* Quick file action button */}
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setShowUploaderModal(true)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition cursor-pointer ${
                    isDark
                      ? 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-white'
                      : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs'
                  }`}
                >
                  <UploadCloud className="w-3.5 h-3.5 text-cyan-500" />
                  <span>내 BBL 파일 업로드</span>
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
