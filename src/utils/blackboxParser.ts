/**
 * Rotorflight Blackbox Log Parser — reference port of the official viewer
 * (rfblackbox/js/flightlog_parser.js + decoders.js + Rotorflight blackbox.c).
 * Binary .BBL + exported .CSV/.TXT, multi-log aware.
 */
import { BlackboxLog, FlightEvent, VibrationSummary, HeliConfig, VibrationGrade, RotorflightValidation } from '../types/blackbox';
import { computeMultiAxisFft, findVibrationPeaks } from './fft';

export interface ParseResult {
  logs: BlackboxLog[];
  primaryLogIndex: number;
}

// FFT 분석에 필요한 최소 연속 구간(초). 이보다 짧은 구간은 분석하지 않는다.
export const MIN_ANALYSIS_SEC = 30;

// Field predictors (blackbox_fielddefs.h / flightlog_parser.js)
export const PREDICTOR_0 = 0;
export const PREDICTOR_PREVIOUS = 1;
export const PREDICTOR_STRAIGHT_LINE = 2;
export const PREDICTOR_AVERAGE_2 = 3;
export const PREDICTOR_MINTHROTTLE = 4;
export const PREDICTOR_MOTOR_0 = 5;
export const PREDICTOR_INC = 6;
export const PREDICTOR_HOME_COORD = 7;
export const PREDICTOR_1500 = 8;
export const PREDICTOR_VBATREF = 9;
export const PREDICTOR_LAST_MAIN_FRAME_TIME = 10;
export const PREDICTOR_MINMOTOR = 11;
export const PREDICTOR_HOME_COORD_1 = 256;

// Field encodings
export const ENCODING_SIGNED_VB = 0;
export const ENCODING_UNSIGNED_VB = 1;
export const ENCODING_NEG_14BIT = 3;
export const ENCODING_TAG8_8SVB = 6;
export const ENCODING_TAG2_3S32 = 7;
export const ENCODING_TAG8_4S16 = 8;
export const ENCODING_NULL = 9;
export const ENCODING_TAG2_3SVARIABLE = 10;

// Event codes — official rfblackbox values (js/flightlog_fielddefs.js)
export const EVT_SYNC_BEEP = 0;
export const EVT_INFLIGHT_ADJUSTMENT = 13;
export const EVT_LOGGING_RESUME = 14;
export const EVT_DISARM = 15;
export const EVT_FLIGHT_MODE = 30;
export const EVT_GOVERNOR_STATE = 50;
export const EVT_RESCUE_STATE = 51;
export const EVT_AIRBORNE_STATE = 52;
export const EVT_CUSTOM_DATA = 100;
export const EVT_CUSTOM_STRING = 101;
export const EVT_LOG_END = 255;

const FLIGHT_EVENT_NAMES: Record<number, string> = {
  [EVT_SYNC_BEEP]: 'Sync Beep',
  [EVT_INFLIGHT_ADJUSTMENT]: 'In-flight Adjustment',
  [EVT_LOGGING_RESUME]: 'Logging Resume',
  [EVT_DISARM]: 'Disarm',
  [EVT_FLIGHT_MODE]: 'Flight Mode',
  [EVT_GOVERNOR_STATE]: 'Governor State',
  [EVT_RESCUE_STATE]: 'Rescue State',
  [EVT_AIRBORNE_STATE]: 'Airborne State',
  [EVT_CUSTOM_DATA]: 'Custom Data',
  [EVT_CUSTOM_STRING]: 'Custom String',
  [EVT_LOG_END]: 'End of Log',
};

export const START_MARKER_TEXT = 'H Product:Blackbox flight data recorder by Nicholas Sherlock\n';
const MAX_TIME_JUMP_US = 10 * 1000000;
const MAX_ITER_JUMP = 500 * 10;
/* Byte stream + helpers: reference ArrayDataStream + tools.js port. */

function hexToFloat(hex: string): number {
  const u = new Uint32Array(1);
  u[0] = parseInt(hex.trim(), 16) >>> 0;
  return new Float32Array(u.buffer)[0];
}

function signExtend2Bit(v: number): number { return (v & 0x02) ? (v | 0xfffffffc) : v; }
function signExtend4Bit(v: number): number { return (v & 0x08) ? (v | 0xfffffff0) : v; }
function signExtend5Bit(v: number): number { return (v & 0x10) ? (v | 0xffffffe0) : v; }
function signExtend6Bit(v: number): number { return (v & 0x20) ? (v | 0xffffffc0) : v; }
function signExtend7Bit(v: number): number { return (v & 0x40) ? (v | 0xffffff80) : v; }
function signExtend8Bit(v: number): number { return (v & 0x80) ? (v | 0xffffff00) : v; }
function signExtend14Bit(v: number): number { return (v & 0x2000) ? (v | 0xffffc000) : v; }
function signExtend16Bit(v: number): number { return (v & 0x8000) ? (v | 0xffff0000) : v; }
function signExtend24Bit(v: number): number { return (v & 0x800000) ? (v | 0xff000000) : v; }

function parseCommaList(value: string): number[] {
  return value.split(',').map(s => {
    const t = s.trim();
    if (t.length === 0) return 0;
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Byte stream with exact rfblackbox ArrayDataStream semantics. */
class ByteStream {
  data: Uint8Array;
  pos = 0;
  start = 0;
  end: number;
  eof = false;
  constructor(data: Uint8Array, start = 0, end?: number) {
    this.data = data; this.start = start; this.pos = start;
    this.end = end === undefined ? data.length : end;
  }
  readByte(): number {
    if (this.pos < this.end) return this.data[this.pos++];
    this.eof = true; return -1;
  }
  peekByte(): number {
    if (this.pos < this.end) return this.data[this.pos];
    this.eof = true; return -1;
  }
  peekChar(): string | number {
    if (this.pos < this.end) return String.fromCharCode(this.data[this.pos]);
    this.eof = true; return -1;
  }
  readChar(): string | number {
    if (this.pos < this.end) return String.fromCharCode(this.data[this.pos++]);
    this.eof = true; return -1;
  }
  unread(): void { this.pos--; }
  readUnsignedVB(): number {
    let shift = 0; let result = 0;
    for (let i = 0; i < 5; i++) {
      const b = this.readByte();
      if (b === -1) return 0;
      result = result | ((b & 0x7f) << shift);
      if (b < 128) return result >>> 0;
      shift += 7;
    }
    return 0;
  }
  readSignedVB(): number {
    const u = this.readUnsignedVB();
    return (u >>> 1) ^ -(u & 1);
  }
  nextOffsetOf(needle: Uint8Array): number {
    outer: for (let i = this.pos; i <= this.end - needle.length; i++) {
      if (this.data[i] !== needle[0]) continue;
      for (let j = 1; j < needle.length; j++) {
        if (this.data[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }
  readTag2_3S32(values: number[]): void {
    const lead0 = this.readByte();
    switch (lead0 >> 6) {
      case 0:
        values[0] = signExtend2Bit((lead0 >> 4) & 0x03);
        values[1] = signExtend2Bit((lead0 >> 2) & 0x03);
        values[2] = signExtend2Bit(lead0 & 0x03);
        break;
      case 1: {
        values[0] = signExtend4Bit(lead0 & 0x0f);
        const lb = this.readByte();
        values[1] = signExtend4Bit(lb >> 4);
        values[2] = signExtend4Bit(lb & 0x0f);
        break;
      }
      case 2: {
        values[0] = signExtend6Bit(lead0 & 0x3f);
        values[1] = signExtend6Bit(this.readByte() & 0x3f);
        values[2] = signExtend6Bit(this.readByte() & 0x3f);
        break;
      }
      case 3: {
        let lead = lead0;
        for (let i = 0; i < 3; i++) {
          switch (lead & 0x03) {
            case 0: values[i] = signExtend8Bit(this.readByte()); break;
            case 1: {
              const b1 = this.readByte(); const b2 = this.readByte();
              values[i] = signExtend16Bit(b1 | (b2 << 8)); break;
            }
            case 2: {
              const b1 = this.readByte(); const b2 = this.readByte(); const b3 = this.readByte();
              values[i] = signExtend24Bit(b1 | (b2 << 8) | (b3 << 16)); break;
            }
            case 3: {
              const b1 = this.readByte(); const b2 = this.readByte();
              const b3 = this.readByte(); const b4 = this.readByte();
              values[i] = (b1 | (b2 << 8) | (b3 << 16) | (b4 << 24)) | 0; break;
            }
          }
          lead >>= 2;
        }
        break;
      }
    }
  }
  readTag2_3SVariable(values: number[]): void {
    const lead0 = this.readByte();
    switch (lead0 >> 6) {
      case 0:
        values[0] = signExtend2Bit((lead0 >> 4) & 0x03);
        values[1] = signExtend2Bit((lead0 >> 2) & 0x03);
        values[2] = signExtend2Bit(lead0 & 0x03);
        break;
      case 1: {
        values[0] = signExtend5Bit((lead0 & 0x3e) >> 1);
        const lb2 = this.readByte();
        values[1] = signExtend5Bit(((lead0 & 0x01) << 5) | ((lb2 & 0x0f) >> 4));
        values[2] = signExtend4Bit(lb2 & 0x0f);
        break;
      }
      case 2: {
        const lb2 = this.readByte();
        values[0] = signExtend8Bit(((lead0 & 0x3f) << 2) | ((lb2 & 0xc0) >> 6));
        values[1] = signExtend7Bit(((lb2 & 0x3f) << 1) | ((lb2 & 0x80) >> 7));
        values[2] = signExtend7Bit(this.readByte() & 0x7f);
        break;
      }
      case 3: {
        let lead = lead0;
        for (let i = 0; i < 3; i++) {
          switch (lead & 0x03) {
            case 0: values[i] = signExtend8Bit(this.readByte()); break;
            case 1: {
              const b1 = this.readByte(); const b2 = this.readByte();
              values[i] = signExtend16Bit(b1 | (b2 << 8)); break;
            }
            case 2: {
              const b1 = this.readByte(); const b2 = this.readByte(); const b3 = this.readByte();
              values[i] = signExtend24Bit(b1 | (b2 << 8) | (b3 << 16)); break;
            }
            case 3: {
              const b1 = this.readByte(); const b2 = this.readByte();
              const b3 = this.readByte(); const b4 = this.readByte();
              values[i] = (b1 | (b2 << 8) | (b3 << 16) | (b4 << 24)) | 0; break;
            }
          }
          lead >>= 2;
        }
        break;
      }
    }
  }
  readTag8_4S16_v2(values: number[]): void {
    const FZ = 0, F4 = 1, F8 = 2, F16 = 3;
    let selector = this.readByte();
    let buffer = 0; let nibbleIndex = 0;
    for (let i = 0; i < 4; i++) {
      switch (selector & 0x03) {
        case FZ: values[i] = 0; break;
        case F4:
          if (nibbleIndex === 0) {
            buffer = this.readByte();
            values[i] = signExtend4Bit(buffer >> 4); nibbleIndex = 1;
          } else { values[i] = signExtend4Bit(buffer & 0x0f); nibbleIndex = 0; }
          break;
        case F8:
          if (nibbleIndex === 0) values[i] = signExtend8Bit(this.readByte());
          else {
            const c1 = (buffer & 0x0f) << 4;
            buffer = this.readByte();
            values[i] = signExtend8Bit(c1 | (buffer >> 4));
          }
          break;
        case F16:
          if (nibbleIndex === 0) {
            const c1 = this.readByte(); const c2 = this.readByte();
            values[i] = signExtend16Bit((c1 << 8) | c2);
          } else {
            const c1 = this.readByte(); const c2 = this.readByte();
            values[i] = signExtend16Bit(((buffer & 0x0f) << 12) | (c1 << 4) | (c2 >> 4));
            buffer = c2;
          }
          break;
      }
      selector >>= 2;
    }
  }
  readTag8_4S16_v1(values: number[]): void {
    const FZ = 0, F4 = 1, F8 = 2, F16 = 3;
    let selector = this.readByte();
    for (let i = 0; i < 4; i++) {
      switch (selector & 0x03) {
        case FZ: values[i] = 0; break;
        case F4: {
          const combined = this.readByte();
          values[i] = signExtend4Bit(combined & 0x0f);
          i++; selector >>= 2;
          values[i] = signExtend4Bit(combined >> 4);
          break;
        }
        case F8: values[i] = signExtend8Bit(this.readByte()); break;
        case F16: {
          const c1 = this.readByte(); const c2 = this.readByte();
          values[i] = signExtend16Bit(c1 | (c2 << 8)); break;
        }
      }
      selector >>= 2;
    }
  }
  readTag8_8SVB(values: number[], valueCount: number): void {
    if (valueCount === 1) values[0] = this.readSignedVB();
    else {
      const header = this.readByte();
      let h = header;
      for (let i = 0; i < 8; i++, h >>= 1) values[i] = (h & 0x01) ? this.readSignedVB() : 0;
    }
  }
}
/* Frame defs + prediction + decode: reference parseFrame() port. */
interface FrameDef {
  name: string[];
  nameToIndex: Record<string, number>;
  count: number;
  signed: number[];
  predictor: number[];
  encoding: number[];
}
interface SysConfig {
  firmwareType: string; firmwareVersion: string; craftName: string;
  looptimeUs: number; gyroScale: number; acc1G: number;
  minthrottle: number; maxthrottle: number; motorOutputMin: number;
  vbatref: number; vbatscale: number;
  frameIntervalI: number; frameIntervalPNum: number; frameIntervalPDenom: number;
  dataVersion: number;
}
function emptyFrameDef(): FrameDef {
  return { name: [], nameToIndex: {}, count: 0, signed: [], predictor: [], encoding: [] };
}
function applyPrediction(
  fi: number, predictor: number, value: number,
  current: number[], previous: number[] | null, previous2: number[] | null,
  sys: SysConfig, frameDefs: Record<string, FrameDef>, gpsHome1: number[] | null
): number {
  switch (predictor) {
    case PREDICTOR_0: break;
    case PREDICTOR_MINTHROTTLE: value = (value | 0) + sys.minthrottle; break;
    case PREDICTOR_MINMOTOR: value = (value | 0) + (sys.motorOutputMin | 0); break;
    case PREDICTOR_1500: value += 1500; break;
    case PREDICTOR_MOTOR_0: {
      const ix = frameDefs.I?.nameToIndex['motor[0]'];
      if (ix === undefined || ix < 0) throw new Error('MOTOR_0 prediction before motor[0]');
      value += current[ix]; break;
    }
    case PREDICTOR_VBATREF: value += sys.vbatref; break;
    case PREDICTOR_PREVIOUS: if (previous) value += previous[fi]; break;
    case PREDICTOR_STRAIGHT_LINE:
      if (previous && previous2) value += 2 * previous[fi] - previous2[fi];
      else if (previous) value += previous[fi];
      break;
    case PREDICTOR_AVERAGE_2:
      if (previous && previous2) value += ~~((previous[fi] + previous2[fi]) / 2);
      else if (previous) value += previous[fi];
      break;
    case PREDICTOR_HOME_COORD:
      if (!gpsHome1) throw new Error('HOME_COORD without GPS home');
      value += gpsHome1[0]; break;
    case PREDICTOR_HOME_COORD_1:
      if (!gpsHome1) throw new Error('HOME_COORD_1 without GPS home');
      value += gpsHome1[1]; break;
    case PREDICTOR_LAST_MAIN_FRAME_TIME: break; // caller adds mainHist1 time
    default: throw new Error('Unsupported field predictor ' + predictor);
  }
  return value;
}
function decodeFrame(
  stream: ByteStream, frameDef: FrameDef,
  current: number[], previous: number[] | null, previous2: number[] | null,
  skippedFrames: number, sys: SysConfig,
  frameDefs: Record<string, FrameDef>, gpsHome1: number[] | null,
  mainHist1Time: number | null
): boolean {
  const predictor = frameDef.predictor;
  const encoding = frameDef.encoding;
  const values = [0, 0, 0, 0, 0, 0, 0, 0];
  let i = 0;
  while (i < frameDef.count) {
    if (predictor[i] === PREDICTOR_INC) {
      current[i] = skippedFrames + 1;
      if (previous) current[i] += previous[i];
      i++; continue;
    }
    const enc = encoding[i];
    let value = 0;
    switch (enc) {
      case ENCODING_SIGNED_VB: value = stream.readSignedVB(); break;
      case ENCODING_UNSIGNED_VB: value = stream.readUnsignedVB(); break;
      case ENCODING_NEG_14BIT: value = -signExtend14Bit(stream.readUnsignedVB()); break;
      case ENCODING_TAG8_4S16:
        if (sys.dataVersion < 2) stream.readTag8_4S16_v1(values);
        else stream.readTag8_4S16_v2(values);
        for (let j = 0; j < 4; j++, i++) {
          current[i] = applyPrediction(i, predictor[i], values[j], current, previous, previous2, sys, frameDefs, gpsHome1);
        }
        if (stream.eof) return false;
        continue;
      case ENCODING_TAG2_3S32:
        stream.readTag2_3S32(values);
        for (let j = 0; j < 3; j++, i++) {
          current[i] = applyPrediction(i, predictor[i], values[j], current, previous, previous2, sys, frameDefs, gpsHome1);
        }
        if (stream.eof) return false;
        continue;
      case ENCODING_TAG2_3SVARIABLE:
        stream.readTag2_3SVariable(values);
        for (let j = 0; j < 3; j++, i++) {
          current[i] = applyPrediction(i, predictor[i], values[j], current, previous, previous2, sys, frameDefs, gpsHome1);
        }
        if (stream.eof) return false;
        continue;
      case ENCODING_TAG8_8SVB: {
        let j = i + 1;
        for (; j < i + 8 && j < frameDef.count; j++) {
          if (encoding[j] !== ENCODING_TAG8_8SVB) break;
        }
        const groupCount = j - i;
        stream.readTag8_8SVB(values, groupCount);
        for (let k = 0; k < groupCount; k++, i++) {
          current[i] = applyPrediction(i, predictor[i], values[k], current, previous, previous2, sys, frameDefs, gpsHome1);
        }
        if (stream.eof) return false;
        continue;
      }
      case ENCODING_NULL: value = 0; break;
      default:
        throw new Error(`Unsupported field encoding ${enc} for field '${frameDef.name[i]}'`);
    }
    if (stream.eof) return false;
    if (predictor[i] === PREDICTOR_LAST_MAIN_FRAME_TIME) {
      if (mainHist1Time !== null) value += mainHist1Time;
    } else {
      value = applyPrediction(i, predictor[i], value, current, previous, previous2, sys, frameDefs, gpsHome1);
    }
    current[i] = value;
    i++;
  }
  return !stream.eof;
}
function shouldHaveFrame(frameIndex: number, sys: SysConfig): boolean {
  return ((frameIndex % sys.frameIntervalI) + sys.frameIntervalPNum - 1) % sys.frameIntervalPDenom < sys.frameIntervalPNum;
}
function countSkippedTo(target: number, last: number, sys: SysConfig): number {
  if (last === -1) return 0;
  let c = 0;
  for (let f = last + 1; f < target; f++) if (!shouldHaveFrame(f, sys)) c++;
  return c;
}
function countSkipped(last: number, sys: SysConfig): number {
  if (last === -1) return 0;
  let c = 0;
  for (let f = last + 1; !shouldHaveFrame(f, sys); f++) c++;
  return c;
}

/**
 * Check if the log is a valid Rotorflight helicopter blackbox log.
 * 
 * User requirement:
 * "multirotor 드론 때문에 구분이 안감. rotorflight 대소문자 구분하지 않고 bbl 헤더에 있을때 rotorflight bbl로 인정"
 * 
 * When "rotorflight" (case-insensitive) is present anywhere in the BBL header:
 * It is recognized as a Rotorflight BBL!
 */
export function validateRotorflightLog(
  fieldNames: string[],
  firmwareHeaderOrHeaders: string | Record<string, string>,
  rawHeaders?: string
): RotorflightValidation {
  const headers: Record<string, string> = typeof firmwareHeaderOrHeaders === 'string'
    ? { 'Firmware revision': firmwareHeaderOrHeaders }
    : firmwareHeaderOrHeaders;
  let hasRotorflightHeader = false;
  let detectedHeaderTag: string | undefined;

  // 1. Search in all parsed header keys and values (case-insensitive)
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith('__')) continue;
    if (key.toLowerCase().includes('rotorflight')) {
      hasRotorflightHeader = true;
      detectedHeaderTag = `${key}: ${value}`;
      break;
    }
    if (typeof value === 'string' && value.toLowerCase().includes('rotorflight')) {
      hasRotorflightHeader = true;
      detectedHeaderTag = `${key}: ${value}`;
      break;
    }
  }

  // 2. Search in raw header block text (case-insensitive)
  const raw = rawHeaders || headers['__rawHeaders__'];
  if (!hasRotorflightHeader && raw && /rotorflight/i.test(raw)) {
    hasRotorflightHeader = true;
    detectedHeaderTag = 'BBL Header Text: rotorflight';
  }

  // 3. Fallback: check specific firmware/craft headers
  if (!hasRotorflightHeader) {
    const checkKeys = ['Firmware type', 'firmwareType', 'Firmware revision', 'Product', 'craftName'];
    for (const k of checkKeys) {
      if (headers[k] && /rotorflight/i.test(headers[k])) {
        hasRotorflightHeader = true;
        detectedHeaderTag = `${k}: ${headers[k]}`;
        break;
      }
    }
  }

  // Secondary helicopter hardware characteristics for diagnostics & info
  const motorFields = fieldNames.filter(f =>
    /^motor\[\d+\]$/i.test(f.trim()) ||
    /^motor_\d+$/i.test(f.trim()) ||
    f.trim().toLowerCase().startsWith('motor[')
  );
  const motorCount = motorFields.length;

  const servoFields = fieldNames.filter(f => /servo/i.test(f.trim()));
  const servoCount = servoFields.length;
  const hasServos = servoCount > 0;

  let collectiveField: string | null = null;
  const foundCollective = fieldNames.find(f => /collective/i.test(f.trim()));
  if (foundCollective) {
    collectiveField = foundCollective;
  } else if (
    headers['Field I name']?.toLowerCase().includes('collective') ||
    headers['Field P name']?.toLowerCase().includes('collective') ||
    headers['collective']
  ) {
    collectiveField = 'collective';
  }
  const hasCollective = Boolean(collectiveField);

  const reasons: string[] = [];

  // Core Decision: When "rotorflight" (case-insensitive) is present in BBL header -> RECOGNIZE!
  const isRotorflight = hasRotorflightHeader;

  const firmwareHeader =
    headers['Firmware type'] ||
    headers['firmwareType'] ||
    headers['Firmware revision'] ||
    headers['Product'] ||
    undefined;

  if (hasRotorflightHeader) {
    // Recognized as Rotorflight BBL
  } else {
    // Rejected: Non-Rotorflight (Multirotor Drone / Betaflight / etc.)
    reasons.push('BBL 헤더에 "rotorflight" (대소문자 무관) 식별자가 존재하지 않습니다.');
    if (firmwareHeader) {
      reasons.push(`감지된 펌웨어 헤더: "${firmwareHeader}" (멀티로터 드론/Betaflight 등)`);
    } else {
      reasons.push('멀티로터 드론 또는 비-Rotorflight 블랙박스 파일로 식별되었습니다.');
    }
    if (motorCount >= 3) {
      reasons.push(`모터가 ${motorCount}개 감지되었습니다. (멀티로터 쿼드콥터 드론)`);
    }
    if (!hasServos) {
      reasons.push('스와시플레이트 서보(Servo) 항목이 감지되지 않았습니다.');
    }
    if (!hasCollective) {
      reasons.push('COLLECTIVE(콜렉티브 피치) 제어 항목이 감지되지 않았습니다.');
    }
  }

  return {
    isRotorflight,
    hasRotorflightHeader,
    motorCount,
    hasServos,
    servoCount,
    hasCollective,
    reasons,
    details: {
      motorFields,
      servoFields,
      collectiveField,
      firmwareHeader,
      detectedHeaderTag,
    },
  };
}

/**
 * Main parser entry point
 */
export async function parseBlackboxFile(file: File | ArrayBuffer, fileName: string = 'flight.bbl'): Promise<ParseResult> {
  const buffer = file instanceof File ? await file.arrayBuffer() : file;
  const uint8 = new Uint8Array(buffer);

  // Text vs binary discriminator: NEVER route by content keywords.
  // Binary .BBL headers contain the very same keywords ('loopIteration', 'gyroADC', ...)
  // as CSV exports, so keyword sniffing misroutes real .BBL files to the CSV parser
  // (resulting in garbage fieldNames and all-zero samples). Only a UTF-8 BOM or a
  // .csv/.txt extension routes to the text parser first; everything else is parsed
  // as binary .BBL first with a text fallback.
  const lowerName = (fileName || '').toLowerCase();
  const isTextByExtension = lowerName.endsWith('.csv') || lowerName.endsWith('.txt');
  const hasUtf8Bom = uint8.length > 2 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf;

  const parseAsText = (): ParseResult | null => {
    try {
      let text = new TextDecoder('utf-8').decode(uint8);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      const parsedLogs = parseCsvOrTextLog(text, fileName);
      if (parsedLogs.length > 0) return { logs: parsedLogs, primaryLogIndex: 0 };
    } catch {
      // fall through to the other parser
    }
    return null;
  };

  const parseAsBinary = (): ParseResult | null => {
    try {
      const parsedLogs = parseBinaryBbl(uint8, fileName);
      if (parsedLogs.length > 0) return { logs: parsedLogs, primaryLogIndex: 0 };
    } catch (e) {
      // fall through to the other parser
    }
    return null;
  };

  if (isTextByExtension || hasUtf8Bom) {
    const textResult = parseAsText();
    if (textResult) return textResult;
    const binaryResult = parseAsBinary();
    if (binaryResult) return binaryResult;
    throw new Error('블랙박스 데이터 프레임을 찾을 수 없습니다. 올바른 Rotorflight .BBL 또는 .CSV 파일인지 확인해주세요.');
  }

  // Binary .BBL first (real flight recorder logs), text export fallback
  const binaryResult = parseAsBinary();
  if (binaryResult) return binaryResult;
  const textResult = parseAsText();
  if (textResult) return textResult;
  throw new Error('블랙박스 데이터 프레임을 찾을 수 없습니다. 올바른 Rotorflight .BBL 또는 .CSV 파일인지 확인해주세요.');
}

/** Legacy text sniff kept for reference (no longer used for routing). */
function checkIfTextLog(bytes: Uint8Array): boolean {
  // Check first 1024 bytes for non-printable characters
  const sampleLen = Math.min(1024, bytes.length);
  let asciiCount = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) {
      asciiCount++;
    }
  }
  return asciiCount / sampleLen > 0.95;
}

/**
 * Parse Rotorflight CSV or Blackbox decoded text file
 */
export function parseCsvOrTextLog(text: string, fileName: string): BlackboxLog[] {
  const lines = text.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let headerLines: string[] = [];
  let dataStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    if (line.startsWith('#') || line.startsWith('H ')) {
      const clean = line.replace(/^[#H]\s*/, '');
      const ci = clean.indexOf(':');
      if (ci > 0) headers[clean.slice(0, ci).trim()] = clean.slice(ci + 1).trim();
      continue;
    }
    headerLines = line.split(',').map(s => s.trim().replace(/^\"|\"$/g, ''));
    dataStartIndex = i + 1;
    break;
  }
  if (headerLines.length === 0) throw new Error('CSV 헤더를 찾을 수 없습니다.');
  const findCol = (...cands: string[]): number => {
    for (const c of cands) {
      const ix = headerLines.findIndex(h => h.toLowerCase() === c.toLowerCase());
      if (ix >= 0) return ix;
    }
    for (const c of cands) {
      const ix = headerLines.findIndex(h => h.toLowerCase().includes(c.toLowerCase()));
      if (ix >= 0) return ix;
    }
    return -1;
  };
  const timeIdx = findCol('time', 'time (ms)', 'time(ms)', 'timestamp');
  const timeIsMs = headerLines[timeIdx]?.toLowerCase().includes('ms') ?? false;
  const rollIdx = findCol('gyroADC[0]', 'gyro_roll', 'roll');
  const pitchIdx = findCol('gyroADC[1]', 'gyro_pitch', 'pitch');
  const yawIdx = findCol('gyroADC[2]', 'gyro_yaw', 'yaw');
  const rawRollIdx = findCol('gyroRAW[0]');
  const rawPitchIdx = findCol('gyroRAW[1]');
  const rawYawIdx = findCol('gyroRAW[2]');
  const hasGyroFilteredField = rollIdx >= 0 || pitchIdx >= 0 || yawIdx >= 0;
  const hasGyroRawField = rawRollIdx >= 0 || rawPitchIdx >= 0 || rawYawIdx >= 0;
  // gyroADC 컬럼이 없는 CSV는 gyroRAW 컬럼으로 대체 → 최소 1개 소스는 제공
  const effRollIdx = hasGyroFilteredField ? rollIdx : rawRollIdx;
  const effPitchIdx = hasGyroFilteredField ? pitchIdx : rawPitchIdx;
  const effYawIdx = hasGyroFilteredField ? yawIdx : rawYawIdx;
  const accXIdx = findCol('accSmooth[0]', 'accADC[0]', 'acc_x');
  const accYIdx = findCol('accSmooth[1]', 'accADC[1]', 'acc_y');
  const accZIdx = findCol('accSmooth[2]', 'accADC[2]', 'acc_z');
  const rpmIdx = findCol('headspeed', 'eRPM[0]', 'rpm');
  const tailRpmIdx = findCol('tailspeed');
  const vbatIdx = findCol('vbatLatest', 'Vbat', 'vbat');
  const curIdx = findCol('amperageLatest', 'amperage', 'current');
  const thrIdx = findCol('rcCommand[3]', 'throttle', 'motor[0]');
  const collIdx = findCol('collective', 'setpoint[3]', 'mixer[3]');
  const time: number[] = [];
  const roll: number[] = [];
  const pitch: number[] = [];
  const yaw: number[] = [];
  const rawRoll: number[] = [];
  const rawPitch: number[] = [];
  const rawYaw: number[] = [];
  const accX: number[] = [];
  const accY: number[] = [];
  const accZ: number[] = [];
  const rpmA: number[] = [];
  const tailA: number[] = [];
  const vbatA: number[] = [];
  const curA: number[] = [];
  const thrA: number[] = [];
  const collA: number[] = [];
  const acc1G = parseFloat(headers['acc_1G'] || '2048') || 2048;
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('H ')) continue;
    const cols = line.split(',');
    if (cols.length < headerLines.length - 2) continue;
    const num = (ix: number): number => {
      if (ix < 0 || ix >= cols.length) return 0;
      const v = parseFloat(cols[ix]);
      return Number.isFinite(v) ? v : 0;
    };
    let t = timeIdx >= 0 ? num(timeIdx) : time.length * 0.001;
    if (timeIsMs) t = t / 1000;
    time.push(t);
    roll.push(effRollIdx >= 0 ? num(effRollIdx) : 0);
    pitch.push(effPitchIdx >= 0 ? num(effPitchIdx) : 0);
    yaw.push(effYawIdx >= 0 ? num(effYawIdx) : 0);
    if (hasGyroRawField) {
      rawRoll.push(rawRollIdx >= 0 ? num(rawRollIdx) : 0);
      rawPitch.push(rawPitchIdx >= 0 ? num(rawPitchIdx) : 0);
      rawYaw.push(rawYawIdx >= 0 ? num(rawYawIdx) : 0);
    }
    accX.push(accXIdx >= 0 ? num(accXIdx) / acc1G : 0);
    accY.push(accYIdx >= 0 ? num(accYIdx) / acc1G : 0);
    accZ.push(accZIdx >= 0 ? num(accZIdx) / acc1G : 0);
    if (rpmIdx >= 0) rpmA.push(num(rpmIdx));
    if (tailRpmIdx >= 0) tailA.push(num(tailRpmIdx));
    if (vbatIdx >= 0) vbatA.push(num(vbatIdx) / 100);
    if (curIdx >= 0) curA.push(num(curIdx) / 100);
    if (thrIdx >= 0) thrA.push(num(thrIdx));
    if (collIdx >= 0) collA.push(num(collIdx));
  }
  if (time.length < 100) throw new Error(`유효한 데이터 행이 부족합니다. (${time.length}행)`);
  const t0 = time[0];
  for (let i = 0; i < time.length; i++) time[i] -= t0;
  const dts: number[] = [];
  for (let i = 1; i < Math.min(time.length, 5000); i++) {
    const d = time[i] - time[i - 1];
    if (d > 0 && d < 1) dts.push(d);
  }
  dts.sort((a, b) => a - b);
  const medianDt = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : 0.001;
  const sampleRateHz = Math.round(1 / medianDt);
  const durationSec = time[time.length - 1] - time[0];
  const firmwareHeader = headers['Firmware revision'] || headers['firmware'] || headers['Firmware type'] || '';
  const validation = validateRotorflightLog(headerLines, firmwareHeader);
  const hasRpmSensor = rpmIdx >= 0;
  return [{
    id: 1, filename: fileName,
    firmwareType: firmwareHeader || 'Unknown',
    firmwareVersion: firmwareHeader,
    craftName: headers['Craft name'] || headers['craftName'],
    looptimeUs: Math.round(1000000 / sampleRateHz),
    sampleRateHz, durationSec, totalFrames: time.length,
    headers, fieldNames: headerLines,
    time: Float32Array.from(time),
    gyro: { roll: Float32Array.from(roll), pitch: Float32Array.from(pitch), yaw: Float32Array.from(yaw) },
    gyroRaw: hasGyroRawField && rawRoll.length > 0
      ? { roll: Float32Array.from(rawRoll), pitch: Float32Array.from(rawPitch), yaw: Float32Array.from(rawYaw) }
      : undefined,
    hasGyroFiltered: hasGyroFilteredField,
    hasGyroRaw: hasGyroRawField,
    acc: { x: Float32Array.from(accX), y: Float32Array.from(accY), z: Float32Array.from(accZ) },
    rpm: rpmA.length > 0 ? Float32Array.from(rpmA) : undefined,
    rpmSource: hasRpmSensor ? 'sensor' : 'none',
    tailRpm: tailA.length > 0 ? Float32Array.from(tailA) : undefined,
    throttle: thrA.length > 0 ? Float32Array.from(thrA) : undefined,
    collective: collA.length > 0 ? Float32Array.from(collA) : undefined,
    vbat: vbatA.length > 0 ? Float32Array.from(vbatA) : undefined,
    current: curA.length > 0 ? Float32Array.from(curA) : undefined,
    events: [], rotorflightValidation: validation,
  }];
}

// CSV rows may pad missing trailing columns; gate on real sensor presence.
export function hasRpmSensorData(log: Pick<import('../types/blackbox').BlackboxLog, 'rpm' | 'rpmSource'>): boolean {
  if (log.rpmSource === 'sensor') return true;
  if (log.rpmSource === 'stft_estimated') return false;
  return !!log.rpm && log.rpm.length > 0;
}

/**
 * Parse Binary .BBL file — reference port (multi-log aware).
 */
function buildBlackboxLog(parsed: ParsedLogData, fileName: string, id: number): BlackboxLog {
  const { headers, sysConfig, frameDefs, samples, events, hasGyroFilteredField, hasGyroRawField } = parsed;
  const n = samples.length;
  const time = new Float32Array(n);
  const roll = new Float32Array(n);
  const pitch = new Float32Array(n);
  const yaw = new Float32Array(n);
  const rawRoll = hasGyroRawField ? new Float32Array(n) : null;
  const rawPitch = hasGyroRawField ? new Float32Array(n) : null;
  const rawYaw = hasGyroRawField ? new Float32Array(n) : null;
  const accX = new Float32Array(n);
  const accY = new Float32Array(n);
  const accZ = new Float32Array(n);
  const rpm = new Float32Array(n);
  const tailRpmArr = new Float32Array(n);
  const throttle = new Float32Array(n);
  const vbat = new Float32Array(n);
  const current = new Float32Array(n);
  let hasRpm = false, hasTail = false, hasThr = false, hasVbat = false, hasCur = false;
  const t0 = samples[0].timeUs;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    time[i] = (s.timeUs - t0) / 1000000;
    roll[i] = s.gyro[0]; pitch[i] = s.gyro[1]; yaw[i] = s.gyro[2];
    if (s.gyroRaw && rawRoll && rawPitch && rawYaw) {
      rawRoll[i] = s.gyroRaw[0]; rawPitch[i] = s.gyroRaw[1]; rawYaw[i] = s.gyroRaw[2];
    }
    accX[i] = s.acc[0]; accY[i] = s.acc[1]; accZ[i] = s.acc[2];
    if (s.headspeed > 0) { rpm[i] = s.headspeed; hasRpm = true; }
    if (s.tailspeed > 0) { tailRpmArr[i] = s.tailspeed; hasTail = true; }
    if (s.throttle !== 0) { throttle[i] = s.throttle; hasThr = true; }
    if (s.vbat !== 0) { vbat[i] = s.vbat; hasVbat = true; }
    if (s.amperage !== 0) { current[i] = s.amperage; hasCur = true; }
  }
  const durationSec = n > 1 ? time[n - 1] - time[0] : 0;
  const dts: number[] = [];
  const probe = Math.min(n - 1, 20000);
  for (let i = 1; i <= probe; i++) {
    const d = time[i] - time[i - 1];
    if (d > 0.00005 && d < 1) dts.push(d);
  }
  dts.sort((a, b) => a - b);
  const medianDt = dts.length > 0 ? dts[Math.floor(dts.length / 2)] : sysConfig.looptimeUs / 1000000;
  const sampleRateHz = Math.max(1, Math.round(1 / medianDt));
  const firmwareHeader: string = headers['Firmware revision'] || headers['Firmware type'] || sysConfig.firmwareType || '';
  const fieldNames: string[] = frameDefs.I?.name ?? [];
  const validation = validateRotorflightLog(fieldNames, firmwareHeader);
  const hasHeadspeedField = fieldNames.includes('headspeed');
  const flightEvents: FlightEvent[] = events.map(e => ({
    timeSec: (e.timeUs - t0) / 1000000,
    name: e.data ? `${e.name} (${e.data})` : e.name,
  }));
  return {
    id, filename: fileName,
    firmwareType: sysConfig.firmwareType !== 'Unknown' ? sysConfig.firmwareType : (firmwareHeader || 'Rotorflight'),
    firmwareVersion: sysConfig.firmwareVersion || firmwareHeader,
    craftName: sysConfig.craftName || headers['Craft name'],
    looptimeUs: sysConfig.looptimeUs, sampleRateHz, durationSec, totalFrames: n,
    headers, fieldNames, time,
    gyro: { roll, pitch, yaw }, acc: { x: accX, y: accY, z: accZ },
    gyroRaw: rawRoll && rawPitch && rawYaw ? { roll: rawRoll, pitch: rawPitch, yaw: rawYaw } : undefined,
    hasGyroFiltered: hasGyroFilteredField,
    hasGyroRaw: hasGyroRawField,
    rpm: hasRpm ? rpm : undefined,
    rpmSource: hasRpm || hasHeadspeedField ? 'sensor' : 'none',
    tailRpm: hasTail ? tailRpmArr : undefined,
    throttle: hasThr ? throttle : undefined,
    vbat: hasVbat ? vbat : undefined,
    current: hasCur ? current : undefined,
    events: flightEvents, rotorflightValidation: validation,
  };
}

// Splits multi-log files at every start marker (FlightLogIndex behaviour).
export function parseBinaryBbl(bytes: Uint8Array, fileName: string): BlackboxLog[] {
  const marker = new TextEncoder().encode(START_MARKER_TEXT);
  const logBegins: number[] = [];
  {
    const scan = new ByteStream(bytes);
    for (;;) {
      const off = scan.nextOffsetOf(marker);
      if (off === -1) break;
      logBegins.push(off);
      scan.pos = off + marker.length;
      if (logBegins.length > 64) break;
    }
  }
  if (logBegins.length === 0) logBegins.push(0);
  const logEnds = logBegins.map((_, i) => (i + 1 < logBegins.length ? logBegins[i + 1] : bytes.length));
  const logs: BlackboxLog[] = [];
  for (let li = 0; li < logBegins.length; li++) {
    try {
      const parsed = parseSingleBinaryLog(bytes, logBegins[li], logEnds[li]);
      if (!parsed || parsed.samples.length < 10) continue;
      const log = buildBlackboxLog(parsed, fileName, li + 1);
      if (log.totalFrames >= 10) logs.push(log);
    } catch (e) { console.warn(`BBL log #${li + 1} parse failed:`, e); continue; }
  }
  if (logs.length === 0) {
    throw new Error('BBL 파일에서 유효한 비행 로그를 찾을 수 없습니다. Rotorflight 블랙박스 파일(.BBL)이 맞는지 확인해주세요.');
  }
  logs.forEach((l, i) => { l.id = i + 1; });
  return logs;
}
interface MainSample {
  timeUs: number; iteration: number;
  gyro: [number, number, number]; acc: [number, number, number];
  /** gyroRAW (미필터) — 해당 필드가 없으면 null */
  gyroRaw: [number, number, number] | null;
  headspeed: number; tailspeed: number; motor: number;
  vbat: number; amperage: number; throttle: number;
}
interface ParsedLogData {
  headers: Record<string, string>; sysConfig: SysConfig;
  frameDefs: Record<string, FrameDef>; samples: MainSample[];
  events: { timeUs: number; name: string; data?: string }[];
  /** gyroADC[n] (필터 통과) 필드가 BBL에 기록되어 있는지 */
  hasGyroFilteredField: boolean;
  /** gyroRAW[n] (미필터) 필드가 BBL에 기록되어 있는지 */
  hasGyroRawField: boolean;
}

function applyHeaderField(
  fieldName: string, fieldValue: string, sys: SysConfig,
  frameDefs: Record<string, FrameDef>, headers: Record<string, string>
): void {
  switch (fieldName) {
    case 'I interval': sys.frameIntervalI = Math.max(1, parseInt(fieldValue, 10) || 32); break;
    case 'P interval': {
      const m = fieldValue.match(/(\d+)\/(\d+)/);
      if (m) { sys.frameIntervalPNum = parseInt(m[1], 10); sys.frameIntervalPDenom = parseInt(m[2], 10); }
      else { sys.frameIntervalPNum = 1; sys.frameIntervalPDenom = parseInt(fieldValue, 10) || 1; }
      break;
    }
    case 'Data version': sys.dataVersion = parseInt(fieldValue, 10) || 2; break;
    case 'looptime': sys.looptimeUs = parseInt(fieldValue, 10) || sys.looptimeUs; break;
    case 'gyro_scale': case 'gyro.scale': {
      const f = hexToFloat(fieldValue);
      if (Number.isFinite(f) && f !== 0) sys.gyroScale = f; break;
    }
    case 'acc_1G': sys.acc1G = parseInt(fieldValue, 10) || sys.acc1G; break;
    case 'minthrottle':
      sys.minthrottle = parseInt(fieldValue, 10) || sys.minthrottle;
      sys.motorOutputMin = sys.minthrottle; break;
    case 'maxthrottle': sys.maxthrottle = parseInt(fieldValue, 10) || sys.maxthrottle; break;
    case 'motorOutput': {
      const parts = parseCommaList(fieldValue);
      if (parts.length > 0 && parts[0] !== 0) sys.motorOutputMin = parts[0]; break;
    }
    case 'vbatref': sys.vbatref = parseInt(fieldValue, 10) || sys.vbatref; break;
    case 'vbatscale': sys.vbatscale = parseInt(fieldValue, 10) || sys.vbatscale; break;
    case 'Firmware revision': {
      const m = fieldValue.match(/(.*flight).* (\d+)\.(\d+)(\.(\d+))*/i);
      if (m) {
        sys.firmwareType = m[1].toLowerCase() === 'rotorflight' ? 'Rotorflight' : m[1];
        sys.firmwareVersion = `${m[2]}.${m[3]}.${m[5] ?? '0'}`;
      }
      headers['Firmware revision'] = fieldValue; break;
    }
    case 'Firmware type':
      if (/rotorflight/i.test(fieldValue)) sys.firmwareType = 'Rotorflight';
      else if (fieldValue) sys.firmwareType = fieldValue; break;
    case 'Craft name': sys.craftName = fieldValue; break;
    default: {
      const m = fieldName.match(/^Field (.) (.+)$/);
      if (m) {
        const frameName = m[1]; const info = m[2];
        if (!frameDefs[frameName]) frameDefs[frameName] = emptyFrameDef();
        const def = frameDefs[frameName];
        if (info === 'predictor') def.predictor = parseCommaList(fieldValue);
        else if (info === 'encoding') def.encoding = parseCommaList(fieldValue);
        else if (info === 'name') {
          def.name = fieldValue.split(',').map(s => s.replace(/^gyroData(.+)$/, 'gyroADC$1'));
          def.count = def.name.length; def.nameToIndex = {};
          def.name.forEach((n, ix) => { def.nameToIndex[n] = ix; });
          def.signed.length = def.count;
        } else if (info === 'signed') def.signed = parseCommaList(fieldValue);
      }
      break;
    }
  }
}

function parseSingleBinaryLog(bytes: Uint8Array, logStart: number, logEnd: number): ParsedLogData | null {
  const stream = new ByteStream(bytes, logStart, logEnd);
  const headers: Record<string, string> = {};
  const frameDefs: Record<string, FrameDef> = {};
  const sys: SysConfig = {
    firmwareType: 'Unknown', firmwareVersion: '', craftName: '',
    looptimeUs: 500, gyroScale: 1.0, acc1G: 2048,
    minthrottle: 1150, maxthrottle: 2000, motorOutputMin: 1150,
    vbatref: 4095, vbatscale: 110,
    frameIntervalI: 32, frameIntervalPNum: 1, frameIntervalPDenom: 1, dataVersion: 2,
  };
  const NEWLINE = 10, COLON = 58;
  const isFrameChar = (c: string | number): boolean =>
    c === 'I' || c === 'P' || c === 'G' || c === 'H' || c === 'S' || c === 'E';
  headerLoop:
  while (true) {
    const cmd = stream.readChar();
    if (cmd === -1) break;
    if (cmd === 'H') {
      if (stream.peekChar() !== ' ') continue;
      stream.readChar();
      const lineStart = stream.pos;
      let sepPos = -1, lineEnd = -1;
      for (; stream.pos < lineStart + 4096 && stream.pos < stream.end; stream.pos++) {
        const b = stream.data[stream.pos];
        if (sepPos === -1 && b === COLON) sepPos = stream.pos;
        if (b === NEWLINE || b === 0) { lineEnd = stream.pos; break; }
      }
      if (lineEnd === -1 || sepPos === -1) continue;
      const dec = new TextDecoder('utf-8', { fatal: false });
      const fn = dec.decode(bytes.subarray(lineStart, sepPos));
      const fv = dec.decode(bytes.subarray(sepPos + 1, lineEnd));
      stream.pos = lineEnd + 1;
      headers[fn] = fv;
      applyHeaderField(fn, fv, sys, frameDefs, headers);
    } else if (isFrameChar(cmd)) { stream.unread(); break headerLoop; }
  }
  let defI = frameDefs.I;
  let defP = frameDefs.P;
  if (!defI || defI.count === 0 || defI.predictor.length !== defI.count || defI.encoding.length !== defI.count) {
    throw new Error('I 프레임 정의가 없어 로그 헤더가 손상되었습니다.');
  }
  if (!defP) throw new Error('P 프레임 정의가 없어 로그 헤더가 손상되었습니다.');
  defP = frameDefs.P = {
    name: defI.name, nameToIndex: defI.nameToIndex, count: defI.count,
    signed: defI.signed, predictor: defP.predictor, encoding: defP.encoding,
  };
  if (defP.predictor.length !== defP.count || defP.encoding.length !== defP.count) {
    throw new Error('P 프레임 정의가 불완전합니다.');
  }
  defI = frameDefs.I;
  const defG = frameDefs.G;
  if (defG) {
    for (let i = 1; i < defG.count; i++) {
      if (defG.predictor[i - 1] === PREDICTOR_HOME_COORD && defG.predictor[i] === PREDICTOR_HOME_COORD) {
        defG.predictor[i] = PREDICTOR_HOME_COORD_1;
      }
    }
  }

  const samples: MainSample[] = [];
  const events: { timeUs: number; name: string; data?: string }[] = [];
  const FRAME_CHARS = new Set(['I', 'P', 'G', 'H', 'S', 'E']);
  let main0: number[] = new Array(defI.count).fill(0);
  let main1: number[] | null = null;
  let main2: number[] | null = null;
  let lastMainFrameTime = -1;
  let lastMainFrameIteration = -1;
  let mainStreamValid = false;
  let gpsHome1: number[] | null = null;
  const idxTime = 1, idxIter = 0;
  const fidx = (n: string): number => defI.nameToIndex[n] ?? -1;
  const iGyroF = [fidx('gyroADC[0]'), fidx('gyroADC[1]'), fidx('gyroADC[2]')];
  const iGyroR = [fidx('gyroRAW[0]'), fidx('gyroRAW[1]'), fidx('gyroRAW[2]')];
  // Rotorflight: gyroADC = gyroADCf (자이로 필터 통과), gyroRAW = gyroADCd (필터 전 raw)
  const hasGyroFilteredField = iGyroF[0] >= 0;
  const hasGyroRawField = iGyroR[0] >= 0;
  // gyroADC 필드가 없는 로그(일부 구버전/디버그 설정)는 gyroRAW로 대체 → 최소 1개 소스는 제공
  const iGyro = hasGyroFilteredField ? iGyroF : iGyroR;
  const iAcc = [fidx('accSmooth[0]'), fidx('accSmooth[1]'), fidx('accSmooth[2]')];
  const iAccAlt = [fidx('accADC[0]'), fidx('accADC[1]'), fidx('accADC[2]')];
  const iHead = fidx('headspeed');
  const iTail = fidx('tailspeed');
  const iMotor = fidx('motor[0]');
  const iVbat = fidx('Vbat');
  const iAmp = fidx('amperageLatest') >= 0 ? fidx('amperageLatest') : fidx('Ibat');
  const iThr = fidx('rcCommand[3]');
  const useAltAcc = iAcc[0] < 0 && iAccAlt[0] >= 0;
  const pushSample = (frame: number[]): void => {
    const g = (k: number): number => {
      const fi = iGyro[k]; return fi >= 0 ? frame[fi] * sys.gyroScale : 0;
    };
    const gr = (k: number): number => {
      const fi = iGyroR[k]; return fi >= 0 ? frame[fi] * sys.gyroScale : 0;
    };
    const a = (k: number): number => {
      const fi = useAltAcc ? iAccAlt[k] : iAcc[k];
      return fi >= 0 ? frame[fi] / sys.acc1G : 0;
    };
    samples.push({
      timeUs: frame[idxTime], iteration: frame[idxIter],
      gyro: [g(0), g(1), g(2)], acc: [a(0), a(1), a(2)],
      gyroRaw: hasGyroRawField ? [gr(0), gr(1), gr(2)] : null,
      headspeed: iHead >= 0 ? frame[iHead] : 0,
      tailspeed: iTail >= 0 ? frame[iTail] : 0,
      motor: iMotor >= 0 ? frame[iMotor] : 0,
      vbat: iVbat >= 0 ? frame[iVbat] / 100 : 0,
      amperage: iAmp >= 0 ? frame[iAmp] / 100 : 0,
      throttle: iThr >= 0 ? frame[iThr] : 0,
    });
  };
  const completeIntra = (frame: number[]): boolean => {
    if (lastMainFrameIteration !== -1) {
      if (
        frame[idxIter] < lastMainFrameIteration ||
        frame[idxIter] > lastMainFrameIteration + MAX_ITER_JUMP ||
        frame[idxTime] < lastMainFrameTime ||
        frame[idxTime] > lastMainFrameTime + MAX_TIME_JUMP_US
      ) { mainStreamValid = false; return false; }
    }
    mainStreamValid = true;
    lastMainFrameIteration = frame[idxIter];
    lastMainFrameTime = frame[idxTime];
    pushSample(frame);
    // Reference (flightlog_parser.js completeIntraframe): after an I-frame, BOTH
    // previous and previous-previous become the I-frame, because we can't look
    // further into the past than the I-frame. Rotating in the stale main1 instead
    // makes the P-frame straight-line/average predictions overshoot by up to one
    // I-interval, which then makes every following I-frame look like time went
    // backwards and destroys the main stream (massive frame loss).
    main2 = main0; main1 = main0; main0 = new Array(defI.count).fill(0);
    return true;
  };
  const completeInter = (frame: number[]): boolean => {
    if (
      !mainStreamValid ||
      frame[idxTime] > lastMainFrameTime + MAX_TIME_JUMP_US ||
      frame[idxIter] > lastMainFrameIteration + MAX_ITER_JUMP
    ) { mainStreamValid = false; return false; }
    lastMainFrameIteration = frame[idxIter];
    lastMainFrameTime = frame[idxTime];
    pushSample(frame);
    main2 = main1; main1 = main0; main0 = new Array(defI.count).fill(0);
    return true;
  };

  let pendingType: string | null = null;
  let frameStart = 0;
  let lastDecoded: number[] = [];
  let lastEvent: { type: number; timeUs: number; data: string } | null = null;
  let resumeIter: number | null = null;
  let resumeTime: number | null = null;
  const completeEvent = (): void => {
    if (!lastEvent) return;
    const ev = lastEvent; lastEvent = null;
    if (ev.type === EVT_LOGGING_RESUME) {
      if (resumeIter !== null) lastMainFrameIteration = resumeIter;
      if (resumeTime !== null) lastMainFrameTime = resumeTime;
    }
    const nm = FLIGHT_EVENT_NAMES[ev.type] ?? `Event #${ev.type}`;
    events.push({ timeUs: ev.timeUs, name: nm, data: ev.data || undefined });
  };
  const parseEventPayload = (): { type: number; timeUs: number; data: string } | null => {
    const type = stream.readByte();
    if (type === -1 || stream.eof) return null;
    let timeUs = lastMainFrameTime >= 0 ? lastMainFrameTime : 0;
    let data = '';
    resumeIter = null; resumeTime = null;
    switch (type) {
      case EVT_SYNC_BEEP:
        timeUs = stream.readUnsignedVB(); data = `t=${(timeUs / 1000000).toFixed(2)}s`; break;
      case EVT_INFLIGHT_ADJUSTMENT: {
        const fn = stream.readByte(); const vv = stream.readSignedVB();
        data = `func=${fn} val=${vv}`; break;
      }
      case EVT_LOGGING_RESUME: {
        const li = stream.readUnsignedVB(); const ct = stream.readUnsignedVB();
        resumeIter = li; resumeTime = ct; timeUs = ct;
        data = `iter=${li} t=${(ct / 1000000).toFixed(2)}s`; break;
      }
      case EVT_DISARM: data = `reason=${stream.readUnsignedVB()}`; break;
      case EVT_FLIGHT_MODE: {
        const f = stream.readUnsignedVB(); const lf = stream.readUnsignedVB();
        data = `0x${f.toString(16)} (prev 0x${lf.toString(16)})`; break;
      }
      case EVT_GOVERNOR_STATE: case EVT_RESCUE_STATE: case EVT_AIRBORNE_STATE:
        data = `state=${stream.readUnsignedVB()}`; break;
      case EVT_CUSTOM_DATA: {
        const a = stream.readByte(); const b = stream.readByte();
        if (a !== -1 && b !== -1) data = new TextDecoder().decode(new Uint8Array([a, b])); break;
      }
      case EVT_CUSTOM_STRING: {
        const arr: number[] = [];
        for (let k = 0; k < 64; k++) {
          const ch = stream.readByte();
          if (ch === -1 || ch === 0) break;
          arr.push(ch);
        }
        data = new TextDecoder().decode(new Uint8Array(arr)); break;
      }
      case EVT_LOG_END: data = 'End of log'; break;
      default: data = ''; break;
    }
    if (stream.eof) return null;
    return { type, timeUs, data };
  };
  const finishPending = (nextCmd: string | number): void => {
    if (!pendingType) return;
    const frameSize = stream.pos - frameStart;
    const looksCompleted = nextCmd === -1 || (typeof nextCmd === 'string' && FRAME_CHARS.has(nextCmd));
    if (frameSize <= 256 && looksCompleted) {
      if (pendingType === 'I') completeIntra(lastDecoded);
      else if (pendingType === 'P') completeInter(lastDecoded);
      else if (pendingType === 'E') completeEvent();
    } else {
      mainStreamValid = false;
      stream.pos = frameStart + 1; stream.eof = false;
      pendingType = null; return;
    }
    pendingType = null;
  };

  for (;;) {
    const cmd = stream.readChar();
    if (pendingType) {
      if (cmd !== -1) stream.unread();
      finishPending(cmd);
      if (stream.eof && pendingType === null && cmd === -1) break;
      continue;
    }
    if (cmd === -1) break;
    if (typeof cmd !== 'string' || !FRAME_CHARS.has(cmd)) { mainStreamValid = false; continue; }
    if (cmd === 'I' || cmd === 'P' || cmd === 'S' || cmd === 'G' || cmd === 'H') {
      const def = frameDefs[cmd];
      if (!def) { mainStreamValid = false; continue; }
      frameStart = stream.pos - 1;
      const prev = main1;
      const prev2 = cmd === 'I' ? null : main2;
      const skipped = cmd === 'P' ? countSkipped(lastMainFrameIteration, sys) : 0;
      const ok = decodeFrame(stream, def, main0, prev, prev2, skipped, sys, frameDefs, gpsHome1, main1 ? main1[idxTime] : null);
      if (!ok || stream.eof) {
        mainStreamValid = false; pendingType = null;
        if (stream.eof) break;
        continue;
      }
      lastDecoded = main0.slice();
      if (cmd === 'H') gpsHome1 = main0.slice();
      pendingType = cmd;
    } else if (cmd === 'E') {
      frameStart = stream.pos - 1;
      const ev = parseEventPayload();
      if (!ev) {
        if (stream.eof) break;
        mainStreamValid = false; continue;
      }
      lastEvent = ev; pendingType = 'E';
    }
  }
  if (pendingType) finishPending(-1);
  if (samples.length === 0) return null;
  return { headers, sysConfig: sys, frameDefs, samples, events, hasGyroFilteredField, hasGyroRawField };
}

export function analyzeVibrations(
  log: BlackboxLog,
  config?: HeliConfig,
  window?: { start?: number; end?: number; startSec?: number; endSec?: number }
): VibrationSummary {
  // Optional analysis window: 0 → full log, or the selected FFT segment only
  // Support both { start, end } (UI pattern) and { startSec, endSec } (legacy CLI pattern)
  const winStart = window?.start ?? window?.startSec ?? 0;
  const winEnd = window?.end ?? window?.endSec ?? log.durationSec;
  const n = log.totalFrames;
  const n0 = Math.max(0, Math.min(n - 1, Math.floor(winStart * log.sampleRateHz)));
  const n1 = Math.max(n0 + 1, Math.min(n, Math.ceil(winEnd * log.sampleRateHz)));

  // 1. Calculate RMS vibration
  const calcRms = (data: Float32Array | undefined): number => {
    if (!data || data.length === 0) return 0;
    let sumSq = 0;
    let validCount = 0;
    // Remove DC mean using valid values only
    let sum = 0;
    for (let i = n0; i < n1 && i < data.length; i++) {
      if (Number.isFinite(data[i])) sum += data[i];
    }
    const count = Math.max(1, n1 - n0);
    const mean = sum / count;

    for (let i = n0; i < n1 && i < data.length; i++) {
      if (Number.isFinite(data[i])) {
        const diff = data[i] - mean;
        sumSq += diff * diff;
        validCount++;
      }
    }
    if (validCount === 0) return 0;
    return Math.sqrt(sumSq / validCount);
  };

  const rollRms = calcRms(log.gyro.roll);
  const pitchRms = calcRms(log.gyro.pitch);
  const yawRms = calcRms(log.gyro.yaw);
  const overallGyroRms = Math.sqrt((rollRms * rollRms + pitchRms * pitchRms + yawRms * yawRms) / 3);

  const accXRms = calcRms(log.acc.x);
  const accYRms = calcRms(log.acc.y);
  const accZRms = calcRms(log.acc.z);
  const overallAccRms = Math.sqrt((accXRms * accXRms + accYRms * accYRms + accZRms * accZRms) / 3);

  // Peak gyro rates (within analysis window)
  let maxRoll = 0;
  let maxPitch = 0;
  let maxYaw = 0;
  for (let i = n0; i < n1 && i < log.gyro.roll.length; i++) {
    const r = log.gyro.roll[i];
    if (Number.isFinite(r) && Math.abs(r) > maxRoll) maxRoll = Math.abs(r);
    const p = log.gyro.pitch[i];
    if (Number.isFinite(p) && Math.abs(p) > maxPitch) maxPitch = Math.abs(p);
    const y = log.gyro.yaw[i];
    if (Number.isFinite(y) && Math.abs(y) > maxYaw) maxYaw = Math.abs(y);
  }

  // 2. Estimate Head Speed RPM (within analysis window)
  let detectedHeadSpeedRpm = config?.mainRpm || 2100;
  if (log.rpm && log.rpm.length > 0) {
    // Find average non-zero RPM during flight
    let sumRpm = 0;
    let countRpm = 0;
    for (let i = n0; i < n1; i++) {
      const r = log.rpm[i];
      if (r > 800 && r < 5000) {
        sumRpm += r;
        countRpm++;
      }
    }
    if (countRpm > 50) {
      detectedHeadSpeedRpm = Math.round(sumRpm / countRpm);
    }
  }

  const main1P = detectedHeadSpeedRpm / 60;
  const main2P = main1P * (config?.bladeCount || 2);
  const tailRatio = config?.tailGearRatio || 4.5;
  const tail1P = main1P * tailRatio;
  const motorRatio = (config?.mainGearTeeth || 110) / (config?.motorPinionTeeth || 11);
  const motor1P = main1P * motorRatio;

  // 3. Compute FFT & find dominant peaks (within analysis window)
  const fft = computeMultiAxisFft(log.gyro, log.acc, log.sampleRateHz, n0, n1);
  const peaks = findVibrationPeaks(fft, detectedHeadSpeedRpm, tailRatio);

  // 4. Determine overall vibration grade
  // Helicopter grading standards:
  // Gyro RMS: < 12 deg/s: EXCELLENT, 12-25: GOOD, 25-45: MODERATE, 45-80: WARNING, > 80: CRITICAL
  // Acc RMS: < 0.25G: EXCELLENT, 0.25-0.5G: GOOD, 0.5-1.0G: MODERATE, 1.0-1.8G: WARNING, > 1.8G: CRITICAL
  let overallGrade: VibrationGrade = 'EXCELLENT';
  if (overallGyroRms > 70 || overallAccRms > 1.6) {
    overallGrade = 'CRITICAL';
  } else if (overallGyroRms > 40 || overallAccRms > 0.9) {
    overallGrade = 'WARNING';
  } else if (overallGyroRms > 22 || overallAccRms > 0.45) {
    overallGrade = 'MODERATE';
  } else if (overallGyroRms > 12 || overallAccRms > 0.25) {
    overallGrade = 'GOOD';
  }

  // 5. Automated Rotorflight Diagnostics & Recommendations
  const diagnostics: VibrationSummary['diagnostics'] = [];

  if (overallGrade === 'EXCELLENT') {
    diagnostics.push({
      type: 'success',
      title: '기체 기계적 상태 최상 (Clean Mechanics)',
      description: `자이로 노이즈 RMS(${overallGyroRms.toFixed(1)}°/s) 및 가속도 진동(${overallAccRms.toFixed(2)}G)이 매우 낮습니다. Rotorflight 자이로 필터 지연(D-term lag)을 최소화하여 조종 응답성을 극대화할 수 있습니다.`,
      action: 'D-term 저역통과 필터(LPF) 차단주파수를 높여 반응성 튜닝 추천',
    });
  } else if (overallGrade === 'WARNING' || overallGrade === 'CRITICAL') {
    diagnostics.push({
      type: 'error',
      title: '과도한 진동 감지 (High Vibration Alert)',
      description: `평균 자이로 진동이 ${overallGyroRms.toFixed(1)}°/s로 주의 기준치를 초과했습니다. 비행 중 자이로 오동작 및 모터/서보 발열의 원인이 됩니다.`,
      action: '하단의 주파수 피크와 고조파(Harmonics)를 대조하여 기계적 원인을 점검하세요.',
    });
  }

  // Check specific peaks
  const tailPeak = peaks.find(p => p.freqHz >= tail1P - 15 && p.freqHz <= tail1P + 15);
  if (tailPeak && tailPeak.amplitude > 8) {
    diagnostics.push({
      type: 'warning',
      title: `테일 로터 1P 고주파 진동 검출 (${tailPeak.freqHz} Hz)`,
      description: `헤드스피드 ${detectedHeadSpeedRpm} RPM 기준 테일 기어비(${tailRatio}:1)에 해당하는 약 ${Math.round(tail1P)} Hz 영역에서 강한 요(Yaw) 진동이 감지되었습니다.`,
      action: '1) 테일 블레이드 무게 밸런싱 2) 테일 샤프트 휨 3) 테일 벨트/토크튜브 장력 점검 4) Rotorflight RPM 하모닉 노치 필터 활성화',
    });
  }

  const main1PPeak = peaks.find(p => Math.abs(p.freqHz - main1P) < 5);
  if (main1PPeak && main1PPeak.amplitude > 6) {
    diagnostics.push({
      type: 'warning',
      title: `메인 로터 1P 저주파 진동 검출 (${main1PPeak.freqHz} Hz)`,
      description: `메인 로터 회전 주파수(~${Math.round(main1P)} Hz)와 일치하는 피크입니다. 주로 메인 블레이드 무게 불균형이나 패더링 스핀들 샤프트의 휨에 의해 발생합니다.`,
      action: '메인 블레이드 무게 중심(CG) 및 무게 일치 확인, 스핀들 샤프트 롤러 점검',
    });
  }

  const main2PPeak = peaks.find(p => Math.abs(p.freqHz - main2P) < 6);
  if (main2PPeak && main2PPeak.amplitude > 8) {
    diagnostics.push({
      type: 'info',
      title: `메인 로터 2P 블레이드 트래킹 진동 (${main2PPeak.freqHz} Hz)`,
      description: `블레이드 2개가 번갈아 통과할 때 발생하는 양력 불균형(트래킹 오차)입니다.`,
      action: '호버링 시 블레이드 트래킹 선 일치 여부 확인 및 턴버클 피치로드 미세 조정',
    });
  }

  // Add Rotorflight filter advice
  diagnostics.push({
    type: 'info',
    title: 'Rotorflight 노치 필터 추천 가이드',
    description: `권장 동적 노치(Dynamic Notch) 설정: Min Freq ${Math.round(main1P * 0.9)} Hz, Max Freq ${Math.round(tail1P * 1.5)} Hz, Q=300. RPM 필터 활성화 시 테일 1P(${Math.round(tail1P)} Hz)를 자동 추적합니다.`,
  });

  return {
    gyroRms: {
      roll: Math.round(rollRms * 100) / 100,
      pitch: Math.round(pitchRms * 100) / 100,
      yaw: Math.round(yawRms * 100) / 100,
      overall: Math.round(overallGyroRms * 100) / 100,
    },
    accRms: {
      x: Math.round(accXRms * 1000) / 1000,
      y: Math.round(accYRms * 1000) / 1000,
      z: Math.round(accZRms * 1000) / 1000,
      overall: Math.round(overallAccRms * 1000) / 1000,
    },
    gyroPeak: {
      roll: Math.round(maxRoll * 10) / 10,
      pitch: Math.round(maxPitch * 10) / 10,
      yaw: Math.round(maxYaw * 10) / 10,
    },
    overallGrade,
    detectedHeadSpeedRpm,
    harmonics: {
      main1P: Math.round(main1P * 10) / 10,
      main2P: Math.round(main2P * 10) / 10,
      tail1P: Math.round(tail1P * 10) / 10,
      motor1P: Math.round(motor1P * 10) / 10,
    },
    peaks,
    diagnostics,
  };
}
