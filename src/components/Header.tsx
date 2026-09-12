import React from 'react';
import { BlackboxLog } from '../types/blackbox';
import { PWAInstallButton } from './PWAInstallButton';
import { useTheme } from '../context/ThemeContext';
import { Activity, Upload, Sun, Moon } from 'lucide-react';

interface HeaderProps {
  logs: BlackboxLog[];
  currentLogIndex: number;
  onSelectLog: (index: number) => void;
  onNewFileClick: () => void;
  fileName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  logs,
  currentLogIndex,
  onSelectLog,
  onNewFileClick,
  fileName,
}) => {
  const currentLog = logs[currentLogIndex];
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <header
      className={`sticky top-0 z-40 w-full border-b transition-colors px-4 sm:px-6 py-3 backdrop-blur-md ${
        isDark
          ? 'border-slate-800/80 bg-slate-950/90 text-white'
          : 'border-slate-200 bg-white/95 text-slate-800 shadow-xs'
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Title */}
        <div className="flex items-center gap-3">
          <div
            className={`relative flex items-center justify-center w-10 h-10 rounded-xl border transition-all ${
              isDark
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-md shadow-cyan-500/10'
                : 'bg-cyan-50 border-cyan-200 text-cyan-700 shadow-xs'
            }`}
          >
            <img src="/icon.svg" alt="Rotorflight" className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1
                className={`text-base sm:text-lg font-bold tracking-tight leading-none ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                Rotorflight Vibration
              </h1>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  isDark
                    ? 'bg-cyan-950 text-cyan-400 border-cyan-800'
                    : 'bg-cyan-100 text-cyan-800 border-cyan-300'
                }`}
              >
                BBL 2.x
              </span>
            </div>
            <p className={`text-xs mt-0.5 hidden sm:block ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              RC 헬리콥터 블랙박스 FFT 진동 분석 & 하모닉 노치 튜너
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Multi-Log Selector if file contains >1 flight */}
          {logs.length > 1 && (
            <div
              className={`flex items-center rounded-xl border p-1 text-xs ${
                isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
              }`}
            >
              <span className={`px-2 font-medium hidden sm:inline ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                비행 로그:
              </span>
              <select
                value={currentLogIndex}
                onChange={e => onSelectLog(Number(e.target.value))}
                className={`bg-transparent font-semibold py-1 px-2 focus:outline-none cursor-pointer ${
                  isDark ? 'text-white' : 'text-slate-800'
                }`}
              >
                {logs.map((log, idx) => (
                  <option
                    key={log.id}
                    value={idx}
                    className={isDark ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'}
                  >
                    로그 #{idx + 1} ({log.durationSec.toFixed(1)}s)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* New file upload button */}
          {logs.length > 0 && (
            <button
              onClick={onNewFileClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
                isDark
                  ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                  : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700 hover:text-slate-900 shadow-xs'
              }`}
            >
              <Upload className="w-3.5 h-3.5 text-cyan-500" />
              <span className="hidden sm:inline">다른 BBL 열기</span>
              <span className="sm:hidden">파일</span>
            </button>
          )}

          {/* Theme Toggle Button (Light/Dark) */}
          <button
            onClick={toggleTheme}
            aria-label={isDark ? '밝은 테마로 전환' : '어두운 테마로 전환'}
            title={isDark ? '밝은 테마 (Light Mode)' : '어두운 테마 (Dark Mode)'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition cursor-pointer ${
              isDark
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300 hover:text-amber-200'
                : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-700 hover:text-slate-900'
            }`}
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline text-slate-200">라이트</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-600" />
                <span className="hidden sm:inline text-slate-700">다크</span>
              </>
            )}
          </button>

          {/* PWA Install Button */}
          <PWAInstallButton />
        </div>
      </div>

      {/* Loaded Log Sub-bar */}
      {currentLog && (
        <div
          className={`max-w-7xl mx-auto mt-2 pt-2 border-t flex flex-wrap items-center justify-between gap-2 text-xs ${
            isDark ? 'border-slate-800/40 text-slate-400' : 'border-slate-100 text-slate-500'
          }`}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>기체:</span>
            <span
              className={`font-semibold truncate max-w-[200px] sm:max-w-none ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {currentLog.craftName || 'Rotorflight Helicopter'}
            </span>
            <span className={isDark ? 'text-slate-600' : 'text-slate-300'}>|</span>
            <span className={`font-mono ${isDark ? 'text-cyan-300' : 'text-cyan-700 font-semibold'}`}>
              {currentLog.filename}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[11px]">
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
    </header>
  );
};
