/**
 * High-Performance FFT & Spectral Analysis Engine
 * Uses Cooley-Tukey Radix-2 algorithm with Hanning windowing and Welch's PSD averaging
 */

import { FftResult, SpectrogramData } from '../types/blackbox';

// Fast in-place radix-2 FFT
export function complexFft(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if ((n & (n - 1)) !== 0) {
    throw new Error('FFT length must be a power of 2');
  }

  // Bit reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;

      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly updates
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wR = 1.0;
      let wI = 0.0;

      for (let k = 0; k < halfLen; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];

        const vIdx = i + k + halfLen;
        const vR = real[vIdx] * wR - imag[vIdx] * wI;
        const vI = real[vIdx] * wI + imag[vIdx] * wR;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;

        real[vIdx] = uR - vR;
        imag[vIdx] = uI - vI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }
}

// Hanning window to prevent spectral leakage
export function applyHanningWindow(data: Float32Array): Float32Array {
  const n = data.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    out[i] = data[i] * w;
  }
  return out;
}

/**
 * Welch's Method for smooth Power Spectral Density (PSD)
 * Splits data into overlapping segments, windows them, and averages the magnitudes
 */
export function computeWelchPsd(
  data: Float32Array,
  sampleRate: number,
  windowSize: number = 1024,
  overlap: number = 0.5
): { frequencies: Float32Array; magnitudes: Float32Array } {
  if (data.length < windowSize) {
    // Pad to window size if shorter
    const padded = new Float32Array(windowSize);
    padded.set(data);
    data = padded;
  }

  const step = Math.floor(windowSize * (1 - overlap));
  const numSegments = Math.max(1, Math.floor((data.length - windowSize) / step) + 1);

  const halfSize = windowSize / 2;
  const accumulatedPower = new Float32Array(halfSize);

  const real = new Float32Array(windowSize);
  const imag = new Float32Array(windowSize);

  // Pre-calculate Hanning window factors
  const windowFactors = new Float32Array(windowSize);
  let windowPowerSum = 0;
  for (let i = 0; i < windowSize; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
    windowFactors[i] = w;
    windowPowerSum += w * w;
  }

  for (let seg = 0; seg < numSegments; seg++) {
    const offset = seg * step;
    
    // Remove DC offset (mean) for each segment
    let mean = 0;
    for (let i = 0; i < windowSize; i++) {
      mean += data[offset + i];
    }
    mean /= windowSize;

    // Apply window and remove DC
    for (let i = 0; i < windowSize; i++) {
      real[i] = (data[offset + i] - mean) * windowFactors[i];
      imag[i] = 0;
    }

    complexFft(real, imag);

    // Accumulate power (magnitude squared / window normalization)
    for (let i = 0; i < halfSize; i++) {
      const magSq = (real[i] * real[i] + imag[i] * imag[i]) / windowPowerSum;
      accumulatedPower[i] += magSq;
    }
  }

  const frequencies = new Float32Array(halfSize);
  const magnitudes = new Float32Array(halfSize);
  const freqStep = sampleRate / windowSize;

  for (let i = 0; i < halfSize; i++) {
    frequencies[i] = i * freqStep;
    // Amplitude spectral density (sqrt of averaged power, normalized)
    const avgPower = accumulatedPower[i] / numSegments;
    magnitudes[i] = Math.sqrt(avgPower) * 2 / windowSize;
  }

  return { frequencies, magnitudes };
}

/**
 * Compute multi-axis FFT for Gyro and Acc
 */
export function computeMultiAxisFft(
  gyro: { roll: Float32Array; pitch: Float32Array; yaw: Float32Array },
  acc: { x: Float32Array; y: Float32Array; z: Float32Array },
  sampleRate: number,
  startIdx: number = 0,
  endIdx?: number,
  windowSize: number = 1024
): FftResult {
  const len = endIdx ? Math.min(endIdx - startIdx, gyro.roll.length - startIdx) : gyro.roll.length - startIdx;
  
  const sliceRoll = gyro.roll.subarray(startIdx, startIdx + len);
  const slicePitch = gyro.pitch.subarray(startIdx, startIdx + len);
  const sliceYaw = gyro.yaw.subarray(startIdx, startIdx + len);
  const sliceAccX = acc.x.subarray(startIdx, startIdx + len);
  const sliceAccY = acc.y.subarray(startIdx, startIdx + len);
  const sliceAccZ = acc.z.subarray(startIdx, startIdx + len);

  const psdRoll = computeWelchPsd(sliceRoll, sampleRate, windowSize);
  const psdPitch = computeWelchPsd(slicePitch, sampleRate, windowSize);
  const psdYaw = computeWelchPsd(sliceYaw, sampleRate, windowSize);
  const psdAccX = computeWelchPsd(sliceAccX, sampleRate, windowSize);
  const psdAccY = computeWelchPsd(sliceAccY, sampleRate, windowSize);
  const psdAccZ = computeWelchPsd(sliceAccZ, sampleRate, windowSize);

  return {
    frequencies: psdRoll.frequencies,
    roll: psdRoll.magnitudes,
    pitch: psdPitch.magnitudes,
    yaw: psdYaw.magnitudes,
    accX: psdAccX.magnitudes,
    accY: psdAccY.magnitudes,
    accZ: psdAccZ.magnitudes,
    sampleRate,
  };
}

/**
 * Generate Spectrogram (Waterfall data) across time slices
 */
export function computeSpectrogram(
  signal: Float32Array,
  timeArray: Float32Array,
  sampleRate: number,
  axis: 'roll' | 'pitch' | 'yaw' | 'accX' | 'accY' | 'accZ',
  numTimeSlices: number = 120,
  windowSize: number = 512
): SpectrogramData {
  const totalSamples = signal.length;
  const sliceHop = Math.max(1, Math.floor((totalSamples - windowSize) / numTimeSlices));
  const halfWindow = windowSize / 2;

  const frequencies = new Float32Array(halfWindow);
  const freqStep = sampleRate / windowSize;
  for (let i = 0; i < halfWindow; i++) {
    frequencies[i] = i * freqStep;
  }

  const timeSlices: number[] = [];
  const powerGrid: Float32Array[] = [];

  const real = new Float32Array(windowSize);
  const imag = new Float32Array(windowSize);

  // Pre-calculate Hanning
  const windowFactors = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    windowFactors[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  let minPower = Infinity;
  let maxPower = -Infinity;

  for (let s = 0; s < numTimeSlices; s++) {
    const startIdx = s * sliceHop;
    if (startIdx + windowSize > totalSamples) break;

    const timeAtSlice = timeArray[startIdx + Math.floor(windowSize / 2)] || (startIdx / sampleRate);
    timeSlices.push(timeAtSlice);

    // Remove local mean
    let mean = 0;
    for (let i = 0; i < windowSize; i++) {
      mean += signal[startIdx + i];
    }
    mean /= windowSize;

    for (let i = 0; i < windowSize; i++) {
      real[i] = (signal[startIdx + i] - mean) * windowFactors[i];
      imag[i] = 0;
    }

    complexFft(real, imag);

    const slicePowers = new Float32Array(halfWindow);
    for (let i = 0; i < halfWindow; i++) {
      // Magnitude in dB for high visual dynamic range
      const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) * 2 / windowSize;
      const db = 20 * Math.log10(Math.max(1e-4, mag));
      slicePowers[i] = db;

      if (db > maxPower) maxPower = db;
      if (db < minPower) minPower = db;
    }
    powerGrid.push(slicePowers);
  }

  return {
    timeSlices,
    frequencies,
    powerGrid,
    maxPower: isFinite(maxPower) ? maxPower : 20,
    minPower: isFinite(minPower) ? minPower : -60,
    axis,
  };
}

/**
 * Detect significant vibration peaks and match them to helicopter mechanical components
 */
export function findVibrationPeaks(
  fft: FftResult,
  estimatedHeadRpm?: number,
  tailRatio: number = 4.5
): {
  axis: 'Roll' | 'Pitch' | 'Yaw' | 'AccX' | 'AccY' | 'AccZ';
  freqHz: number;
  amplitude: number;
  probableSource: string;
}[] {
  const peaks: {
    axis: 'Roll' | 'Pitch' | 'Yaw' | 'AccX' | 'AccY' | 'AccZ';
    freqHz: number;
    amplitude: number;
    probableSource: string;
  }[] = [];

  const axes: Array<{ name: 'Roll' | 'Pitch' | 'Yaw' | 'AccX' | 'AccY' | 'AccZ'; data: Float32Array }> = [
    { name: 'Roll', data: fft.roll },
    { name: 'Pitch', data: fft.pitch },
    { name: 'Yaw', data: fft.yaw },
    { name: 'AccX', data: fft.accX },
    { name: 'AccY', data: fft.accY },
    { name: 'AccZ', data: fft.accZ },
  ];

  const main1P = estimatedHeadRpm ? estimatedHeadRpm / 60 : 0;
  const main2P = main1P * 2;
  const tail1P = main1P * tailRatio;
  const motor1P = main1P * 10.0; // Estimated 10:1 gear ratio

  axes.forEach(({ name, data }) => {
    // Scan frequencies between 12 Hz and 800 Hz to find local maxima
    // Find channel max first to determine adaptive threshold
    let channelMax = 0;
    for (let i = 1; i < data.length - 1; i++) {
      const f = fft.frequencies[i];
      if (f >= 12 && f <= 800) {
        if (data[i] > channelMax) channelMax = data[i];
      }
    }

    // Adaptive threshold: based on the Welch average spectrum (bin magnitude).
    // computeWelchPsd magnitudes are roughly 1/40 of a real sine amplitude (1024-Hanning),
    // so the absolute floor is lowered to match the magnitude scale. (the old 0.08/0.02 produced peaks=0)
    const minFloor = name.startsWith('Acc') ? 0.001 : 0.004;
    const threshold = Math.max(minFloor, channelMax * 0.25);

    // Detect peaks exceeding threshold
    const candidates: Array<{ idx: number; freq: number; amp: number }> = [];

    for (let i = 1; i < data.length - 1; i++) {
      const f = fft.frequencies[i];
      if (f < 12 || f > 800) continue;

      const v = data[i];
      // Local peak check
      if (v > data[i - 1] && v > data[i + 1] && v >= threshold) {
        candidates.push({ idx: i, freq: f, amp: v });
      }
    }

    // Sort candidate peaks by amplitude descending
    candidates.sort((a, b) => b.amp - a.amp);

    // Pick top distinct peaks (distance >= 15Hz apart)
    const selected: Array<{ idx: number; freq: number; amp: number }> = [];
    for (const c of candidates) {
      const tooClose = selected.some(s => Math.abs(s.freq - c.freq) < 15);
      if (!tooClose) {
        selected.push(c);
        if (selected.length >= 2) break; // Top 2 peaks per axis
      }
    }

    selected.forEach(pk => {
      const peakFreq = pk.freq;
      // Convert Welch magnitude (~amplitude/40, 1024-Hanning) into an approximate sine peak amplitude (°/s, G).
      // A ≈ magnitude × 2·sqrt(sum(w²)) ≈ magnitude × 39.2  (windowSize=1024, Hanning)
      // This keeps the value in the same unit as the analyzeVibrations diagnostic thresholds (8, 6 °/s).
      const maxAmp = pk.amp * 39.2;
      let source = 'Uncorrelated high-frequency vibration';

      if (main1P > 0) {
        if (Math.abs(peakFreq - main1P) <= 5.0) {
          source = `Main rotor 1P (${Math.round(main1P * 60)} RPM) - check blade balance / spindle shaft`;
        } else if (Math.abs(peakFreq - main2P) <= 8.0) {
          source = `Main rotor 2P (blade passage / tracking error) - check pitch links and blade angle`;
        } else if (Math.abs(peakFreq - tail1P) <= 15.0) {
          source = `Tail rotor 1P (~${Math.round(tail1P)} Hz) - check tail blade weight / bent tail shaft`;
        } else if (motor1P > 0 && Math.abs(peakFreq - motor1P) <= 25.0) {
          source = `Motor 1P rotational vibration (~${Math.round(motor1P)} Hz) - check motor bearings / motor mount`;
        } else if (peakFreq > 250 && peakFreq < 600) {
          source = `High-frequency gear mesh / motor vibration (~${Math.round(peakFreq)} Hz) - gear backlash / pinion wear`;
        }
      } else {
        if (peakFreq >= 20 && peakFreq <= 45) {
          source = `Main rotor band (~${Math.round(peakFreq * 60)} RPM estimate)`;
        } else if (peakFreq >= 90 && peakFreq <= 220) {
          source = `Tail rotor high-frequency band (~${Math.round(peakFreq)} Hz)`;
        }
      }

      peaks.push({
        axis: name,
        freqHz: Math.round(peakFreq * 10) / 10,
        amplitude: Math.round(maxAmp * 100) / 100,
        probableSource: source,
      });
    });
  });

  return peaks;
}
