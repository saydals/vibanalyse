import { parseBlackboxFile } from '../src/utils/blackboxParser';
import { estimateRpmTimeSeries, smoothRpm, resampleRpmToFrameTime } from '../src/utils/rpmEstimator';
import * as fs from 'node:fs';

const file = process.argv[2] || 'public/samples/sample.bbl';
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const result = await parseBlackboxFile(ab, file.split('/').pop() || 'sample.bbl');
console.log(`logs=${result.logs.length} primary=${result.primaryLogIndex}`);
for (const log of result.logs) {
  console.log(`--- log#${log.id} ${log.filename} dur=${log.durationSec.toFixed(1)}s sr=${log.sampleRateHz} frames=${log.totalFrames} rpmSource=${log.rpmSource} hasRpm=${!!log.rpm}`);
  if (log.rpm && log.rpm.length > 0) {
    let sum = 0; let cnt = 0; let mn = Infinity; let mx = -Infinity;
    for (let i = 0; i < log.rpm.length; i++) {
      const v = log.rpm[i];
      if (v > 800 && v < 6000) { sum += v; cnt++; mn = Math.min(mn, v); mx = Math.max(mx, v); }
    }
    console.log(`    sensor rpm: n=${cnt} avg=${cnt ? (sum / cnt).toFixed(1) : 'n/a'} min=${mn.toFixed(0)} max=${mx.toFixed(0)}`);
  }
  // Run the STFT estimate (for comparison regardless of whether an RPM sensor exists)
  if (log.totalFrames >= 500 && log.sampleRateHz > 0) {
    const t0 = performance.now();
    const series = estimateRpmTimeSeries(log.gyro.roll, log.gyro.pitch, log.sampleRateHz);
    const sm = smoothRpm(series.rpm, 5, 3);
    const rs = resampleRpmToFrameTime({ timeMs: series.timeMs, rpm: sm }, log.time);
    const t1 = performance.now();
    let s = 0; let c = 0;
    for (let i = 0; i < rs.length; i++) { const v = rs[i]; if (Number.isFinite(v) && v >= 1200 && v <= 6000) { s += v; c++; } }
    console.log(`    stft: windows=${series.rpm.length} dt=${(t1 - t0).toFixed(0)}ms avg=${c ? (s / c).toFixed(1) : 'n/a'} validFrac=${(c / Math.max(1, rs.length)).toFixed(2)} first5=${series.rpm.slice(0, 5).map(v => Number.isFinite(v) ? v.toFixed(0) : 'NaN').join(',')}`);
  }
}
