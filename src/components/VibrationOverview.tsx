import React from 'react';
import { VibrationSummary, BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';
import { ShieldCheck, AlertTriangle, AlertCircle, CheckCircle2, Cpu, Wrench, Compass, Info } from 'lucide-react';

interface VibrationOverviewProps {
  summary: VibrationSummary;
  log: BlackboxLog;
  onSelectPeak?: (freq: number) => void;
}

export const VibrationOverview: React.FC<VibrationOverviewProps> = ({
  summary,
  log,
  onSelectPeak,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const getGradeBadge = (grade: VibrationSummary['overallGrade']) => {
    switch (grade) {
      case 'EXCELLENT':
        return {
          label: 'Airframe Condition EXCELLENT',
          color: isDark
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-emerald-50 border-emerald-300 text-emerald-800',
          icon: <ShieldCheck className="w-5 h-5 text-emerald-500" />,
          desc: 'Gyro noise is very low and clean, so the helicopter can deliver its best handling.',
        };
      case 'GOOD':
        return {
          label: 'Airframe Condition GOOD',
          color: isDark
            ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
            : 'bg-cyan-50 border-cyan-300 text-cyan-800',
          icon: <CheckCircle2 className="w-5 h-5 text-cyan-500" />,
          desc: 'Residual vibration is at a normal level and is suitable for regular flight.',
        };
      case 'MODERATE':
        return {
          label: 'Airframe Condition MODERATE',
          color: isDark
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
            : 'bg-amber-50 border-amber-300 text-amber-800',
          icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
          desc: 'Some mechanical vibration was detected. Check the blade balance and damper condition.',
        };
      case 'WARNING':
        return {
          label: 'Vibration WARNING',
          color: isDark
            ? 'bg-orange-500/10 border-orange-500/30 text-orange-400'
            : 'bg-orange-50 border-orange-300 text-orange-800',
          icon: <AlertTriangle className="w-5 h-5 text-orange-500" />,
          desc: 'Strong vibration persists at specific frequencies. It degrades flight stability and causes motor heat.',
        };
      case 'CRITICAL':
        return {
          label: 'Severe Vibration CRITICAL',
          color: isDark
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            : 'bg-rose-50 border-rose-300 text-rose-800',
          icon: <AlertTriangle className="w-5 h-5 text-rose-500" />,
          desc: 'Vibration far exceeds the tolerance limit. There is a risk of airframe damage, so a careful inspection is required.',
        };
    }
  };

  const gradeInfo = getGradeBadge(summary.overallGrade);

  return (
    <div className="flex flex-col gap-4">
      {/* Top Banner: Overall Vibration Grade & Summary */}
      <div className={`rounded-2xl p-4 sm:p-5 border ${gradeInfo.color} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm`}>
        <div className="flex items-center gap-3.5">
          <div className={`p-2.5 rounded-xl border border-inherit ${isDark ? 'bg-slate-950/60' : 'bg-white/80'}`}>
            {gradeInfo.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Overall Vibration Grade
              </span>
            </div>
            <h2 className={`text-lg sm:text-xl font-bold mt-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {gradeInfo.label}
            </h2>
            <p className={`text-xs mt-1 max-w-xl ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              {gradeInfo.desc}
            </p>
          </div>
        </div>

        {/* Quick Stats Pill */}
        <div className="flex flex-wrap sm:flex-col items-end gap-2 text-right">
          <div className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 ${
            isDark ? 'bg-slate-950/80 border-slate-800' : 'bg-white/90 border-slate-200'
          }`}>
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Average gyro RMS:</span>
            <span className={`font-mono font-bold text-sm ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
              {summary.gyroRms.overall.toFixed(1)}°/s
            </span>
          </div>
          <div className={`px-3 py-1.5 rounded-xl border text-xs flex items-center gap-2 ${
            isDark ? 'bg-slate-950/80 border-slate-800' : 'bg-white/90 border-slate-200'
          }`}>
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>Accelerometer RMS:</span>
            <span className={`font-mono font-bold text-sm ${isDark ? 'text-purple-400' : 'text-purple-600'}`}>
              {summary.accRms.overall.toFixed(2)}G
            </span>
          </div>
        </div>
      </div>

      {/* Vibration Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Roll Gyro Card */}
        <div className={`rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-colors ${
          isDark ? 'bg-slate-900/80 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500"></span>
              Roll (gyro roll axis)
            </span>
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Peak: {summary.gyroPeak.roll < 2 ? summary.gyroPeak.roll.toFixed(2) : summary.gyroPeak.roll.toFixed(1)}°/s
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className={`text-2xl font-bold font-mono ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
              {summary.gyroRms.roll < 2 ? summary.gyroRms.roll.toFixed(2) : summary.gyroRms.roll.toFixed(1)}
            </span>
            <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RMS deg/s</span>
          </div>
          {/* Visual level meter */}
          <div className={`w-full rounded-full h-1.5 mt-2 overflow-hidden ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
            <div
              className="h-full bg-cyan-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (summary.gyroRms.roll / 40) * 100)}%` }}
            />
          </div>
        </div>

        {/* Pitch Gyro Card */}
        <div className={`rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-colors ${
          isDark ? 'bg-slate-900/80 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              Pitch (gyro pitch axis)
            </span>
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Peak: {summary.gyroPeak.pitch < 2 ? summary.gyroPeak.pitch.toFixed(2) : summary.gyroPeak.pitch.toFixed(1)}°/s
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className={`text-2xl font-bold font-mono ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
              {summary.gyroRms.pitch < 2 ? summary.gyroRms.pitch.toFixed(2) : summary.gyroRms.pitch.toFixed(1)}
            </span>
            <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RMS deg/s</span>
          </div>
          <div className={`w-full rounded-full h-1.5 mt-2 overflow-hidden ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (summary.gyroRms.pitch / 40) * 100)}%` }}
            />
          </div>
        </div>

        {/* Yaw Gyro Card */}
        <div className={`rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-colors ${
          isDark ? 'bg-slate-900/80 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              Yaw (gyro yaw axis / tail)
            </span>
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              Peak: {summary.gyroPeak.yaw < 2 ? summary.gyroPeak.yaw.toFixed(2) : summary.gyroPeak.yaw.toFixed(1)}°/s
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className={`text-2xl font-bold font-mono ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
              {summary.gyroRms.yaw < 2 ? summary.gyroRms.yaw.toFixed(2) : summary.gyroRms.yaw.toFixed(1)}
            </span>
            <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>RMS deg/s</span>
          </div>
          <div className={`w-full rounded-full h-1.5 mt-2 overflow-hidden ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (summary.gyroRms.yaw / 40) * 100)}%` }}
            />
          </div>
        </div>

        {/* Accelerometer 3-Axis Card */}
        <div className={`rounded-2xl border p-3.5 shadow-xs flex flex-col justify-between transition-colors ${
          isDark ? 'bg-slate-900/80 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className={`flex items-center justify-between pb-2 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <span className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              <Compass className={`w-3.5 h-3.5 ${isDark ? 'text-purple-400' : 'text-purple-600'}`} />
              Accelerometer vibration (G-Force)
            </span>
            <span className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Total: {summary.accRms.overall.toFixed(2)}G</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1 font-mono text-center">
            <div className={`p-1 rounded border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <span className={`text-[9px] block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Acc X</span>
              <span className={`text-xs font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>{summary.accRms.x.toFixed(2)}G</span>
            </div>
            <div className={`p-1 rounded border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <span className={`text-[9px] block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Acc Y</span>
              <span className={`text-xs font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>{summary.accRms.y.toFixed(2)}G</span>
            </div>
            <div className={`p-1 rounded border ${isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
              <span className={`text-[9px] block ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Acc Z</span>
              <span className={`text-xs font-bold ${isDark ? 'text-purple-300' : 'text-purple-700'}`}>{summary.accRms.z.toFixed(2)}G</span>
            </div>
          </div>
        </div>
      </div>

      {/* Diagnostics & Recommendations List */}
      <div className={`rounded-2xl border p-4 shadow-sm transition-colors ${
        isDark ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
      }`}>
        <h3 className={`text-sm font-semibold flex items-center gap-2 pb-3 border-b ${
          isDark ? 'border-slate-800 text-white' : 'border-slate-100 text-slate-900'
        }`}>
          <Wrench className={`w-4 h-4 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`} />
          <span>Helicopter Mechanical Diagnosis & Rotorflight Tuning Guide</span>
        </h3>

        <div className="mt-3 space-y-2.5">
          {summary.diagnostics.map((diag, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row items-start justify-between gap-3 ${
                diag.type === 'error'
                  ? isDark
                    ? 'bg-rose-950/30 border-rose-800/50 text-rose-200'
                    : 'bg-rose-50 border-rose-200 text-rose-800'
                  : diag.type === 'warning'
                  ? isDark
                    ? 'bg-amber-950/30 border-amber-800/50 text-amber-200'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                  : diag.type === 'success'
                  ? isDark
                    ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-200'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : isDark
                  ? 'bg-slate-950/60 border-slate-800 text-slate-300'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className={`font-semibold text-sm flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {diag.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />}
                  {diag.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />}
                  {diag.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  {diag.type === 'info' && <Info className="w-4 h-4 text-cyan-500 flex-shrink-0" />}
                  <span>{diag.title}</span>
                </div>
                <p className={`leading-relaxed ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{diag.description}</p>
              </div>

              {diag.action && (
                <div className={`w-full sm:w-auto px-3 py-1.5 rounded-lg border font-medium text-xs ${
                  isDark ? 'bg-slate-900/80 border-inherit text-cyan-300' : 'bg-white border-inherit text-cyan-700 shadow-xs'
                }`}>
                  👉 Recommended action: {diag.action}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Identified Vibration Peaks Section */}
      {summary.peaks.length > 0 && (
        <div className={`rounded-2xl border p-4 shadow-sm transition-colors ${
          isDark ? 'bg-slate-900/90 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'
        }`}>
          <div className={`flex items-center justify-between pb-3 border-b ${isDark ? 'border-slate-800' : 'border-slate-100'}`}>
            <h3 className={`text-sm font-semibold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              <Cpu className={`w-4 h-4 ${isDark ? 'text-purple-400' : 'text-purple-600'}`} />
              <span>Detected Vibration Peaks (Detected Harmonic Resonance)</span>
            </h3>
            <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Click a peak to inspect that frequency</span>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {summary.peaks.map((pk, idx) => (
              <button
                key={idx}
                onClick={() => onSelectPeak?.(pk.freqHz)}
                className={`p-3 rounded-xl border text-left transition flex items-start justify-between gap-2 group cursor-pointer ${
                  isDark
                    ? 'bg-slate-950/70 hover:bg-slate-800/80 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-50 hover:bg-white border-slate-200 hover:border-cyan-300 hover:shadow-xs'
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                      isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {pk.axis}
                    </span>
                    <span className={`font-mono font-bold text-sm ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
                      {pk.freqHz} Hz
                    </span>
                    <span className={`text-[11px] font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      ({pk.amplitude < 2 ? pk.amplitude.toFixed(2) : pk.amplitude.toFixed(1)}°/s)
                    </span>
                  </div>
                  <p className={`text-xs mt-1 leading-snug ${
                    isDark ? 'text-slate-300 group-hover:text-white' : 'text-slate-600 group-hover:text-slate-900'
                  }`}>
                    {pk.probableSource}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
