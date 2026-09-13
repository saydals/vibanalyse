/**
 * Gyro STFT 기반 RPM 추정 모듈
 * - RPM 센서(headspeed)가 없는 BBL 로그에서 Roll/Pitch 자이로 STFT로 시간대별 RPM 추정
 */
import { complexFft } from './fft';
import type { BlackboxLog } from '../types/blackbox';

export const STFT_WINDOW_SEC = 0.5;
export const STFT_STEP_SEC = 0.1;
export const STFT_FREQ_MIN_HZ = 20;
export const STFT_FREQ_MAX_HZ = 80;
export const STFT_SNR_THRESHOLD = 3;
/** 2P(블레이드 통과) 고조파 검증 허용 오차 (Hz) */
export const STFT_HARMONIC_TOL_HZ = 3;
/** 2P 고조파가 1P 후보 대비 최소 몇 배여야 1P로 인정하는지 */
export const STFT_HARMONIC_MIN_RATIO = 0.15;
/**
 * 탐색 주파수 범위 근거:
 * - 외부 제안(RPM 800~4200 → 13.3~70Hz)은 79.5Hz를 범위 탈락시키지만,
 *   정상 고RPM 기체(1P 70~80Hz = 4200~4800RPM)까지 잘라내므로 미채택.
 * - 20~80Hz 유지 + 하모닉 곱 스코어로 79.5Hz 오검출을 원천 탈락시킨다.
 */

export interface RpmTimeSeries {
  timeMs: number[];
  rpm: number[];
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function interpolateNaN(rpm: number[]): void {
  const n = rpm.length;
  if (n === 0) return;
  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(rpm[i])) { firstValid = i; break; }
  }
  if (firstValid === -1) return;
  for (let i = 0; i < firstValid; i++) rpm[i] = rpm[firstValid];
  let prevIdx = firstValid;
  for (let i = firstValid + 1; i < n; i++) {
    if (Number.isFinite(rpm[i])) {
      if (i - prevIdx > 1) {
        const v0 = rpm[prevIdx];
        const v1 = rpm[i];
        for (let j = prevIdx + 1; j < i; j++) {
          const t = (j - prevIdx) / (i - prevIdx);
          rpm[j] = v0 + (v1 - v0) * t;
        }
      }
      prevIdx = i;
    }
  }
  for (let i = prevIdx + 1; i < n; i++) rpm[i] = rpm[prevIdx];
}

export function smoothRpm(rpm: number[], medianWindow = 5, avgWindow = 3): number[] {
  const n = rpm.length;
  if (n === 0) return [];
  // 1차: 중앙값 필터 — 이웃 중앙값으로 교체 (스파이크 제거, 스로틀 추종은 보존)
  const half = Math.floor(medianWindow / 2);
  const med: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const vals: number[] = [];
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < n && Number.isFinite(rpm[j])) vals.push(rpm[j]);
    }
    med[i] = vals.length > 0 ? median(vals) : rpm[i];
  }
  const h2 = Math.floor(avgWindow / 2);
  const avg: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; let c = 0;
    for (let j = i - h2; j <= i + h2; j++) {
      if (j >= 0 && j < n && Number.isFinite(med[j])) { s += med[j]; c++; }
    }
    avg[i] = c > 0 ? s / c : med[i];
  }
  // 3차: Hampel 패스 — 이동평균에 스며든 연속 스파이크(≤4개) 제거.
  // 점진적 스로틀 변화(윈도우 내 < 250RPM)는 보존된다.
  const h3 = 4;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const vals: number[] = [];
    for (let j = i - h3; j <= i + h3; j++) {
      if (j >= 0 && j < n && Number.isFinite(avg[j])) vals.push(avg[j]);
    }
    const m = vals.length > 0 ? median(vals) : avg[i];
    const v = avg[i];
    if (Number.isFinite(v) && Number.isFinite(m) && Math.abs(v - m) > Math.max(250, m * 0.08)) {
      out[i] = m;
    } else {
      out[i] = v;
    }
  }
  return out;
}

/**
 * 단일 스펙트럼(power, 0..Nyquist)에서 RPM 선택.
 * 규칙: 20~80Hz 내 로컬 피크들 중 하모닉 곱 스코어(p1 × p2)가 최대인 후보를 1P로 선택.
 * (외부 제안 검증 2의 핵심을 채택: 47.3Hz는 p(47.3)×p(94.7)が高く 채택,
 *  79.5Hz는 p(79.5)×p(159)에 피크가 없어 탈락한다.)
 * 반환: { rpm, peakHz, peakPower, harmonicPower } — 유효 후보 없으면 rpm=NaN
 */
export interface SpectrumPick {
  rpm: number; peakHz: number; peakPower: number; harmonicPower: number;
  multScore: number; addScore: number;
}

/**
 * 단일 스펙트럼 후보 스코어링 (외부 제안 검증 2 핵심 + 기존 가드).
 * - powerAtHz: 특정 주파수 ±2빈 최대값 조회
 * - score = p1 x p2 (하모닉 곱), SNR 게이트 + 2P오인 스킵 포함
 */
export function scoreSpectrumPeaks(
  powers: Float32Array,
  sampleRate: number,
  fftSize: number,
  freqMin = STFT_FREQ_MIN_HZ,
  freqMax = STFT_FREQ_MAX_HZ,
  snrThreshold = STFT_SNR_THRESHOLD,
): Map<number, SpectrumPick> {
  const nyquist = sampleRate / 2;
  const kMin = Math.max(1, Math.floor((freqMin * fftSize) / sampleRate));
  const kMax = Math.min(Math.floor(powers.length) - 1, Math.ceil((freqMax * fftSize) / sampleRate));
  const binHz = sampleRate / fftSize;
  if (kMax <= kMin || !(binHz > 0)) return new Map<number, SpectrumPick>();
  // 범위 평균 파워 (SNR 게이트용)
  let sum = 0;
  for (let k = kMin; k <= kMax; k++) sum += powers[k];
  const meanPower = sum / Math.max(1, kMax - kMin + 1);
  if (!(meanPower > 0)) return new Map<number, SpectrumPick>();
  // 특정 주파수 파워 조회: ±2빈(외부 제안 powerAtHz) + 허용오차 병합
  const tolBins = Math.max(2, Math.round(STFT_HARMONIC_TOL_HZ / binHz));
  const powerAtHz = (freqHz: number): number => {
    const kc = Math.round((freqHz * fftSize) / sampleRate);
    let mx = 0;
    for (let j = kc - tolBins; j <= kc + tolBins; j++) {
      if (j >= 0 && j < powers.length && powers[j] > mx) mx = powers[j];
    }
    return mx;
  };
  const hPowerOf = (f1: number): number => {
    const f2 = f1 * 2;
    return f2 < nyquist ? powerAtHz(f2) : 0;
  };
  const picks = new Map<number, SpectrumPick>();
  const scorePeak = (k: number, p: number): void => {
    let refinedK = k;
    const a = powers[k - 1]; const b = powers[k]; const c = powers[k + 1];
    const d = a - 2 * b + c;
    if (Math.abs(d) > 1e-12) {
      const delta = (0.5 * (a - c)) / d;
      if (Math.abs(delta) <= 1) refinedK = k + delta;
    }
    const f1 = (refinedK * sampleRate) / fftSize;
    if (!(f1 >= freqMin && f1 <= freqMax)) return;
    const hPower = hPowerOf(f1);
    const multScore = p * hPower;
    const hFloor = meanPower * STFT_HARMONIC_MIN_RATIO;
    const addScore = p + Math.max(0, hPower - hFloor) * 0.5;
    picks.set(k, { rpm: f1 * 60, peakHz: f1, peakPower: p, harmonicPower: hPower, multScore, addScore });
  };
  for (let k = kMin + 1; k <= kMax - 1; k++) {
    const p = powers[k];
    if (!(p > powers[k - 1]) || !(p >= powers[k + 1])) continue;
    // SNR 게이트: 강한 피크는 그대로 통과.
    // 약한 피크라도 2배 위치에 평균 이상의 에너지가 있으면 1P 후보로 인정
    // (스크린샷: 1P 47Hz가 평균의 1.75배로 약해도 2P 94.6Hz 받침으로 살림.
    //  SNR 3배를 그대로 요구하면 진짜 1P가 탈락하고 NaN이 되므로 완화한다.)
    if (!(p >= meanPower * snrThreshold)) {
      // 절대 하한: 노이즈 플로어 차단 (평균 x 0.5 미만은 무조건 탈락)
      if (!(p >= meanPower * 0.5)) continue;
      const f = (k * sampleRate) / fftSize;
      const fDouble = f * 2;
      if (fDouble >= freqMin && fDouble <= nyquist) {
        // 2배 위치 판정은 절대값이 아니라 로컬 피크 존재 여부로 판단한다.
        // (79.5Hz 공진이 평균을 부풀리면 진짜 2P 94.6Hz가 평균 이하로 보여 탈락하므로)
        const kd = Math.round((fDouble * fftSize) / sampleRate);
        let dblPeak = false;
        for (let j = kd - tolBins; j <= kd + tolBins; j++) {
          if (j > kMin && j < powers.length - 1 && powers[j] > powers[j - 1] && powers[j] >= powers[j + 1]) {
            if (powers[j] >= meanPower * 0.3) { dblPeak = true; break; }
          }
        }
        if (!dblPeak) continue;
      } else continue;
    }
    // 강한 피크 f의 f/2 위치에 평균 이상 에너지가 있으면 f는 2P로 간주하고 스킵.
    // 진짜 1P(f/2)는 자체 피크(또는 완화 게이트)로 평가됨.
    const f = (k * sampleRate) / fftSize;
    const fSub = f / 2;
    if (fSub >= freqMin) {
      // fSub 조회는 ±1빈으로 좁게: 강한 피크의 사이드로브가 이웃 후보를
      // 2P로 오인 스킵하는 것 방지 (47.3Hz가 79.5Hz 사이드로브에 묻히지 않게)
      const kcSub = Math.round((fSub * fftSize) / sampleRate);
      let subMax = 0;
      for (let j = kcSub - 1; j <= kcSub + 1; j++) {
        if (j >= 0 && j < powers.length && powers[j] > subMax) subMax = powers[j];
      }
      if (subMax >= meanPower * 1.5) {
        const f2 = f * 2;
        const hMax = f2 < nyquist ? powerAtHz(f2) : 0;
        // f/2가 로컬 피크(양옆보다 큼)일 때만 f를 2P로 스킵. 완만한 언덕은 스킵 금지.
        const kcS = kcSub;
        const isSubPeak = kcS > 0 && kcS < powers.length - 1 &&
          powers[kcS] >= powers[kcS - 1] && powers[kcS] > powers[kcS + 1];
        if (isSubPeak && (f2 > nyquist * 0.9 || hMax < p * 0.1)) continue;
      }
    }
    scorePeak(k, p);
  }
  return picks;
}

/** 단일 스펙트럼에서 RPM 선택 (하모닉 곱 스코어 최대 후보). */
export function pickRpmFromSpectrum(
  powers: Float32Array,
  sampleRate: number,
  fftSize: number,
  freqMin = STFT_FREQ_MIN_HZ,
  freqMax = STFT_FREQ_MAX_HZ,
  snrThreshold = STFT_SNR_THRESHOLD,
): { rpm: number; peakHz: number; peakPower: number; harmonicPower: number } {
  const empty = { rpm: NaN, peakHz: NaN, peakPower: 0, harmonicPower: 0 };
  const picks = scoreSpectrumPeaks(powers, sampleRate, fftSize, freqMin, freqMax, snrThreshold);
  let bestScore = -1;
  let bestAdd = -1;
  let best = empty;
  for (const pk of picks.values()) {
    if (bestScore < 0 || pk.multScore > bestScore * 1.01) {
      bestScore = pk.multScore;
      bestAdd = pk.addScore;
      best = { rpm: pk.rpm, peakHz: pk.peakHz, peakPower: pk.peakPower, harmonicPower: pk.harmonicPower };
    } else if (bestScore > 0 && Math.abs(pk.multScore - bestScore) <= bestScore * 0.01 && pk.addScore > bestAdd) {
      bestAdd = pk.addScore;
      best = { rpm: pk.rpm, peakHz: pk.peakHz, peakPower: pk.peakPower, harmonicPower: pk.harmonicPower };
    }
  }
  return best;
}

/**
 * Roll+Pitch 교차 하모닉 스코어 (외부 제안 검증 3).
 * combinedScore(f) = rollMult(f) + pitchMult(f). 한 축에만 강한 구조 공진은 탈락.
 * 양쪽 모두 후보가 없으면 NaN, 한쪽만 있으면 단축 폴백.
 */
export function pickRpmCombined(
  rollPowers: Float32Array,
  pitchPowers: Float32Array,
  sampleRate: number,
  fftSize: number,
  freqMin = STFT_FREQ_MIN_HZ,
  freqMax = STFT_FREQ_MAX_HZ,
  snrThreshold = STFT_SNR_THRESHOLD,
): { rpm: number; peakHz: number; peakPower: number; harmonicPower: number } {
  const empty = { rpm: NaN, peakHz: NaN, peakPower: 0, harmonicPower: 0 };
  const rPicks = scoreSpectrumPeaks(rollPowers, sampleRate, fftSize, freqMin, freqMax, snrThreshold);
  const pPicks = scoreSpectrumPeaks(pitchPowers, sampleRate, fftSize, freqMin, freqMax, snrThreshold);
  const findNear = (m: Map<number, SpectrumPick>, k: number): SpectrumPick | undefined => {
    if (m.has(k)) return m.get(k);
    if (m.has(k - 1)) return m.get(k - 1);
    if (m.has(k + 1)) return m.get(k + 1);
    return undefined;
  };
  const keys = new Set<number>([...rPicks.keys(), ...pPicks.keys()]);
  let bestScore = -1;
  let bestAdd = -1;
  let best = empty;
  for (const k of keys) {
    const r = findNear(rPicks, k);
    const p = findNear(pPicks, k);
    if (!r || !p) continue;
    const mult = r.multScore + p.multScore;
    const add = r.addScore + p.addScore;
    const rep = r.multScore >= p.multScore ? r : p;
    if (bestScore < 0 || mult > bestScore * 1.01) {
      bestScore = mult;
      bestAdd = add;
      best = { rpm: rep.rpm, peakHz: rep.peakHz, peakPower: rep.peakPower, harmonicPower: rep.harmonicPower };
    } else if (bestScore > 0 && Math.abs(mult - bestScore) <= bestScore * 0.01 && add > bestAdd) {
      bestAdd = add;
      best = { rpm: rep.rpm, peakHz: rep.peakHz, peakPower: rep.peakPower, harmonicPower: rep.harmonicPower };
    }
  }
  if (!Number.isFinite(best.rpm)) {
    const rBest = pickRpmFromSpectrum(rollPowers, sampleRate, fftSize, freqMin, freqMax, snrThreshold);
    const pBest = pickRpmFromSpectrum(pitchPowers, sampleRate, fftSize, freqMin, freqMax, snrThreshold);
    const rOk = Number.isFinite(rBest.rpm);
    const pOk = Number.isFinite(pBest.rpm);
    if (rOk && !pOk) return rBest;
    if (pOk && !rOk) return pBest;
    if (rOk && pOk) {
      const rScore = rBest.peakPower * Math.max(rBest.harmonicPower, 1e-12);
      const pScore = pBest.peakPower * Math.max(pBest.harmonicPower, 1e-12);
      return rScore >= pScore ? rBest : pBest;
    }
  }
  return best;
}
/**
 * 슬라이딩 윈도우 FFT로 RPM 시계열 추정 (동기 코어).
 * 외부 제안 검증 3 반영: 윈도우별 RMS가 큰 축 하나만 쓰지 않고
 * Roll/Pitch 양쪽 스펙트럼의 하모닉 곱 스코어를 합산(combinedScore)해 선택.
 * (한 축에만 강한 구조 공진은 합산에서 자연 탈락한다.)
 */
export function estimateRpmTimeSeries(
  gyroRoll: Float32Array,
  gyroPitch: Float32Array,
  sampleRate: number,
  opts?: { windowSec?: number; stepSec?: number; freqMinHz?: number; freqMaxHz?: number; snrThreshold?: number },
): RpmTimeSeries {
  const windowSec = opts?.windowSec ?? STFT_WINDOW_SEC;
  const stepSec = opts?.stepSec ?? STFT_STEP_SEC;
  const freqMin = opts?.freqMinHz ?? STFT_FREQ_MIN_HZ;
  const freqMax = opts?.freqMaxHz ?? STFT_FREQ_MAX_HZ;
  const snrThr = opts?.snrThreshold ?? STFT_SNR_THRESHOLD;
  const total = Math.min(gyroRoll.length, gyroPitch.length);
  const windowSize = Math.max(64, Math.floor(windowSec * sampleRate));
  const stepSize = Math.max(1, Math.floor(stepSec * sampleRate));
  const fftSize = nextPow2(windowSize);
  const timeMs: number[] = [];
  const rpm: number[] = [];
  if (total < windowSize || sampleRate <= 0) return { timeMs, rpm };
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const segR = new Float32Array(windowSize);
  const segP = new Float32Array(windowSize);
  for (let start = 0; start + windowSize <= total; start += stepSize) {
    // Roll/Pitch 각각 DC 제거 + 해닝 (RMS 승자독식 대신 양축 유지)
    let meanR = 0; let meanP = 0;
    for (let i = 0; i < windowSize; i++) { meanR += gyroRoll[start + i]; meanP += gyroPitch[start + i]; }
    meanR /= windowSize; meanP /= windowSize;
    const denom = windowSize - 1;
    for (let i = 0; i < windowSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
      segR[i] = (gyroRoll[start + i] - meanR) * w;
      segP[i] = (gyroPitch[start + i] - meanP) * w;
    }
    const halfN = fftSize / 2;
    let pickRpm = NaN;
    try {
      real.fill(0); imag.fill(0); real.set(segR);
      complexFft(real, imag);
      const rollPowers = new Float32Array(halfN);
      for (let k = 0; k < halfN; k++) rollPowers[k] = real[k] * real[k] + imag[k] * imag[k];
      real.fill(0); imag.fill(0); real.set(segP);
      complexFft(real, imag);
      const pitchPowers = new Float32Array(halfN);
      for (let k = 0; k < halfN; k++) pitchPowers[k] = real[k] * real[k] + imag[k] * imag[k];
      pickRpm = pickRpmCombined(rollPowers, pitchPowers, sampleRate, fftSize, freqMin, freqMax, snrThr).rpm;
    } catch {
      pickRpm = NaN;
    }
    const tMs = ((start + windowSize / 2) / sampleRate) * 1000;
    timeMs.push(tMs);
    rpm.push(pickRpm);
  }
  interpolateNaN(rpm);
  return { timeMs, rpm };
}

/** 메인 스레드 블로킹 방지: 일정 윈도우마다 이벤트 루프에 양보하는 비동기 추정 */
export function resampleRpmToFrameTime(series: RpmTimeSeries, frameTimeSec: Float32Array | number[]): Float32Array {
  const n = frameTimeSec.length;
  const out = new Float32Array(n);
  const m = series.timeMs.length;
  if (m === 0) return out;
  if (m === 1) { out.fill(series.rpm[0]); return out; }
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tMs = (frameTimeSec as ArrayLike<number>)[i] * 1000;
    while (j < m - 2 && series.timeMs[j + 1] < tMs) j++;
    const t0 = series.timeMs[j]; const t1 = series.timeMs[j + 1];
    const v0 = series.rpm[j]; const v1 = series.rpm[j + 1];
    if (!Number.isFinite(v0) || !Number.isFinite(v1) || t1 <= t0) {
      out[i] = Number.isFinite(v0) ? v0 : v1;
    } else if (tMs <= t0) out[i] = v0;
    else if (tMs >= t1) {
      if (j >= m - 2) out[i] = tMs >= series.timeMs[m - 1] ? series.rpm[m - 1] : v1;
      else out[i] = v0 + ((v1 - v0) * (tMs - t0)) / (t1 - t0);
    } else out[i] = v0 + ((v1 - v0) * (tMs - t0)) / (t1 - t0);
  }
  return out;
}
/** 메인 스레드 블로킹 방지: 일정 윈도우마다 이벤트 루프에 양보하는 비동기 추정 */
export async function estimateRpmTimeSeriesAsync(
  gyroRoll: Float32Array,
  gyroPitch: Float32Array,
  sampleRate: number,
  onProgress?: (done: number, total: number) => void,
): Promise<RpmTimeSeries> {
  const total = Math.min(gyroRoll.length, gyroPitch.length);
  const windowSize = Math.max(64, Math.floor(STFT_WINDOW_SEC * sampleRate));
  const stepSize = Math.max(1, Math.floor(STFT_STEP_SEC * sampleRate));
  const fftSize = nextPow2(windowSize);
  const timeMs: number[] = [];
  const rpm: number[] = [];
  if (total < windowSize || sampleRate <= 0) return { timeMs, rpm };
  const numWindows = Math.floor((total - windowSize) / stepSize) + 1;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const segR = new Float32Array(windowSize);
  const segP = new Float32Array(windowSize);
  let wi = 0;
  for (let start = 0; start + windowSize <= total; start += stepSize, wi++) {
    let meanR = 0; let meanP = 0;
    for (let i = 0; i < windowSize; i++) { meanR += gyroRoll[start + i]; meanP += gyroPitch[start + i]; }
    meanR /= windowSize; meanP /= windowSize;
    const denom = windowSize - 1;
    for (let i = 0; i < windowSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
      segR[i] = (gyroRoll[start + i] - meanR) * w;
      segP[i] = (gyroPitch[start + i] - meanP) * w;
    }
    const halfN = fftSize / 2;
    let pickRpm = NaN;
    try {
      real.fill(0); imag.fill(0); real.set(segR);
      complexFft(real, imag);
      const rollPowers = new Float32Array(halfN);
      for (let k = 0; k < halfN; k++) rollPowers[k] = real[k] * real[k] + imag[k] * imag[k];
      real.fill(0); imag.fill(0); real.set(segP);
      complexFft(real, imag);
      const pitchPowers = new Float32Array(halfN);
      for (let k = 0; k < halfN; k++) pitchPowers[k] = real[k] * real[k] + imag[k] * imag[k];
      pickRpm = pickRpmCombined(rollPowers, pitchPowers, sampleRate, fftSize).rpm;
    } catch { pickRpm = NaN; }
    const tMs = ((start + windowSize / 2) / sampleRate) * 1000;
    timeMs.push(tMs); rpm.push(pickRpm);
    if (wi % 200 === 199) {
      onProgress?.(wi + 1, numWindows);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  onProgress?.(numWindows, numWindows);
  interpolateNaN(rpm);
  return { timeMs, rpm };
}

function medianOfFinite(values: number[]): number {
  const f = values.filter(v => Number.isFinite(v));
  if (f.length === 0) return NaN;
  return median(f);
}
/** 로그 전체 파이프라인: STFT -> 스무딩 -> 프레임 리샘플 */
export async function estimateRpmForLogAsync(
  log: Pick<import('../types/blackbox').BlackboxLog, 'gyro' | 'time' | 'sampleRateHz' | 'totalFrames'>,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array> {
  const series = await estimateRpmTimeSeriesAsync(log.gyro.roll, log.gyro.pitch, log.sampleRateHz, onProgress);
  if (series.rpm.length === 0) return new Float32Array(0);
  const valid = series.rpm.filter(v => Number.isFinite(v) && v >= 1200 && v <= 6000);
  if (valid.length < Math.max(3, series.rpm.length * 0.2)) {
    if (valid.length > 0) return new Float32Array(log.totalFrames).fill(medianOfFinite(valid));
    return new Float32Array(0);
  }
  const smoothed = smoothRpm(series.rpm, 5, 3);
  const clamped = smoothed.map(v => (Number.isFinite(v) ? Math.min(6000, Math.max(1200, v)) : v));
  const frameTime = log.time.length === log.totalFrames ? log.time : log.time.slice(0, log.totalFrames);
  const resampled = resampleRpmToFrameTime({ timeMs: series.timeMs, rpm: clamped }, frameTime);
  if (resampled.length !== log.totalFrames) {
    const out = new Float32Array(log.totalFrames);
    const c = Math.min(out.length, resampled.length);
    out.set(resampled.subarray(0, c));
    if (c < out.length) out.fill(resampled.length > 0 ? resampled[resampled.length - 1] : 0, c);
    return out;
  }
  return resampled;
}

export interface SelectionRpm { rpm: number; mode: 'point' | 'range'; count: number; }

function averageRpmInIndexRange(rpm: Float32Array, s0: number, e0: number): { sum: number; count: number } {
  let sum = 0; let count = 0;
  const s = Math.max(0, s0); const e = Math.min(rpm.length - 1, e0);
  for (let i = s; i <= e; i++) {
    const v = rpm[i];
    if (Number.isFinite(v) && v > 800 && v < 6000) { sum += v; count++; }
  }
  return { sum, count };
}

function findIndexForTime(time: Float32Array | number[], target: number): number {
  let lo = 0; let hi = time.length - 1;
  if (target <= time[0]) return 0;
  if (target >= time[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((time as ArrayLike<number>)[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 타임라인 바 RPM 조회: 빨간바 안->지점+-0.5s, 밖->파란범위 전체 */
export function getRpmForSelection(
  log: Pick<import('../types/blackbox').BlackboxLog, 'rpm' | 'time' | 'sampleRateHz'>,
  selection: { start: number; end: number },
  pointSec: number,
): SelectionRpm {
  const rpmArr = log.rpm;
  if (!rpmArr || rpmArr.length === 0) return { rpm: NaN, mode: 'range', count: 0 };
  const sr = log.sampleRateHz || 1;
  const inside = pointSec >= selection.start && pointSec <= selection.end;
  let sIdx: number; let eIdx: number;
  if (inside) {
    if (log.time && log.time.length === rpmArr.length) {
      sIdx = findIndexForTime(log.time, Math.max(0, pointSec - 0.5));
      eIdx = findIndexForTime(log.time, pointSec + 0.5);
    } else { sIdx = Math.floor((pointSec - 0.5) * sr); eIdx = Math.ceil((pointSec + 0.5) * sr); }
    const r = averageRpmInIndexRange(rpmArr, sIdx, eIdx);
    return { rpm: r.count > 0 ? r.sum / r.count : NaN, mode: 'point', count: r.count };
  }
  if (log.time && log.time.length === rpmArr.length) {
    sIdx = findIndexForTime(log.time, selection.start);
    eIdx = findIndexForTime(log.time, selection.end);
  } else { sIdx = Math.floor(selection.start * sr); eIdx = Math.ceil(selection.end * sr); }
  const r2 = averageRpmInIndexRange(rpmArr, sIdx, eIdx);
  return { rpm: r2.count > 0 ? r2.sum / r2.count : NaN, mode: 'range', count: r2.count };
}


