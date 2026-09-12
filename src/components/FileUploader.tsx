import React, { useState, useRef } from 'react';
import { UploadCloud, AlertCircle, Sparkles, HardDrive } from 'lucide-react';
import { parseBlackboxFile } from '../utils/blackboxParser';
import { REAL_SAMPLES, fetchSampleLogs, RealSample } from '../utils/samples';
import { BlackboxLog } from '../types/blackbox';
import { useTheme } from '../context/ThemeContext';

interface FileUploaderProps {
  onLogLoaded: (logs: BlackboxLog[], fileName: string) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onLogLoaded,
  isLoading,
  setIsLoading,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const result = await parseBlackboxFile(file, file.name);
      if (result.logs.length === 0) {
        throw new Error('파일에서 유효한 블랙박스 비행 로그를 찾을 수 없습니다.');
      }
      onLogLoaded(result.logs, file.name);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || '파일을 분석하는 중 오류가 발생했습니다. 올바른 .BBL 또는 .CSV 파일인지 확인해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadSample = async (sample: RealSample) => {
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const logs = await fetchSampleLogs(sample);
      onLogLoaded(logs, sample.file);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || '샘플 로그를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Rotorflight Requirement Notice Bar */}
      <div
        className={`p-3.5 rounded-2xl border flex items-center justify-between flex-wrap gap-2 text-xs transition-colors ${
          isDark
            ? 'bg-cyan-950/20 border-cyan-900/60 text-cyan-200'
            : 'bg-cyan-50 border-cyan-200 text-cyan-900'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="font-bold px-2 py-0.5 rounded bg-cyan-600 text-white text-[11px]">
            ROTORFLIGHT 전용 판별
          </span>
          <span className="leading-snug">
            BBL 헤더에 대소문자 구분 없이 <strong>&apos;rotorflight&apos;</strong>가 포함되어 있을 때 Rotorflight BBL로 자동 인정됩니다.
          </span>
        </div>
        <span className={isDark ? 'text-cyan-400' : 'text-cyan-700'}>
          (멀티로터 드론/Betaflight 등 비-Rotorflight 파일은 자동 차단)
        </span>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={e => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`relative rounded-3xl border-2 border-dashed p-8 sm:p-12 text-center transition cursor-pointer flex flex-col items-center justify-center gap-3 ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/10'
            : isDark
            ? 'border-slate-700/80 bg-slate-900/60 hover:bg-slate-900/90 hover:border-slate-600'
            : 'border-slate-300 bg-white hover:bg-slate-50 hover:border-cyan-500 shadow-xs'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".bbl,.txt,.csv,.log"
          onChange={e => handleFiles(e.target.files)}
          className="hidden"
        />

        <div
          className={`p-4 rounded-2xl border transition shadow-sm ${
            isDark
              ? 'bg-slate-800/80 border-slate-700 text-cyan-400'
              : 'bg-cyan-50 border-cyan-200 text-cyan-600'
          }`}
        >
          <UploadCloud className="w-10 h-10" />
        </div>

        <div>
          <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
            로터플라이트 블랙박스 로그 (.BBL / .CSV) 파일 선택 또는 드래그
          </h2>
          <p className={`text-xs mt-1 max-w-md mx-auto ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            MicroSD 카드(LOGS/LOG00001.BBL) 또는 Rotorflight Configurator에서 다운로드한 파일을 바로 열어 진동을 분석합니다.
          </p>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
              isDark
                ? 'bg-slate-800 text-slate-300 border-slate-700'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            .BBL 바이너리 로그
          </span>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
              isDark
                ? 'bg-slate-800 text-slate-300 border-slate-700'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            .CSV 변환 텍스트
          </span>
        </div>

        {isLoading && (
          <div
            className={`absolute inset-0 rounded-3xl backdrop-blur-xs flex items-center justify-center gap-2 font-semibold text-sm ${
              isDark ? 'bg-slate-950/80 text-cyan-400' : 'bg-white/90 text-cyan-600'
            }`}
          >
            <span className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></span>
            <span>블랙박스 데이터 파싱 및 고속 FFT 연산 중...</span>
          </div>
        )}
      </div>

      {/* Error message */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Instant Demo Sample Flights */}
      <div
        className={`rounded-2xl border p-4 sm:p-5 shadow-xs transition-colors ${
          isDark ? 'bg-slate-900/80 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div
          className={`flex items-center justify-between pb-3 border-b ${
            isDark ? 'border-slate-800' : 'border-slate-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              준비된 샘플 로그로 즉시 테스트 (클릭 시 진동 분석 시작)
            </h3>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {REAL_SAMPLES.map(sample => {
            const accent: Record<string, { badge: string; hover: string; cta: string }> = {
              emerald: {
                badge: isDark ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-emerald-50 border-emerald-200 text-emerald-700',
                hover: isDark ? 'hover:border-emerald-500/50 hover:bg-slate-800/80' : 'hover:border-emerald-400 hover:bg-emerald-50/50',
                cta: isDark ? 'text-emerald-400' : 'text-emerald-600',
              },
              amber: {
                badge: isDark ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-amber-50 border-amber-200 text-amber-700',
                hover: isDark ? 'hover:border-amber-500/50 hover:bg-slate-800/80' : 'hover:border-amber-400 hover:bg-amber-50/50',
                cta: isDark ? 'text-amber-400' : 'text-amber-600',
              },
              rose: {
                badge: isDark ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-rose-50 border-rose-200 text-rose-700',
                hover: isDark ? 'hover:border-rose-500/50 hover:bg-slate-800/80' : 'hover:border-rose-400 hover:bg-rose-50/50',
                cta: isDark ? 'text-rose-400' : 'text-rose-600',
              },
              cyan: {
                badge: isDark ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-cyan-50 border-cyan-200 text-cyan-700',
                hover: isDark ? 'hover:border-cyan-500/50 hover:bg-slate-800/80' : 'hover:border-cyan-400 hover:bg-cyan-50/50',
                cta: isDark ? 'text-cyan-400' : 'text-cyan-600',
              },
            };
            const a = accent[sample.accent] ?? accent.cyan;
            return (
              <button
                key={sample.id}
                onClick={() => loadSample(sample)}
                className={`p-3.5 rounded-xl border text-left transition group flex flex-col justify-between gap-2 cursor-pointer ${
                  isDark ? 'bg-slate-950/60 border-slate-800' : 'bg-slate-50 border-slate-200'
                } ${a.hover}`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${a.badge}`}>
                      {sample.tag}
                    </span>
                  </div>
                  <h4
                    className={`text-sm font-bold mt-1.5 transition ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    {sample.title}
                  </h4>
                  <p className={`text-[10px] mt-0.5 font-mono ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    {sample.meta}
                  </p>
                  <p className={`text-xs mt-1 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {sample.description}
                  </p>
                </div>
                <span className={`text-xs font-semibold flex items-center gap-1 ${a.cta}`}>
                  <span>샘플 불러오기</span> →
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Guide Info for pilots */}
      <div
        className={`rounded-2xl border p-4 text-xs flex items-start gap-3 transition-colors ${
          isDark ? 'bg-slate-900/60 border-slate-800 text-slate-400' : 'bg-white border-slate-200 text-slate-600'
        }`}
      >
        <HardDrive className="w-5 h-5 text-cyan-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            💡 로터플라이트(Rotorflight) 블랙박스 파일 추출 팁
          </p>
          <p className="leading-relaxed">
            - 온보드 SD 카드 장착 FC: FC에서 MicroSD 카드를 꺼내 스마트폰 OTG 리더기나 PC에 연결 후 <code>LOGS/LOG0000X.BBL</code> 파일을 직접 선택하세요.
            <br />
            - 온보드 플래시 메모리 FC: Rotorflight Configurator 연결 후 '블랙박스' 탭에서 '로그 파일로 저장'을 클릭하여 저장된 .BBL 파일을 불러옵니다.
          </p>
        </div>
      </div>
    </div>
  );
};
