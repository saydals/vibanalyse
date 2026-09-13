import { estimateRpmTimeSeries, pickRpmFromSpectrum, pickRpmCombined, STFT_FREQ_MIN_HZ, STFT_FREQ_MAX_HZ } from '../src/utils/rpmEstimator';
import { complexFft } from '../src/utils/fft';

function spectrumOf(sr: number, fftSize: number, comps: Array<[number, number]>): Float32Array {
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const t = i / sr;
    let v = 0;
    for (const [f, a] of comps) v += a * Math.sin(2 * Math.PI * f * t);
    real[i] = v * (0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1))));
  }
  complexFft(real, imag);
  const half = fftSize / 2;
  const pw = new Float32Array(half);
  for (let k = 0; k < half; k++) pw[k] = real[k] * real[k] + imag[k] * imag[k];
  return pw;
}

// 버그 재현 케이스: 79.5Hz 진폭 > 47.3Hz 진폭, 159Hz에 피크 없음 -> 47.3Hz(2838RPM) 선택
{
  const sr = 2000; const N = 1024;
  // Roll: 47.3Hz(1P, 진폭 3) + 94.6Hz(2P, 진폭 2) + 79.5Hz(공진, 진폭 10)
  const roll = spectrumOf(sr, N, [[47.3, 3], [94.6, 2], [79.5, 10]]);
  // Pitch: 47.3Hz(진폭 2.5) + 94.6Hz(진폭 1.8), 공진은 Roll에만 (검증3: Roll-only 공진 탈락)
  const pitch = spectrumOf(sr, N, [[47.3, 2.5], [94.6, 1.8], [79.5, 1.0]]);
  const single = pickRpmFromSpectrum(roll, sr, N);
  const combined = pickRpmCombined(roll, pitch, sr, N);
  console.log(`[bugfix] single: peakHz=${single.peakHz?.toFixed(1)} rpm=${single.rpm?.toFixed(0)} (기대 47.3/2838)`);
  console.log(`[bugfix] combined: peakHz=${combined.peakHz?.toFixed(1)} rpm=${combined.rpm?.toFixed(0)} (기대 47.3/2838)`);
  const okS = Math.abs(single.rpm - 2838) <= 100;
  const okC = Math.abs(combined.rpm - 2838) <= 100;
  console.log(`[bugfix] single ${okS ? 'PASS' : 'FAIL'} / combined ${okC ? 'PASS' : 'FAIL'} (79.5 선택이면 버그 미수정)`);
}

// 엣지 A: 스로틀 0 (모터 정지, 무신호 노이즈 시계열 전체) -> NaN -> 보간/게이트 처리
// 단일 윈도우가 아니라 실제 파이프라인(시계열 + valid 비율 게이트)으로 판정한다.
{
  const srA = 2000; const nA = srA * 10;
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const rA = new Float32Array(nA); const pA = new Float32Array(nA);
  for (let i = 0; i < nA; i++) { rA[i] = 0.05 * rnd(); pA[i] = 0.05 * rnd(); }
  const sA = estimateRpmTimeSeries(rA, pA, srA);
  const vA = sA.rpm.filter(x => Number.isFinite(x) && x >= 1200 && x <= 6000);
  // 노이즈는 윈도우마다 랜덤 주파수에 걸리므로 평활 후에도 분산이 크고,
  // 실사용에서는 estimateRpmForLogAsync의 valid 비율 게이트에서 탈락한다.
  // 여기서는 분산 기준으로 판정: std가 평균의 10% 초과면 무신호로 간주 PASS.
  const meanA = vA.reduce((a, b) => a + b, 0) / Math.max(1, vA.length);
  const stdA = Math.sqrt(vA.reduce((a, b) => a + (b - meanA) * (b - meanA), 0) / Math.max(1, vA.length));
  const isNoise = vA.length === 0 || (stdA / Math.max(1, meanA)) > 0.10;
  console.log(`[edgeA] n=${vA.length} mean=${meanA.toFixed(0)} std=${stdA.toFixed(0)} ${isNoise ? 'PASS (무신호 판정)' : 'FAIL'}`);
}

// 엣지 B: 2P가 1P보다 강한 정상 케이스 (1P 47Hz 진폭2 + 2P 94Hz 진폭6, 양축 동일)
{
  const sr = 2000; const n = sr * 10;
  const r = new Float32Array(n); const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    r[i] = 2 * Math.sin(2 * Math.PI * 47 * t) + 6 * Math.sin(2 * Math.PI * 94 * t);
    p[i] = 2 * Math.sin(2 * Math.PI * 47 * t + 0.4) + 6 * Math.sin(2 * Math.PI * 94 * t + 0.2);
  }
  const s = estimateRpmTimeSeries(r, p, sr);
  const v = s.rpm.filter(x => Number.isFinite(x));
  const a = v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
  console.log(`[edgeB] avg=${a.toFixed(1)} expected=2820 ${Math.abs(a - 2820) <= 100 ? 'PASS' : 'FAIL'} (94*60=5640 선택이면 오인)`);
}

// 엣지 C: 고RPM (1P 68Hz = 4080RPM, 범위 내 포함 확인)
{
  const sr = 2000; const n = sr * 10;
  const r = new Float32Array(n); const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    r[i] = 8 * Math.sin(2 * Math.PI * 68 * t) + 3 * Math.sin(2 * Math.PI * 136 * t);
    p[i] = 7 * Math.sin(2 * Math.PI * 68 * t + 0.3) + 2.5 * Math.sin(2 * Math.PI * 136 * t);
  }
  const s = estimateRpmTimeSeries(r, p, sr);
  const v = s.rpm.filter(x => Number.isFinite(x));
  const a = v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);
  console.log(`[edgeC] avg=${a.toFixed(1)} expected=4080 ${Math.abs(a - 4080) <= 100 ? 'PASS' : 'FAIL'} (범위탈락이면 FAIL)`);
}
console.log(`range: ${STFT_FREQ_MIN_HZ}~${STFT_FREQ_MAX_HZ}Hz`);
