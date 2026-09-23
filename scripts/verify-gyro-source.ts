/**
 * Raw / Filtered 자이로 소스 검증 스크립트
 * - gyroADC (필터 통과) vs gyroRAW (미필터) 필드 파싱 결과 비교
 * - 두 소스의 FFT 스펙트럼이 실제로 다른지(고주파 성분) 확인
 * Usage: node_modules/.bin/tsx scripts/verify-gyro-source.ts [file.bbl]
 */
import * as fs from 'node:fs';
import { parseBlackboxFile } from '../src/utils/blackboxParser';
import { computeMultiAxisFft } from '../src/utils/fft';

const file = process.argv[2] || 'public/samples/sample.bbl';
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const result = await parseBlackboxFile(ab, file.split('/').pop() || 'sample.bbl');

const stat = (a?: Float32Array) => {
  if (!a) return '(undefined)';
  let mn = Infinity, mx = -Infinity, nz = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < mn) mn = a[i];
    if (a[i] > mx) mx = a[i];
    if (a[i] !== 0) nz++;
    sum += Math.abs(a[i]);
  }
  return `min=${mn.toFixed(1)} max=${mx.toFixed(1)} |avg|=${(sum / Math.max(1, a.length)).toFixed(3)} nonzero=${nz}/${a.length}`;
};
const meanAbsDiff = (a?: Float32Array, b?: Float32Array) => {
  if (!a || !b) return 'n/a';
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return (s / Math.max(1, a.length)).toFixed(4);
};
/** 60Hz 이상 대역 에너지 (필터 효과 확인용) */
const highBandEnergy = (spec: Float32Array, freqs: Float32Array) => {
  let s = 0;
  for (let i = 0; i < spec.length; i++) if (freqs[i] >= 60) s += spec[i] * spec[i];
  return Math.sqrt(s).toFixed(4);
};

for (const log of result.logs) {
  console.log(`--- log#${log.id} ${log.filename} frames=${log.totalFrames} sr=${log.sampleRateHz}Hz`);
  console.log(`hasGyroFiltered=${log.hasGyroFiltered} hasGyroRaw=${log.hasGyroRaw} gyroRaw=${log.gyroRaw ? 'present' : 'undefined'}`);
  console.log(`gyro  .roll  (gyroADC): ${stat(log.gyro.roll)}`);
  console.log(`gyroRaw.roll (gyroRAW): ${stat(log.gyroRaw?.roll)}`);
  console.log(`|gyroADC - gyroRAW| (roll): ${meanAbsDiff(log.gyro.roll, log.gyroRaw?.roll)}`);
  console.log(`gyro  .pitch (gyroADC): ${stat(log.gyro.pitch)}`);
  console.log(`gyroRaw.pitch (gyroRAW): ${stat(log.gyroRaw?.pitch)}`);
  console.log(`|gyroADC - gyroRAW| (pitch): ${meanAbsDiff(log.gyro.pitch, log.gyroRaw?.pitch)}`);

  const winStart = 0;
  const winEnd = Math.min(log.totalFrames, 30 * log.sampleRateHz);
  const fftFiltered = computeMultiAxisFft(log.gyro, log.acc, log.sampleRateHz, winStart, winEnd, 1024);
  const fftRaw = log.gyroRaw
    ? computeMultiAxisFft(log.gyroRaw, log.acc, log.sampleRateHz, winStart, winEnd, 1024)
    : null;
  console.log(`FFT(Filtered) roll >60Hz RMS = ${highBandEnergy(fftFiltered.roll, fftFiltered.frequencies)}`);
  console.log(`FFT(Raw)      roll >60Hz RMS = ${fftRaw ? highBandEnergy(fftRaw.roll, fftRaw.frequencies) : 'n/a'}`);
  console.log(`FFT(Filtered) pitch >60Hz RMS = ${highBandEnergy(fftFiltered.pitch, fftFiltered.frequencies)}`);
  console.log(`FFT(Raw)      pitch >60Hz RMS = ${fftRaw ? highBandEnergy(fftRaw.pitch, fftRaw.frequencies) : 'n/a'}`);
}
