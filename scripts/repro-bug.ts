/**
 * Regression test for the window parameter naming bug.
 * Demonstrates that both { start, end } (UI) and { startSec, endSec } (legacy CLI)
 * calling patterns produce identical correct results after the fix in analyzeVibrations.
 * Usage: node_modules/.bin/tsx scripts/repro-bug.ts <file.bbl>
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseBlackboxFile, analyzeVibrations } from '../src/utils/blackboxParser';

const DEFAULT_FILE = 'Specter700V2_20260510_110556.bbl';

async function main() {
  const file = process.argv[2] || DEFAULT_FILE;
  const abs = path.isAbsolute(file) ? file : path.join('/home/betaflight/vibanalyse/public/samples', file);
  const buf = fs.readFileSync(abs);
  const r = await parseBlackboxFile(new File([buf], abs), file);
  const log = r.logs[0];

  const config = { mainRpm: 2300, tailGearRatio: 4.45, motorPinionTeeth: 11, mainGearTeeth: 110, motorKv: 1100, batteryCells: 6, bladeCount: 2 };

  // CASE A: { start, end } — the UI pattern (App.tsx way)
  const windowA = { start: 0, end: Math.min(30, log.durationSec) };
  const resultA = analyzeVibrations(log, config, windowA);

  // CASE B: { startSec, endSec } — the legacy CLI script pattern (test-analyze.ts way)
  const windowB = { startSec: 0, endSec: Math.min(30, log.durationSec) };
  const resultB = analyzeVibrations(log, config, windowB);

  console.log(`=== Regression Test: ${file} ===`);
  console.log(`Log: dur=${log.durationSec.toFixed(1)}s, frames=${log.totalFrames}, rate=${log.sampleRateHz}Hz`);
  console.log('');
  console.log('CASE A { start: 0, end: 30 } (UI pattern):');
  console.log(`  gyroRms.overall = ${resultA.gyroRms.overall}`);
  console.log(`  accRms.overall  = ${resultA.accRms.overall}`);
  console.log(`  rpm detected    = ${resultA.detectedHeadSpeedRpm}`);
  console.log(`  peaks           = ${resultA.peaks.length}`);
  console.log(`  grade           = ${resultA.overallGrade}`);
  console.log('');
  console.log('CASE B { startSec: 0, endSec: 30 } (legacy CLI pattern):');
  console.log(`  gyroRms.overall = ${resultB.gyroRms.overall}`);
  console.log(`  accRms.overall  = ${resultB.accRms.overall}`);
  console.log(`  rpm detected    = ${resultB.detectedHeadSpeedRpm}`);
  console.log(`  peaks           = ${resultB.peaks.length}`);
  console.log(`  grade           = ${resultB.overallGrade}`);
  console.log('');

  const matchA = resultA.gyroRms.overall === resultB.gyroRms.overall &&
                 resultA.accRms.overall === resultB.accRms.overall &&
                 resultA.detectedHeadSpeedRpm === resultB.detectedHeadSpeedRpm &&
                 resultA.peaks.length === resultB.peaks.length;
  console.log(`두 패턴 결과 일치: ${matchA ? '✅ PASS' : '❌ FAIL'}`);

  if (resultA.gyroRms.overall === 0 && resultA.accRms.overall === 0) {
    console.log('❌ BUG STILL PRESENT: All vibration values are 0!');
    process.exit(1);
  } else {
    console.log('✅ BUG FIXED: Vibration analysis returns real values.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
