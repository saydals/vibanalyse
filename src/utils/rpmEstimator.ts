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
 * 슬라이딩 윈도우 FFT로 RPM 시계열 추정 (동기 코어).
 * Roll/Pitch 중 윈도우별 RMS가 큰 축 선택 (Yaw는 테일로터 지배적이므로 제외).
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
  const kMin = Math.max(1, Math.floor((freqMin * fftSize) / sampleRate));
  const kMax = Math.min(fftSize / 2 - 1, Math.ceil((freqMax * fftSize) / sampleRate));
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const seg = new Float32Array(windowSize);
  for (let start = 0; start + windowSize <= total; start += stepSize) {
    let sumR = 0; let sumP = 0;
    for (let i = 0; i < windowSize; i++) {
      const v1 = gyroRoll[start + i]; const v2 = gyroPitch[start + i];
      sumR += v1 * v1; sumP += v2 * v2;
    }
    const src = sumR >= sumP ? gyroRoll : gyroPitch;
    let mean = 0;
    for (let i = 0; i < windowSize; i++) mean += src[start + i];
    mean /= windowSize;
    const denom = windowSize - 1;
    for (let i = 0; i < windowSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
      seg[i] = (src[start + i] - mean) * w;
    }
    real.fill(0); imag.fill(0); real.set(seg);
    try { complexFft(real, imag); } catch {
      timeMs.push(((start + windowSize / 2) / sampleRate) * 1000);
      rpm.push(NaN); continue;
    }
    const count = kMax - kMin + 1;
    const powers = new Float32Array(count);
    let sumPower = 0; let peakK = -1; let peakPower = 0;
    for (let k = kMin; k <= kMax; k++) {
      const p = real[k] * real[k] + imag[k] * imag[k];
      powers[k - kMin] = p; sumPower += p;
      if (p > peakPower) { peakPower = p; peakK = k; }
    }
    const meanPower = sumPower / Math.max(1, count);
    const tMs = ((start + windowSize / 2) / sampleRate) * 1000;
    if (peakK < 0 || !(peakPower >= meanPower * snrThr) || !(meanPower > 0)) {
      timeMs.push(tMs); rpm.push(NaN); continue;
    }
    let refinedK = peakK;
    const li = peakK - kMin;
    if (li > 0 && li < count - 1) {
      const a = powers[li - 1]; const b = powers[li]; const c = powers[li + 1];
      const d = a - 2 * b + c;
      if (Math.abs(d) > 1e-12) {
        const delta = (0.5 * (a - c)) / d;
        if (Math.abs(delta) <= 1) refinedK = peakK + delta;
      }
    }
    timeMs.push(tMs);
    rpm.push(((refinedK * sampleRate) / fftSize) * 60);
  }
  interpolateNaN(rpm);
  return { timeMs, rpm };
}

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
  const kMin = Math.max(1, Math.floor((STFT_FREQ_MIN_HZ * fftSize) / sampleRate));
  const kMax = Math.min(fftSize / 2 - 1, Math.ceil((STFT_FREQ_MAX_HZ * fftSize) / sampleRate));
  const timeMs: number[] = [];
  const rpm: number[] = [];
  if (total < windowSize || sampleRate <= 0) return { timeMs, rpm };
  const numWindows = Math.floor((total - windowSize) / stepSize) + 1;
  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);
  const seg = new Float32Array(windowSize);
  let wi = 0;
  for (let start = 0; start + windowSize <= total; start += stepSize, wi++) {
    let sumR = 0; let sumP = 0;
    for (let i = 0; i < windowSize; i++) {
      const v1 = gyroRoll[start + i]; const v2 = gyroPitch[start + i];
      sumR += v1 * v1; sumP += v2 * v2;
    }
    const src = sumR >= sumP ? gyroRoll : gyroPitch;
    let mean = 0;
    for (let i = 0; i < windowSize; i++) mean += src[start + i];
    mean /= windowSize;
    const denom = windowSize - 1;
    for (let i = 0; i < windowSize; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
      seg[i] = (src[start + i] - mean) * w;
    }
    real.fill(0); imag.fill(0); real.set(seg);
    try { complexFft(real, imag); } catch {
      timeMs.push(((start + windowSize / 2) / sampleRate) * 1000);
      rpm.push(NaN); continue;
    }
    const count = kMax - kMin + 1;
    const powers = new Float32Array(count);
    let sumPower = 0; let peakK = -1; let peakPower = 0;
    for (let k = kMin; k <= kMax; k++) {
      const p = real[k] * real[k] + imag[k] * imag[k];
      powers[k - kMin] = p; sumPower += p;
      if (p > peakPower) { peakPower = p; peakK = k; }
    }
    const meanPower = sumPower / Math.max(1, count);
    const tMs = ((start + windowSize / 2) / sampleRate) * 1000;
    if (peakK < 0 || !(peakPower >= meanPower * STFT_SNR_THRESHOLD) || !(meanPower > 0)) {
      timeMs.push(tMs); rpm.push(NaN);
    } else {
      let refinedK = peakK;
      const li = peakK - kMin;
      if (li > 0 && li < count - 1) {
        const a = powers[li - 1]; const b = powers[li]; const c2 = powers[li + 1];
        const d = a - 2 * b + c2;
        if (Math.abs(d) > 1e-12) {
          const delta = (0.5 * (a - c2)) / d;
          if (Math.abs(delta) <= 1) refinedK = peakK + delta;
        }
      }
      timeMs.push(tMs);
      rpm.push(((refinedK * sampleRate) / fftSize) * 60);
    }
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


