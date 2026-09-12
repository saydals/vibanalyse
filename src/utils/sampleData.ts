/**
 * Realistic Pre-recorded Rotorflight Helicopter Flight Logs for instant testing & demo
 */

import { BlackboxLog, RotorflightValidation } from '../types/blackbox';

export type SampleType = 'clean' | 'tail_vibe' | 'main_vibe' | 'betaflight_quad';

export function generateSampleFlightLog(sampleType: SampleType): BlackboxLog {
  const durationSec = 15; // 15 seconds flight
  const sampleRateHz = 2000; // 2kHz looptime
  const totalFrames = durationSec * sampleRateHz;

  const time = new Float32Array(totalFrames);
  const roll = new Float32Array(totalFrames);
  const pitch = new Float32Array(totalFrames);
  const yaw = new Float32Array(totalFrames);

  const accX = new Float32Array(totalFrames);
  const accY = new Float32Array(totalFrames);
  const accZ = new Float32Array(totalFrames);

  const rpm = new Float32Array(totalFrames);
  const throttle = new Float32Array(totalFrames);
  const collective = sampleType === 'betaflight_quad' ? undefined : new Float32Array(totalFrames);
  const vbat = new Float32Array(totalFrames);

  // If this is a Betaflight Quadcopter test sample (to test rejection of non-Rotorflight files)
  if (sampleType === 'betaflight_quad') {
    for (let i = 0; i < totalFrames; i++) {
      const t = i / sampleRateHz;
      time[i] = t;
      roll[i] = (Math.random() - 0.5) * 8.0;
      pitch[i] = (Math.random() - 0.5) * 7.5;
      yaw[i] = (Math.random() - 0.5) * 6.0;
      accX[i] = (Math.random() - 0.5) * 0.1;
      accY[i] = (Math.random() - 0.5) * 0.1;
      accZ[i] = 1.0 + (Math.random() - 0.5) * 0.1;
      throttle[i] = 45;
      vbat[i] = 16.8 - (t / durationSec) * 2.0; // 4S LiPo
    }

    const fieldNames = [
      'loopIteration',
      'time',
      'gyroADC[0]',
      'gyroADC[1]',
      'gyroADC[2]',
      'accSmooth[0]',
      'accSmooth[1]',
      'accSmooth[2]',
      'rcCommand[0]',
      'rcCommand[1]',
      'rcCommand[2]',
      'rcCommand[3]',
      'vbatLatest',
      'amperageLatest',
      'motor[0]',
      'motor[1]',
      'motor[2]',
      'motor[3]', // 4 motors!
    ];

    const rotorflightValidation: RotorflightValidation = {
      isRotorflight: false,
      hasRotorflightHeader: false,
      motorCount: 4,
      hasServos: false,
      servoCount: 0,
      hasCollective: false,
      reasons: [
        'BBL 헤더에 "rotorflight" (대소문자 무관) 식별자가 존재하지 않습니다. (감지된 헤더: Betaflight 4.5.0-RELEASE)',
        '모터가 4개 감지되었습니다. (멀티로터 쿼드콥터 드론)',
        '서보(Servo) 항목이 존재하지 않습니다. (스와시플레이트 없음)',
        'COLLECTIVE(콜렉티브 피치) 제어 항목이 존재하지 않습니다.',
      ],
      details: {
        motorFields: ['motor[0]', 'motor[1]', 'motor[2]', 'motor[3]'],
        servoFields: [],
        collectiveField: null,
        firmwareHeader: 'Betaflight 4.5.0-RELEASE',
      },
    };

    return {
      id: 1,
      filename: 'Betaflight_4.5_Quadcopter_FPV.bbl',
      firmwareType: 'Betaflight (Multirotor Drone)',
      firmwareVersion: 'Betaflight 4.5.0',
      craftName: '5-inch Freestyle FPV Quad',
      looptimeUs: 125,
      sampleRateHz: 8000,
      durationSec,
      totalFrames,
      headers: {
        Product: 'Blackbox flight data recorder by Nicholas Sherlock',
        'Data version': '2',
        firmwareType: 'Betaflight',
        'Firmware revision': 'Betaflight 4.5.0',
        craftName: '5-inch Freestyle FPV Quad',
        'Field I name': fieldNames.join(','),
      },
      fieldNames,
      time,
      gyro: { roll, pitch, yaw },
      acc: { x: accX, y: accY, z: accZ },
      throttle,
      vbat,
      events: [{ timeSec: 0.1, name: 'Arming: Armed (AUX1)' }],
      rotorflightValidation,
    };
  }

  let targetRpm = 2300;
  let craftName = 'OMP Hobby M4 380';
  let title = 'OMP M4 (정상/밸런스 양호 호버링)';
  let tailRatio = 4.45;

  if (sampleType === 'tail_vibe') {
    targetRpm = 2150;
    craftName = 'SAB Goblin 580 Raw';
    title = 'SAB Goblin 580 (테일 블레이드 불균형 고주파 진동)';
    tailRatio = 4.52;
  } else if (sampleType === 'main_vibe') {
    targetRpm = 1890;
    craftName = 'Align T-Rex 700X FBL';
    title = 'T-Rex 700X (메인 스핀들 휨 & 1P/2P 트래킹 진동)';
    tailRatio = 4.4;
  }

  const main1P_Freq = targetRpm / 60;
  const main2P_Freq = main1P_Freq * 2;
  const tail1P_Freq = main1P_Freq * tailRatio;
  const motor_Freq = main1P_Freq * 10.2; // ~10.2:1 gear ratio

  for (let i = 0; i < totalFrames; i++) {
    const t = i / sampleRateHz;
    time[i] = t;

    // Flight phases:
    // 0-3s: Spool up
    // 3-12s: In flight (hover + slight maneuvers)
    // 12-15s: Landing & spool down
    let spoolFactor = 0;
    if (t < 3.0) {
      spoolFactor = t / 3.0;
    } else if (t < 12.0) {
      spoolFactor = 1.0;
    } else {
      spoolFactor = Math.max(0, 1.0 - (t - 12.0) / 3.0);
    }

    const currentRpm = targetRpm * Math.min(1.0, spoolFactor * 1.05);
    rpm[i] = currentRpm;
    throttle[i] = spoolFactor * 75;
    if (collective) {
      collective[i] = t > 3.0 && t < 12.0 ? 5.0 + Math.sin(t * 1.5) * 2.5 : (t <= 3.0 ? -2 : -4);
    }
    vbat[i] = 25.2 - (t / durationSec) * 1.8; // 6S LiPo discharge

    // Basic sensor noise floor (white noise)
    const whiteNoiseR = (Math.random() - 0.5) * 2.5;
    const whiteNoiseP = (Math.random() - 0.5) * 2.5;
    const whiteNoiseY = (Math.random() - 0.5) * 2.0;

    // Flight motion dynamics (low frequency pitch/roll/yaw control)
    const flightMotionR = spoolFactor > 0.8 ? Math.sin(t * 1.2) * 12 : 0;
    const flightMotionP = spoolFactor > 0.8 ? Math.cos(t * 0.9) * 10 : 0;
    const flightMotionY = spoolFactor > 0.8 ? Math.sin(t * 0.4) * 15 : 0;

    // Mechanical Harmonics
    let main1PAmp = 1.8 * spoolFactor;
    let main2PAmp = 2.2 * spoolFactor;
    let tail1PAmp = 3.5 * spoolFactor;
    let motorAmp = 1.2 * spoolFactor;

    let accXNoise = (Math.random() - 0.5) * 0.04;
    let accYNoise = (Math.random() - 0.5) * 0.04;
    let accZNoise = (Math.random() - 0.5) * 0.04 + (spoolFactor > 0.8 ? 1.0 : 0.2); // 1G gravity on Z

    if (sampleType === 'tail_vibe') {
      // Strong 162Hz tail vibration spike!
      tail1PAmp = 34.0 * spoolFactor; // High yaw vibration!
      accYNoise += Math.sin(2 * Math.PI * tail1P_Freq * t) * 0.65 * spoolFactor;
      accZNoise += Math.cos(2 * Math.PI * tail1P_Freq * t) * 0.45 * spoolFactor;
    } else if (sampleType === 'main_vibe') {
      // Strong 31.5 Hz 1P and 63 Hz 2P Roll/Pitch spike!
      main1PAmp = 22.0 * spoolFactor;
      main2PAmp = 18.5 * spoolFactor;
      accXNoise += Math.sin(2 * Math.PI * main1P_Freq * t) * 0.55 * spoolFactor;
      accYNoise += Math.cos(2 * Math.PI * main1P_Freq * t) * 0.50 * spoolFactor;
    }

    const phase1P = 2 * Math.PI * main1P_Freq * t;
    const phase2P = 2 * Math.PI * main2P_Freq * t;
    const phaseTail = 2 * Math.PI * tail1P_Freq * t;
    const phaseMotor = 2 * Math.PI * motor_Freq * t;

    roll[i] = flightMotionR + whiteNoiseR + Math.sin(phase1P) * main1PAmp + Math.sin(phase2P) * main2PAmp * 0.7 + Math.sin(phaseMotor) * motorAmp;
    pitch[i] = flightMotionP + whiteNoiseP + Math.cos(phase1P) * main1PAmp + Math.cos(phase2P) * main2PAmp * 0.7 + Math.cos(phaseMotor) * motorAmp;
    yaw[i] = flightMotionY + whiteNoiseY + Math.sin(phaseTail) * tail1PAmp + Math.sin(phase1P) * (main1PAmp * 0.3);

    accX[i] = accXNoise + Math.sin(phase1P) * (main1PAmp * 0.015);
    accY[i] = accYNoise + Math.cos(phase1P) * (main1PAmp * 0.015);
    accZ[i] = accZNoise;
  }

  const heliFieldNames = [
    'loopIteration',
    'time',
    'gyroADC[0]',
    'gyroADC[1]',
    'gyroADC[2]',
    'accSmooth[0]',
    'accSmooth[1]',
    'accSmooth[2]',
    'rcCommand[0]',
    'rcCommand[1]',
    'rcCommand[2]',
    'rcCommand[3]',
    'collective',
    'servo[0]',
    'servo[1]',
    'servo[2]',
    'servo[3]',
    'vbatLatest',
    'amperageLatest',
    'motor[0]',
    'eRPM[0]',
  ];

  const rotorflightValidation: RotorflightValidation = {
    isRotorflight: true,
    hasRotorflightHeader: true,
    motorCount: 1,
    hasServos: true,
    servoCount: 4,
    hasCollective: true,
    reasons: [],
    details: {
      motorFields: ['motor[0]'],
      servoFields: ['servo[0]', 'servo[1]', 'servo[2]', 'servo[3]'],
      collectiveField: 'collective',
      firmwareHeader: 'Rotorflight v2.1.0-RELEASE',
      detectedHeaderTag: 'Firmware type: Rotorflight',
    },
  };

  return {
    id: 1,
    filename: `${title}.bbl`,
    firmwareType: 'Rotorflight 2.1 (Helicopter Flight Control)',
    firmwareVersion: 'Rotorflight v2.1.0-RELEASE',
    craftName,
    looptimeUs: 500,
    sampleRateHz,
    durationSec,
    totalFrames,
    headers: {
      Product: 'Blackbox flight data recorder by Nicholas Sherlock',
      'Data version': '2',
      firmwareType: 'Rotorflight',
      'Firmware revision': '2.1.0',
      craftName,
      looptime: '500',
      gyro_scale: '1.0',
      acc_1G: '2048',
      minthrottle: '1000',
      maxthrottle: '2000',
      vbatscale: '110',
      'Field I name': heliFieldNames.join(','),
    },
    fieldNames: heliFieldNames,
    time,
    gyro: {
      roll,
      pitch,
      yaw,
    },
    acc: {
      x: accX,
      y: accY,
      z: accZ,
    },
    rpm,
    throttle,
    collective,
    vbat,
    events: [
      { timeSec: 0.2, name: 'Arming: Armed (Switch B)' },
      { timeSec: 3.1, name: 'Governor: In-Flight State Reached' },
      { timeSec: 12.2, name: 'Landing: Throttle Hold Active' },
      { timeSec: 14.8, name: 'Disarm: Disarmed' },
    ],
    rotorflightValidation,
  };
}
