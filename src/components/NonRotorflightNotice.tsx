import React from 'react';
import { BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';
import { AlertOctagon, CheckCircle2, XCircle, FileWarning, ArrowLeft, RefreshCw, Cpu, Layers, Disc, FileCode } from 'lucide-react';

interface NonRotorflightNoticeProps {
  log: BlackboxLog;
  onOpenNewFile: () => void;
  onLoadValidSample?: () => void;
}

export const NonRotorflightNotice: React.FC<NonRotorflightNoticeProps> = ({
  log,
  onOpenNewFile,
  onLoadValidSample,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const val = log.rotorflightValidation;

  const headerValid = val.hasRotorflightHeader;
  const motorValid = val.motorCount === 1 || val.motorCount === 2;
  const servoValid = val.hasServos;
  const collectiveValid = val.hasCollective;

  return (
    <div className="max-w-4xl mx-auto my-6 px-4">
      {/* Main Alert Card */}
      <div
        className={`rounded-2xl border p-6 sm:p-8 transition-all ${
          isDark
            ? 'bg-rose-950/20 border-rose-900/60 text-slate-200'
            : 'bg-rose-50 border-rose-200 text-slate-800'
        }`}
      >
        {/* Header section */}
        <div className={`flex flex-col sm:flex-row items-start sm:items-center gap-4 border-b pb-6 ${isDark ? 'border-rose-900/40' : 'border-rose-200'}`}>
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-rose-500/20 border border-rose-500/40 text-rose-500 shrink-0 shadow-lg shadow-rose-500/10">
            <AlertOctagon className="w-8 h-8" />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-500 text-white">
                비-Rotorflight (멀티로터 드론) 감지
              </span>
              <span
                className={`text-xs font-mono px-2 py-0.5 rounded border ${
                  isDark
                    ? 'bg-slate-900 border-slate-700 text-slate-300'
                    : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                {log.filename}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-rose-600 dark:text-rose-400">
              ROTORFLIGHT BBL 헤더가 확인되지 않아 분석하지 않습니다
            </h2>
            <p className={`text-sm mt-1.5 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              본 프로그램은 <strong className="font-semibold">Rotorflight RC 헬리콥터 전용 진동 분석기</strong>입니다.
              멀티로터 드론(Betaflight/INAV 등)과의 오인 방지를 위해, <strong>BBL 헤더에 대소문자 구분 없이 &apos;rotorflight&apos;</strong> 식별자가 존재할 때만 분석이 실행됩니다.
            </p>
          </div>
        </div>

        {/* Validation Requirement Breakdown */}
        <div className="mt-6">
          <h3 className={`text-sm font-bold uppercase tracking-wider mb-3 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            로터플라이트(Rotorflight) 헤더 및 규격 검증 결과
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Criterion 1: BBL Header Check (Primary) */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                headerValid
                  ? isDark
                    ? 'bg-emerald-950/20 border-emerald-900/50'
                    : 'bg-emerald-50 border-emerald-200'
                  : isDark
                  ? 'bg-slate-900/80 border-rose-900/70'
                  : 'bg-white border-rose-300 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-semibold text-xs text-slate-400">
                  <FileCode className="w-4 h-4 text-cyan-400" />
                  1. BBL 헤더 식별자
                </span>
                {headerValid ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> 일치
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-rose-500">
                    <XCircle className="w-4 h-4" /> 미검출
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>필수 조건:</span>
                  <span className="font-mono text-cyan-600 dark:text-cyan-400">&apos;rotorflight&apos; 포함</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>헤더 결과:</span>
                  <span className={`font-mono font-bold ${headerValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {headerValid ? '확인 완료' : '식별자 없음'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 truncate" title={val.details.firmwareHeader || '헤더 내 식별자 부재'}>
                  {val.details.firmwareHeader ? `감지: ${val.details.firmwareHeader}` : '대소문자 무관 헤더 검색'}
                </p>
              </div>
            </div>

            {/* Criterion 2: Motors */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                motorValid
                  ? isDark
                    ? 'bg-emerald-950/20 border-emerald-900/50'
                    : 'bg-emerald-50 border-emerald-200'
                  : isDark
                  ? 'bg-slate-900/80 border-rose-900/70'
                  : 'bg-white border-rose-300 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-semibold text-xs text-slate-400">
                  <Disc className="w-4 h-4 text-cyan-400" />
                  2. 모터(Motor) 개수
                </span>
                {motorValid ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> 일치
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-rose-500">
                    <XCircle className="w-4 h-4" /> 불합격
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>필수 조건:</span>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">1~2개 (헬리콥터)</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>감지된 모터:</span>
                  <span className={`font-mono font-bold ${motorValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {val.motorCount}개 {val.motorCount >= 4 ? '(쿼드 드론)' : ''}
                  </span>
                </div>
                {val.details.motorFields.length > 0 && (
                  <p className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                    [{val.details.motorFields.slice(0, 4).join(', ')}]
                  </p>
                )}
              </div>
            </div>

            {/* Criterion 3: Servos */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                servoValid
                  ? isDark
                    ? 'bg-emerald-950/20 border-emerald-900/50'
                    : 'bg-emerald-50 border-emerald-200'
                  : isDark
                  ? 'bg-slate-900/80 border-rose-900/70'
                  : 'bg-white border-rose-300 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-semibold text-xs text-slate-400">
                  <Cpu className="w-4 h-4 text-cyan-400" />
                  3. 서보(Servo) 항목
                </span>
                {servoValid ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> 일치
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-rose-500">
                    <XCircle className="w-4 h-4" /> 불합격
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>필수 조건:</span>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">스와시 서보</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>감지된 서보:</span>
                  <span className={`font-mono font-bold ${servoValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {val.servoCount > 0 ? `${val.servoCount}개 감지됨` : '서보 항목 없음'}
                  </span>
                </div>
                {val.details.servoFields.length > 0 ? (
                  <p className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                    [{val.details.servoFields.slice(0, 3).join(', ')}]
                  </p>
                ) : (
                  <p className="text-[11px] text-rose-400 mt-1">
                    멀티로터 드론은 서보 없음
                  </p>
                )}
              </div>
            </div>

            {/* Criterion 4: Collective */}
            <div
              className={`p-4 rounded-xl border transition-all ${
                collectiveValid
                  ? isDark
                    ? 'bg-emerald-950/20 border-emerald-900/50'
                    : 'bg-emerald-50 border-emerald-200'
                  : isDark
                  ? 'bg-slate-900/80 border-rose-900/70'
                  : 'bg-white border-rose-300 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 font-semibold text-xs text-slate-400">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  4. COLLECTIVE 피치
                </span>
                {collectiveValid ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-emerald-500">
                    <CheckCircle2 className="w-4 h-4" /> 일치
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-bold text-rose-500">
                    <XCircle className="w-4 h-4" /> 불합격
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>필수 조건:</span>
                  <span className="font-medium text-cyan-600 dark:text-cyan-400">가변 피치 제어</span>
                </div>
                <div className="flex justify-between">
                  <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>감지된 항목:</span>
                  <span className={`font-mono font-bold ${collectiveValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {val.hasCollective ? 'COLLECTIVE 존재' : '항목 없음'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 truncate">
                  헬리콥터 피치 제어 신호
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Reasons List */}
        {val.reasons.length > 0 && (
          <div
            className={`mt-5 p-4 rounded-xl border ${
              isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
            }`}
          >
            <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
              <FileWarning className="w-4 h-4" />
              규격 불일치 상세 사유
            </h4>
            <ul className="space-y-1.5 text-xs">
              {val.reasons.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-rose-500 font-bold">•</span>
                  <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{reason}</span>
                </li>
              ))}
            </ul>

            <div className={`mt-3 pt-3 border-t text-[11px] flex flex-wrap gap-x-4 gap-y-1 ${isDark ? 'border-slate-800 text-slate-400' : 'border-slate-100 text-slate-500'}`}>
              <span><strong>감지 펌웨어 헤더:</strong> {val.details.firmwareHeader || log.firmwareType || '확인 불가'}</span>
              <span><strong>프레임 수:</strong> {log.totalFrames.toLocaleString()}</span>
              <span><strong>기체 이름:</strong> {log.craftName || '알 수 없음'}</span>
              <span><strong>루프타임:</strong> {log.looptimeUs}µs ({log.sampleRateHz}Hz)</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {onLoadValidSample && (
            <button
              onClick={onLoadValidSample}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/20 transition cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              정상 Rotorflight 샘플 불러오기 (OMP M4)
            </button>
          )}

          <button
            onClick={onOpenNewFile}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
              isDark
                ? 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
                : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-700'
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            다른 BBL 파일 선택하기
          </button>
        </div>
      </div>
    </div>
  );
};
