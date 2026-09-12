/**
 * Rotorflight Blackbox Log Data Types
 */

export interface BlackboxLog {
  id: number;
  filename: string;
  firmwareType: string;
  firmwareVersion?: string;
  craftName?: string;
  looptimeUs: number;
  sampleRateHz: number;
  durationSec: number;
  totalFrames: number;
  headers: Record<string, string>;
  fieldNames: string[];
  // Continuous numerical streams (typed arrays for speed & memory efficiency)
  time: Float32Array; // seconds
  gyro: {
    roll: Float32Array;  // deg/s
    pitch: Float32Array; // deg/s
    yaw: Float32Array;   // deg/s
  };
  acc: {
    x: Float32Array; // G
    y: Float32Array; // G
    z: Float32Array; // G
  };
  rpm?: Float32Array; // Main Rotor RPM
  tailRpm?: Float32Array; // Tail RPM
  throttle?: Float32Array; // 0 - 100 %
  collective?: Float32Array; // % (-100 to +100 or 0 to 100)
  vbat?: Float32Array; // Volts
  current?: Float32Array; // Amps
  events: FlightEvent[];
  rotorflightValidation: RotorflightValidation;
}

export interface RotorflightValidation {
  isRotorflight: boolean;
  hasRotorflightHeader: boolean;
  motorCount: number;
  hasServos: boolean;
  servoCount: number;
  hasCollective: boolean;
  reasons: string[];
  details: {
    motorFields: string[];
    servoFields: string[];
    collectiveField: string | null;
    firmwareHeader?: string;
    detectedHeaderTag?: string;
  };
}

export interface FlightEvent {
  timeSec: number;
  name: string;
  data?: string;
}

export type VibrationGrade = 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'WARNING' | 'CRITICAL';

export interface VibrationSummary {
  gyroRms: {
    roll: number;
    pitch: number;
    yaw: number;
    overall: number;
  };
  accRms: {
    x: number;
    y: number;
    z: number;
    overall: number;
  };
  gyroPeak: {
    roll: number;
    pitch: number;
    yaw: number;
  };
  overallGrade: VibrationGrade;
  detectedHeadSpeedRpm: number;
  harmonics: {
    main1P: number;  // 1x Main Rotor RPM (Hz)
    main2P: number;  // 2x Main Rotor RPM (Hz) - Blade passage
    tail1P: number;  // Tail Rotor frequency (Hz)
    motor1P: number; // Motor shaft rotation (Hz)
  };
  peaks: {
    axis: 'Roll' | 'Pitch' | 'Yaw' | 'AccX' | 'AccY' | 'AccZ';
    freqHz: number;
    amplitude: number;
    probableSource: string;
  }[];
  diagnostics: {
    type: 'success' | 'info' | 'warning' | 'error';
    title: string;
    description: string;
    action?: string;
  }[];
}

export interface FftResult {
  frequencies: Float32Array;
  roll: Float32Array;
  pitch: Float32Array;
  yaw: Float32Array;
  accX: Float32Array;
  accY: Float32Array;
  accZ: Float32Array;
  sampleRate: number;
}

export interface SpectrogramData {
  timeSlices: number[];
  frequencies: Float32Array;
  powerGrid: Float32Array[]; // array of frequency powers for each time slice
  maxPower: number;
  minPower: number;
  axis: 'roll' | 'pitch' | 'yaw' | 'accX' | 'accY' | 'accZ';
}

export interface HeliConfig {
  mainRpm: number;
  tailGearRatio: number; // typically 4.2 to 4.8
  motorPinionTeeth: number;
  mainGearTeeth: number;
  motorKv: number;
  batteryCells: number;
  bladeCount: number; // 2 or 3
}
