import React, { useState } from 'react';
import { Download, Smartphone, CheckCircle, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running inside installed standalone mode
  if (isInstalled) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
        <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
        <span>앱 모드 실행 중</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {isInstallable ? (
        <button
          id="pwa-install-btn"
          onClick={install}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold shadow-md shadow-cyan-500/20 transition active:scale-95"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>안드로이드/웹앱 설치</span>
        </button>
      ) : (
        <button
          id="pwa-guide-btn"
          onClick={() => (isIOS ? setShowIOSGuide(true) : setShowAndroidGuide(true))}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-xs font-medium transition"
          title="안드로이드 홈 화면에 추가하기 안내"
        >
          <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">모바일 홈 화면 추가</span>
          <span className="sm:hidden">앱 설치</span>
        </button>
      )}

      {/* Android Guide Modal */}
      {showAndroidGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-semibold text-white">안드로이드 앱으로 설치하기</h3>
              </div>
              <button
                onClick={() => setShowAndroidGuide(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-300">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-bold text-xs">1</span>
                <div>
                  <p className="font-medium text-white">Chrome 브라우저 메뉴 터치</p>
                  <p className="text-xs text-slate-400 mt-0.5">우측 상단의 더보기(점 3개 ⋮) 버튼을 탭합니다.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-bold text-xs">2</span>
                <div>
                  <p className="font-medium text-white">"앱 설치" 또는 "홈 화면에 추가" 선택</p>
                  <p className="text-xs text-slate-400 mt-0.5">안드로이드 스마트폰에 독립 실행형 고속 앱으로 설치됩니다.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50">
                <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 font-bold text-xs">3</span>
                <div>
                  <p className="font-medium text-white">비행장 현장 오프라인 분석</p>
                  <p className="text-xs text-slate-400 mt-0.5">인터넷 연결이 없는 야외 비행장에서도 SD카드 OTG 리더기로 BBL 파일을 바로 열어 진동을 분석할 수 있습니다.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowAndroidGuide(false)}
              className="mt-5 w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* iOS Safari Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-semibold text-white">iOS 홈 화면 추가</h3>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>1. Safari 하단 <strong>공유 (Share)</strong> 버튼 탭</p>
              <p>2. 메뉴를 내려 <strong>'홈 화면에 추가'</strong> 탭</p>
            </div>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="mt-4 w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
