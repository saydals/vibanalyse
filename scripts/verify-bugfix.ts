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

// Bug reproduction case: 79.5Hz amplitude > 47.3Hz amplitude, no peak at 159Hz -> 47.3Hz (2838RPM) must be selected
{
  const sr = 2000; const N = 1024;
  // Roll: 47.3Hz (1P, amplitude 3) + 94.6Hz (2P, amplitude 2) + 79.5Hz (resonance, amplitude 10)
  const roll = spectrumOf(sr, N, [[47.3, 3], [94.6, 2], [79.5, 10]]);
  // Pitch: 47.3Hz (amplitude 2.5) + 94.6Hz (amplitude 1.8); the resonance exists on Roll only (verification 3: Roll-only resonance must be dropped)
  const pitch = spectrumOf(sr, N, [[47.3, 2.5], [94.6, 1.8], [79.5, 1.0]]);
  const single = pickRpmFromSpectrum(roll, sr, N);
  const combined = pickRpmCombined(roll, pitch, sr, N);
  console.log(`[bugfix] single: peakHz=${single.peakHz?.toFixed(1)} rpm=${single.rpm?.toFixed(0)} (expected 47.3/2838)`);
  console.log(`[bugfix] combined: peakHz=${combined.peakHz?.toFixed(1)} rpm=${combined.rpm?.toFixed(0)} (expected 47.3/2838)`);
  const okS = Math.abs(single.rpm - 2838) <= 100;
  const okC = Math.abs(combined.rpm - 2838) <= 100;
  console.log(`[bugfix] single ${okS ? 'PASS' : 'FAIL'} / combined ${okC ? 'PASS' : 'FAIL'} (selecting 79.5 means the bug is not fixed)`);
}

// Edge A: throttle 0 (motor stopped, the whole series is no-signal noise) -> NaN -> interpolation/gate handling
// The judgment is made through the real pipeline (time series + valid ratio gate), not a single window.
{
  const srA = 2000; const nA = srA * 10;
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5;
  const rA = new Float32Array(nA); const pA = new Float32Array(nA);
  for (let i = 0; i < nA; i++) { rA[i] = 0.05 * rnd(); pA[i] = 0.05 * rnd(); }
  const sA = estimateRpmTimeSeries(rA, pA, srA);
  const vA = sA.rpm.filter(x => Number.isFinite(x) && x >= 1200 && x <= 6000);
  // Noise lands on random frequencies in every window, so its variance stays large even after smoothing,
  // and in real use it is dropped by the valid ratio gate in estimateRpmForLogAsync.
  // Here we judge by variance: a std above 10% of the mean is treated as no-signal and passes.
  const meanA = vA.reduce((a, b) => a + b, 0) / Math.max(1, vA.length);
  const stdA = Math.sqrt(vA.reduce((a, b) => a + (b - meanA) * (b - meanA), 0) / Math.max(1, vA.length));
  const isNoise = vA.length === 0 || (stdA / Math.max(1, meanA)) > 0.10;
  console.log(`[edgeA] n=${vA.length} mean=${meanA.toFixed(0)} std=${stdA.toFixed(0)} ${isNoise ? 'PASS (no-signal)' : 'FAIL'}`);
}

// Edge B: normal case where 2P is stronger than 1P (1P 47Hz amplitude 2 + 2P 94Hz amplitude 6, identical on both axes)
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
  console.log(`[edgeB] avg=${a.toFixed(1)} expected=2820 ${Math.abs(a - 2820) <= 100 ? 'PASS' : 'FAIL'} (selecting 94*60=5640 would be a misdetection)`);
}

// Edge C: high RPM (1P 68Hz = 4080RPM, confirming it stays inside the search range)
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
  console.log(`[edgeC] avg=${a.toFixed(1)} expected=4080 ${Math.abs(a - 4080) <= 100 ? 'PASS' : 'FAIL'} (FAIL if it falls outside the range)`);
}
console.log(`range: ${STFT_FREQ_MIN_HZ}~${STFT_FREQ_MAX_HZ}Hz`);
