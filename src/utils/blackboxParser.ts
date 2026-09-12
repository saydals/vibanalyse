/**
 * Rotorflight Blackbox Log Parser
 * Parses both binary .BBL files and exported .CSV/.TXT logs.
 * Supports multi-log separation and robust recovery for truncated logs.
 */

import { BlackboxLog, FlightEvent, VibrationSummary, HeliConfig, VibrationGrade, RotorflightValidation } from '../types/blackbox';
import { computeMultiAxisFft, findVibrationPeaks } from './fft';

export interface ParseResult {
  logs: BlackboxLog[];
  primaryLogIndex: number;
}

// Variable-byte unsigned integer reader
function readUVarInt(bytes: Uint8Array, offsetObj: { offset: number }): number {
  let result = 0;
  let shift = 0;
  while (offsetObj.offset < bytes.length) {
    const byte = bytes[offsetObj.offset++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
    if (shift >= 32) break;
  }
  return result >>> 0;
}

// Signed zigzag variable-byte integer reader
function readSVarInt(bytes: Uint8Array, offsetObj: { offset: number }): number {
  const u = readUVarInt(bytes, offsetObj);
  return (u & 1) ? -(u >>> 1) - 1 : (u >>> 1);
}

// Rotorflight/BetaFlight event type constants (from flightlog_parser.js)
const FLIGHT_LOG_EVENT = {
    SYNC_BEEP: 0,
    LOGGING_RESUME: 1,
    FLIGHT_MODE: 10,
    LOG_END: 11,
    DISARM: 30,
    INFLIGHT_ADJUSTMENT: 33,
    CUSTOM_DATA: 34,
    CUSTOM_STRING: 35,
    GOVERNOR_STATE: 36,
    RESCUE_STATE: 37,
    AIRBORNE_STATE: 38,
    LOG_END_255: 255,
};

const FLIGHT_EVENT_NAMES: Record<number, string> = {
    [FLIGHT_LOG_EVENT.SYNC_BEEP]: 'Sync Beep',
    [FLIGHT_LOG_EVENT.LOGGING_RESUME]: 'Logging Resume',
    [FLIGHT_LOG_EVENT.FLIGHT_MODE]: 'Flight Mode',
    [FLIGHT_LOG_EVENT.LOG_END]: 'End of Log',
    [FLIGHT_LOG_EVENT.DISARM]: 'Disarm',
    [FLIGHT_LOG_EVENT.INFLIGHT_ADJUSTMENT]: 'In-flight Adjustment',
    [FLIGHT_LOG_EVENT.CUSTOM_DATA]: 'Custom Data',
    [FLIGHT_LOG_EVENT.CUSTOM_STRING]: 'Custom String',
    [FLIGHT_LOG_EVENT.GOVERNOR_STATE]: 'Governor State',
    [FLIGHT_LOG_EVENT.RESCUE_STATE]: 'Rescue State',
    [FLIGHT_LOG_EVENT.AIRBORNE_STATE]: 'Airborne State',
};

/**
 * Parse a Rotorflight/BetaFlight event frame from binary data.
 * Reads the event type and any associated data from the stream.
 * Returns the event name, time in seconds, and whether the log should end.
 */
function parseEventFrame(
    bytes: Uint8Array,
    offsetObj: { offset: number },
    lastMainFrameTimeUs: number
): { name: string; timeSec: number; endOfLog: boolean } | null {
    if (offsetObj.offset >= bytes.length) return null;

    const eventType = bytes[offsetObj.offset++];
    const eventName = FLIGHT_EVENT_NAMES[eventType] || `Event #${eventType}`;

    let timeSec = lastMainFrameTimeUs / 1000000;
    let endOfLog = false;

    switch (eventType) {
        case FLIGHT_LOG_EVENT.SYNC_BEEP: {
            if (offsetObj.offset < bytes.length) {
                const syncTimeUs = readUVarInt(bytes, offsetObj);
                timeSec = syncTimeUs / 1000000;
            }
            break;
        }
        case FLIGHT_LOG_EVENT.LOGGING_RESUME: {
            if (offsetObj.offset < bytes.length) {
                readUVarInt(bytes, offsetObj); // logIteration (skip)
            }
            if (offsetObj.offset < bytes.length) {
                const resumeTimeUs = readUVarInt(bytes, offsetObj);
                timeSec = resumeTimeUs / 1000000;
            }
            break;
        }
        case FLIGHT_LOG_EVENT.LOG_END:
        case FLIGHT_LOG_EVENT.LOG_END_255: {
            endOfLog = true;
            // Read null-terminated end-of-log message string
            while (offsetObj.offset < bytes.length) {
                const ch = bytes[offsetObj.offset++];
                if (ch === 0) break;
            }
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.DISARM: {
            if (offsetObj.offset < bytes.length) {
                readUVarInt(bytes, offsetObj); // disarm reason (skip)
            }
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.FLIGHT_MODE: {
            if (offsetObj.offset < bytes.length) readUVarInt(bytes, offsetObj); // newFlags
            if (offsetObj.offset < bytes.length) readUVarInt(bytes, offsetObj); // lastFlags
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.GOVERNOR_STATE:
        case FLIGHT_LOG_EVENT.RESCUE_STATE:
        case FLIGHT_LOG_EVENT.AIRBORNE_STATE: {
            if (offsetObj.offset < bytes.length) readUVarInt(bytes, offsetObj); // state value
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.INFLIGHT_ADJUSTMENT: {
            if (offsetObj.offset < bytes.length) {
                const tmp = bytes[offsetObj.offset++];
                if (tmp < 128) {
                    if (offsetObj.offset < bytes.length) readUVarInt(bytes, offsetObj); // value
                } else {
                    if (offsetObj.offset < bytes.length) readUVarInt(bytes, offsetObj); // value
                    if (offsetObj.offset + 4 <= bytes.length) offsetObj.offset += 4; // float32
                }
            }
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.CUSTOM_DATA: {
            if (offsetObj.offset < bytes.length) {
                const len = bytes[offsetObj.offset++];
                offsetObj.offset = Math.min(offsetObj.offset + len, bytes.length);
            }
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        case FLIGHT_LOG_EVENT.CUSTOM_STRING: {
            if (offsetObj.offset < bytes.length) {
                const len = bytes[offsetObj.offset++];
                for (let i = 0; i < len && offsetObj.offset < bytes.length; i++) {
                    offsetObj.offset++;
                }
            }
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
        }
        default:
            timeSec = lastMainFrameTimeUs / 1000000;
            break;
    }

    return { name: eventName, timeSec, endOfLog };
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
  headers: Record<string, string>,
  rawHeaders?: string
): RotorflightValidation {
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

  // Check if text (CSV/TXT) or binary (.BBL)
  const isText = checkIfTextLog(uint8);

  if (isText) {
    const textDecoder = new TextDecoder('utf-8');
    const text = textDecoder.decode(uint8);
    const parsedLogs = parseCsvOrTextLog(text, fileName);
    if (parsedLogs.length > 0) {
      return { logs: parsedLogs, primaryLogIndex: 0 };
    }
  }

  // Parse binary BBL
  const parsedLogs = parseBinaryBbl(uint8, fileName);
  if (parsedLogs.length === 0) {
    // If binary parser found 0 frames, try text parse fallback
    const textDecoder = new TextDecoder('utf-8');
    const text = textDecoder.decode(uint8);
    const textFallback = parseCsvOrTextLog(text, fileName);
    if (textFallback.length > 0) {
      return { logs: textFallback, primaryLogIndex: 0 };
    }
    throw new Error('블랙박스 데이터 프레임을 찾을 수 없습니다. 올바른 Rotorflight .BBL 또는 .CSV 파일인지 확인해주세요.');
  }

  return { logs: parsedLogs, primaryLogIndex: 0 };
}

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
  const logs: BlackboxLog[] = [];

  let headerFields: string[] = [];
  let headerMap: Record<string, string> = {};
  let rawHeaders = '';
  let rows: number[][] = [];
  let logIdCounter = 1;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx].trim();
    if (!line) continue;

    if (line.startsWith('H ')) {
      // Header line
      rawHeaders += line + '\n';
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(2, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        headerMap[key] = value;
      }
    } else if (line.includes(',') && !headerFields.length) {
      // Column headers line
      const cols = line.split(',').map(s => s.trim().replace(/"/g, ''));
      if (cols.some(c => c.toLowerCase().includes('time') || c.toLowerCase().includes('loop'))) {
        headerFields = cols;
      }
    } else if (headerFields.length && line.includes(',')) {
      // Data row
      const parts = line.split(',');
      if (parts.length >= headerFields.length - 2) {
        const numRow = new Array(parts.length);
        for (let p = 0; p < parts.length; p++) {
          const val = parseFloat(parts[p]);
          numRow[p] = isNaN(val) ? 0 : val;
        }
        rows.push(numRow);
      }
    }
  }

  if (rows.length > 50 && headerFields.length > 0) {
    headerMap['__rawHeaders__'] = rawHeaders;
    const log = buildLogFromRows(rows, headerFields, headerMap, fileName, logIdCounter);
    logs.push(log);
  }

  return logs;
}

/**
 * Parse Binary .BBL file
 */
export function parseBinaryBbl(bytes: Uint8Array, fileName: string): BlackboxLog[] {
  const logs: BlackboxLog[] = [];
  let offset = 0;
  let logIdCounter = 1;

  while (offset < bytes.length) {
    // Look for next log header starting with "H Product:" or "H "
    const nextLogStart = findHeaderStart(bytes, offset);
    if (nextLogStart === -1) break;

    offset = nextLogStart;
    const { headerMap, headerEndOffset } = parseHeadersFromOffset(bytes, offset);
    offset = headerEndOffset;

    // Field definition for I-frames and P-frames
    const iFieldNames = (headerMap['Field I name'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const pFieldNames = (headerMap['Field P name'] || iFieldNames.join(',')).split(',').map(s => s.trim()).filter(Boolean);

    if (iFieldNames.length === 0) {
      // Advance to avoid infinite loop
      offset++;
      continue;
    }

    const iSigned = (headerMap['Field I signed'] || '').split(',').map(s => s.trim() === '1');
    const pSigned = (headerMap['Field P signed'] || '').split(',').map(s => s.trim() === '1');
    const pPredictors = (headerMap['Field P predictor'] || '').split(',').map(s => parseInt(s.trim(), 10) || 0);

    // Parse frames
    const rows: number[][] = [];
    const events: FlightEvent[] = [];
    let prevFrameValues: number[] = new Array(iFieldNames.length).fill(0);
    let prevPrevValues: number[] = new Array(iFieldNames.length).fill(0);

    const offsetObj = { offset };

    // Track the last main frame timestamp for accurate event timing
    let lastMainFrameTimeUs = 0;

    while (offsetObj.offset < bytes.length) {
      const frameTypeChar = bytes[offsetObj.offset++];
      if (frameTypeChar === 0x49) {
        // 'I' - Intra frame (Full state)
        const frameValues = new Array(iFieldNames.length);
        let valid = true;
        for (let f = 0; f < iFieldNames.length; f++) {
          if (offsetObj.offset >= bytes.length) {
            valid = false;
            break;
          }
          frameValues[f] = iSigned[f] ? readSVarInt(bytes, offsetObj) : readUVarInt(bytes, offsetObj);
        }
        if (valid) {
          rows.push(frameValues);
          prevPrevValues = [...prevFrameValues];
          prevFrameValues = [...frameValues];
          // Time is at field index 1 (FLIGHT_LOG_FIELD_INDEX_TIME)
          if (frameValues.length > 1) {
            lastMainFrameTimeUs = frameValues[1];
          }
        }
      } else if (frameTypeChar === 0x50) {
        // 'P' - Predicted frame (Delta from predictor)
        const frameValues = new Array(pFieldNames.length);
        let valid = true;
        for (let f = 0; f < pFieldNames.length; f++) {
          if (offsetObj.offset >= bytes.length) {
            valid = false;
            break;
          }
          const delta = pSigned[f] ? readSVarInt(bytes, offsetObj) : readUVarInt(bytes, offsetObj);
          const predType = pPredictors[f] || 1;
          let predicted = 0;
          if (predType === 1) {
            predicted = prevFrameValues[f] || 0;
          } else if (predType === 2) {
            // Straight line
            predicted = 2 * (prevFrameValues[f] || 0) - (prevPrevValues[f] || 0);
          } else if (predType === 3) {
            // Average
            predicted = Math.round(((prevFrameValues[f] || 0) + (prevPrevValues[f] || 0)) / 2);
          } else if (predType === 8) {
            predicted = (frameValues[0] || 0) + delta; // motor 0 relative
          } else if (predType === 10) {
            predicted = lastMainFrameTimeUs + delta; // time relative
          } else if (predType === 11) {
            predicted = (frameValues[0] || 0) + delta;
          } else {
            predicted = delta;
          }
          frameValues[f] = predicted;
        }
        if (valid) {
          rows.push(frameValues);
          prevFrameValues = [...frameValues];
          // Update lastMainFrameTimeUs from predicted time frame (time is at index 1)
          if (frameValues.length > 1) {
            lastMainFrameTimeUs = frameValues[1];
          }
        }
      } else if (frameTypeChar === 0x53) {
        // 'S' - Slow frame
        // Skip slow frame bytes (read until high bit is cleared for slow fields or skip fixed block)
        const slowCount = 6;
        for (let sc = 0; sc < slowCount; sc++) {
          if (offsetObj.offset >= bytes.length) break;
          readUVarInt(bytes, offsetObj);
        }
      } else if (frameTypeChar === 0x45) {
        // 'E' - Event frame - use proper parser with correct timestamps
        const result = parseEventFrame(bytes, offsetObj, lastMainFrameTimeUs);
        if (result) {
          events.push({ timeSec: result.timeSec, name: result.name });
          if (result.endOfLog) {
            break; // End of this flight log
          }
        }
      } else if (frameTypeChar === 0x48) {
        // 'H' encountered in stream -> potential start of next log!
        if (bytes[offsetObj.offset] === 0x20) {
          // "H " header for next log, step back 1
          offsetObj.offset--;
          break;
        }
      }
    }

    offset = offsetObj.offset;

    if (rows.length > 100) {
      const log = buildLogFromRows(rows, iFieldNames, headerMap, fileName, logIdCounter++, events);
      logs.push(log);
    }
  }

  return logs;
}

function findHeaderStart(bytes: Uint8Array, startOffset: number): number {
  for (let i = startOffset; i < bytes.length - 10; i++) {
    if (bytes[i] === 0x48 && bytes[i + 1] === 0x20) { // "H "
      return i;
    }
  }
  return -1;
}

function parseHeadersFromOffset(bytes: Uint8Array, startOffset: number): { headerMap: Record<string, string>; headerEndOffset: number } {
  const headerMap: Record<string, string> = {};
  let i = startOffset;
  let rawHeaders = '';

  while (i < bytes.length - 2) {
    if (bytes[i] === 0x48 && bytes[i + 1] === 0x20) {
      // Find newline
      let lineEnd = i + 2;
      while (lineEnd < bytes.length && bytes[lineEnd] !== 0x0a && bytes[lineEnd] !== 0x0d) {
        lineEnd++;
      }
      const lineStr = new TextDecoder('ascii').decode(bytes.subarray(i + 2, lineEnd));
      rawHeaders += lineStr + '\n';
      const colon = lineStr.indexOf(':');
      if (colon > 0) {
        const key = lineStr.substring(0, colon).trim();
        const val = lineStr.substring(colon + 1).trim();
        headerMap[key] = val;
      }
      // Skip newline chars
      i = lineEnd;
      while (i < bytes.length && (bytes[i] === 0x0a || bytes[i] === 0x0d)) {
        i++;
      }
    } else {
      // Header section ended
      break;
    }
  }

  headerMap['__rawHeaders__'] = rawHeaders;
  return { headerMap, headerEndOffset: i };
}

/**
 * Build clean BlackboxLog object from raw row array
 */
function buildLogFromRows(
  rows: number[][],
  fieldNames: string[],
  headers: Record<string, string>,
  fileName: string,
  logId: number,
  events: FlightEvent[] = []
): BlackboxLog {
  const numFrames = rows.length;

  // Find column indices
  const findCol = (namePatterns: string[]): number => {
    for (const pat of namePatterns) {
      const exact = fieldNames.indexOf(pat);
      if (exact !== -1) return exact;
    }
    for (const pat of namePatterns) {
      const idx = fieldNames.findIndex(f => f.toLowerCase().includes(pat.toLowerCase()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const timeCol = findCol(['time', 'time_us', 'time (us)', 'loopIteration']);
  const rollCol = findCol(['gyroADC[0]', 'gyro[0]', 'gyro_roll', 'rollRate']);
  const pitchCol = findCol(['gyroADC[1]', 'gyro[1]', 'gyro_pitch', 'pitchRate']);
  const yawCol = findCol(['gyroADC[2]', 'gyro[2]', 'gyro_yaw', 'yawRate']);

  const accXCol = findCol(['accSmooth[0]', 'accADC[0]', 'acc_x', 'accX']);
  const accYCol = findCol(['accSmooth[1]', 'accADC[1]', 'acc_y', 'accY']);
  const accZCol = findCol(['accSmooth[2]', 'accADC[2]', 'acc_z', 'accZ']);

  const rpmCol = findCol(['rpm', 'eRPM[0]', 'eRPM', 'rotorRpm', 'debug[0]', 'motor[0]']);
  const throttleCol = findCol(['rcCommand[3]', 'throttle', 'motor[0]']);
  const collectiveCol = findCol(['rcCommand[0]', 'pitch_stick', 'collective']);
  const vbatCol = findCol(['vbatLatest', 'vbat', 'voltage']);
  const currentCol = findCol(['amperageLatest', 'amperage', 'current']);

  // Extract arrays
  const timeArray = new Float32Array(numFrames);
  const rollArray = new Float32Array(numFrames);
  const pitchArray = new Float32Array(numFrames);
  const yawArray = new Float32Array(numFrames);

  const accXArray = new Float32Array(numFrames);
  const accYArray = new Float32Array(numFrames);
  const accZArray = new Float32Array(numFrames);

  const rpmArray = rpmCol !== -1 ? new Float32Array(numFrames) : undefined;
  const throttleArray = throttleCol !== -1 ? new Float32Array(numFrames) : undefined;
  const collectiveArray = collectiveCol !== -1 ? new Float32Array(numFrames) : undefined;
  const vbatArray = vbatCol !== -1 ? new Float32Array(numFrames) : undefined;

  // Scale factors
  // Standard gyro scale in cleanflight/rotorflight: 16.4 LSB/deg/s for 2000 dps
  let gyroScale = 1.0;
  if (headers['gyro_scale']) {
    const parsed = parseFloat(headers['gyro_scale']);
    if (!isNaN(parsed) && parsed > 0 && parsed < 10) {
      gyroScale = parsed;
    }
  } else {
    // Check if raw values are huge (>1000)
    let maxAbsGyro = 0;
    for (let r = 0; r < Math.min(100, numFrames); r++) {
      if (rollCol !== -1) maxAbsGyro = Math.max(maxAbsGyro, Math.abs(rows[r][rollCol] || 0));
    }
    if (maxAbsGyro > 500) {
      gyroScale = 1.0 / 16.4; // raw MPU/ICM reading to deg/s
    }
  }

  // Accelerometer scale: 1G is typically 2048 or 4096 LSB
  let acc1G = parseFloat(headers['acc_1G'] || '2048');
  if (isNaN(acc1G) || acc1G <= 0) acc1G = 2048;

  let firstTimeUs = 0;
  if (timeCol !== -1 && numFrames > 0) {
    firstTimeUs = rows[0][timeCol] || 0;
  }

  for (let i = 0; i < numFrames; i++) {
    const row = rows[i];

    // Time calculation (in seconds from start of log)
    if (timeCol !== -1) {
      const rawTime = row[timeCol] || 0;
      timeArray[i] = (rawTime - firstTimeUs) / 1000000;
    } else {
      timeArray[i] = i * 0.0005; // 2kHz assumed if time column missing
    }

    rollArray[i] = (rollCol !== -1 ? (row[rollCol] || 0) : 0) * gyroScale;
    pitchArray[i] = (pitchCol !== -1 ? (row[pitchCol] || 0) : 0) * gyroScale;
    yawArray[i] = (yawCol !== -1 ? (row[yawCol] || 0) : 0) * gyroScale;

    accXArray[i] = (accXCol !== -1 ? (row[accXCol] || 0) : 0) / acc1G;
    accYArray[i] = (accYCol !== -1 ? (row[accYCol] || 0) : 0) / acc1G;
    accZArray[i] = (accZCol !== -1 ? (row[accZCol] || 0) : 0) / acc1G;

    if (rpmArray && rpmCol !== -1) {
      let r = row[rpmCol] || 0;
      // If eRPM, Rotorflight logs electrical RPM (eRPM = motor poles/2 * motor RPM). Or direct head RPM.
      if (r > 100000) r = r / 100; // scaling check
      rpmArray[i] = r;
    }

    if (throttleArray && throttleCol !== -1) {
      const thr = row[throttleCol] || 0;
      // standard throttle 1000 to 2000
      throttleArray[i] = thr > 900 ? ((thr - 1000) / 10) : thr;
    }

    if (collectiveArray && collectiveCol !== -1) {
      collectiveArray[i] = row[collectiveCol] || 0;
    }

    if (vbatArray && vbatCol !== -1) {
      const vb = row[vbatCol] || 0;
      vbatArray[i] = vb > 100 ? vb / 100 : vb;
    }
  }

  const durationSec = timeArray[numFrames - 1] - timeArray[0] || (numFrames / 2000);
  const sampleRateHz = durationSec > 0 ? Math.round(numFrames / durationSec) : 2000;
  const looptimeUs = headers['looptime'] ? parseInt(headers['looptime'], 10) : Math.round(1000000 / sampleRateHz);

  const rotorflightValidation = validateRotorflightLog(fieldNames, headers, headers['__rawHeaders__']);

  return {
    id: logId,
    filename: `${fileName} (로그 #${logId})`,
    firmwareType: headers['Firmware type'] || headers['firmwareType'] || (rotorflightValidation.isRotorflight ? 'Rotorflight' : 'Betaflight / 멀티로터 드론'),
    firmwareVersion: headers['Firmware revision'] || headers['Firmware date'] || (rotorflightValidation.isRotorflight ? 'Rotorflight' : 'Non-Rotorflight'),
    craftName: headers['craftName'] || (rotorflightValidation.isRotorflight ? 'RC Helicopter' : 'Multirotor Drone'),
    looptimeUs,
    sampleRateHz: isFinite(sampleRateHz) && sampleRateHz > 0 ? sampleRateHz : 2000,
    durationSec: Math.max(0.1, durationSec),
    totalFrames: numFrames,
    headers,
    fieldNames,
    time: timeArray,
    gyro: {
      roll: rollArray,
      pitch: pitchArray,
      yaw: yawArray,
    },
    acc: {
      x: accXArray,
      y: accYArray,
      z: accZArray,
    },
    rpm: rpmArray,
    throttle: throttleArray,
    collective: collectiveArray,
    vbat: vbatArray,
    events,
    rotorflightValidation,
  };
}

/**
 * Compute thorough Vibration Analytics Summary & Diagnostics
 */
export function analyzeVibrations(log: BlackboxLog, config?: HeliConfig): VibrationSummary {
  // 1. Calculate RMS vibration
  const calcRms = (data: Float32Array): number => {
    let sumSq = 0;
    // Remove DC mean
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const mean = sum / data.length;

    for (let i = 0; i < data.length; i++) {
      const diff = data[i] - mean;
      sumSq += diff * diff;
    }
    return Math.sqrt(sumSq / data.length);
  };

  const rollRms = calcRms(log.gyro.roll);
  const pitchRms = calcRms(log.gyro.pitch);
  const yawRms = calcRms(log.gyro.yaw);
  const overallGyroRms = Math.sqrt((rollRms * rollRms + pitchRms * pitchRms + yawRms * yawRms) / 3);

  const accXRms = calcRms(log.acc.x);
  const accYRms = calcRms(log.acc.y);
  const accZRms = calcRms(log.acc.z);
  const overallAccRms = Math.sqrt((accXRms * accXRms + accYRms * accYRms + accZRms * accZRms) / 3);

  // Peak gyro rates
  let maxRoll = 0;
  let maxPitch = 0;
  let maxYaw = 0;
  for (let i = 0; i < log.gyro.roll.length; i++) {
    if (Math.abs(log.gyro.roll[i]) > maxRoll) maxRoll = Math.abs(log.gyro.roll[i]);
    if (Math.abs(log.gyro.pitch[i]) > maxPitch) maxPitch = Math.abs(log.gyro.pitch[i]);
    if (Math.abs(log.gyro.yaw[i]) > maxYaw) maxYaw = Math.abs(log.gyro.yaw[i]);
  }

  // 2. Estimate Head Speed RPM
  let detectedHeadSpeedRpm = config?.mainRpm || 2100;
  if (log.rpm && log.rpm.length > 0) {
    // Find average non-zero RPM during flight
    let sumRpm = 0;
    let countRpm = 0;
    for (let i = 0; i < log.rpm.length; i++) {
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

  // 3. Compute FFT & find dominant peaks
  const fft = computeMultiAxisFft(log.gyro, log.acc, log.sampleRateHz);
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
