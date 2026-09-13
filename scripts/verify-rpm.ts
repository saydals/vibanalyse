import { estimateRpmTimeSeries, smoothRpm, resampleRpmToFrameTime, estimateRpmForLogAsync, getRpmForSelection } from '../src/utils/rpmEstimator';

// Case 1: synthetic 49.3Hz sine on roll @ 2000Hz, 10 sec
const sr = 2000;
const dur = 10;
const n = sr * dur;
const f = 49.3;
const roll = new Float32Array(n);
const pitch = new Float32Array(n);
for (let i = 0; i < n; i++) {
  const t = i / sr;
  roll[i] = 10 * Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * 30 * t);
  pitch[i] = 8 * Math.sin(2 * Math.PI * f * t + 0.7);
}
const t0 = performance.now();
const series = estimateRpmTimeSeries(roll, pitch, sr);
const t1 = performance.now();
const valid = series.rpm.filter(v => Number.isFinite(v));
const avg = valid.reduce((a, b) => a + b, 0) / Math.max(1, valid.length);
console.log(`[synthetic] windows=${series.rpm.length} avg=${avg.toFixed(1)} expected=${(f * 60).toFixed(1)} dt=${(t1 - t0).toFixed(0)}ms`);
console.log(`[synthetic] first5=${series.rpm.slice(0, 5).map(v => v.toFixed(1)).join(',')}`);
const err = Math.abs(avg - f * 60);
console.log(`[synthetic] ${err <= 50 ? 'PASS' : 'FAIL'} err=${err.toFixed(1)} (tol 50)`);

// Case 2: smooth + resample
const sm = smoothRpm(series.rpm, 5, 3);
console.log(`[smooth] len=${sm.length} avg=${(sm.reduce((a, b) => a + b, 0) / sm.length).toFixed(1)}`);
const time = new Float32Array(n);
for (let i = 0; i < n; i++) time[i] = i / sr;
const rs = resampleRpmToFrameTime({ timeMs: series.timeMs, rpm: sm }, time);
console.log(`[resample] len=${rs.length} expected=${n} ${rs.length === n ? 'PASS' : 'FAIL'}`);

// Case 3: selection logic
const log: any = { rpm: rs, time, sampleRateHz: sr };
const inside = getRpmForSelection(log, { start: 2, end: 8 }, 5);
const outside = getRpmForSelection(log, { start: 2, end: 8 }, 9.5);
console.log(`[selection] inside mode=${inside.mode} rpm=${inside.rpm.toFixed(1)} ${inside.mode === 'point' ? 'PASS' : 'FAIL'}`);
console.log(`[selection] outside mode=${outside.mode} rpm=${outside.rpm.toFixed(1)} ${outside.mode === 'range' ? 'PASS' : 'FAIL'}`);

// Case 4: performance — 60s @ 4000Hz
const sr2 = 4000;
const n2 = sr2 * 60;
const r2 = new Float32Array(n2);
const p2 = new Float32Array(n2);
for (let i = 0; i < n2; i++) {
  const t = i / sr2;
  r2[i] = 10 * Math.sin(2 * Math.PI * 45 * t);
  p2[i] = 8 * Math.sin(2 * Math.PI * 45 * t + 0.5);
}
const pa = performance.now();
const s2 = estimateRpmTimeSeries(r2, p2, sr2);
const pb = performance.now();
console.log(`[perf] 60s@4kHz sync dt=${(pb - pa).toFixed(0)}ms windows=${s2.rpm.length} ${(pb - pa) < 2000 ? 'PASS' : 'FAIL'} (target <2000ms)`);

// Case 5: async pipeline end-to-end
const fakeLog: any = { gyro: { roll, pitch }, time, sampleRateHz: sr, totalFrames: n };
const est = await estimateRpmForLogAsync(fakeLog);
console.log(`[pipeline] len=${est.length} ${est.length === n ? 'PASS' : 'FAIL'} avg=${(est.reduce((a: number, b: number) => a + b, 0) / est.length).toFixed(1)}`);
