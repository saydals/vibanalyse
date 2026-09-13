import React from 'react';
import { BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';
import { Upload, Sun, Moon } from 'lucide-react';

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
        {/* Title */}
        <h1
          className={`ml-8 text-base sm:text-lg font-bold tracking-tight leading-none ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          Rotorflight Vibration Analyser
        </h1>

        {/* Right side: controls */}
        <div className="flex items-center gap-2 mr-8">
            {/* Multi-Log Selector if file contains >1 flight */}
            {logs.length > 1 && (
              <div
                className={`flex items-center rounded-xl border p-1 text-xs ${
                  isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-200'
                }`}
              >
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
                <span className="hidden sm:inline">BBL 열기</span>
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
          </div>
      </div>
    </header>
  );
};
