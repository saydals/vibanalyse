/**
 * Vibration analysis smoke test: parse + windowed analyzeVibrations
 * Usage: node_modules/.bin/tsx scripts/test-analyze.ts <file.bbl>
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseBlackboxFile, analyzeVibrations, MIN_ANALYSIS_SEC } from '../src/utils/blackboxParser';

const MIN_SEC = typeof MIN_ANALYSIS_SEC === 'number' ? MIN_ANALYSIS_SEC : 30;

function quickWindows(dur: number) {
  const spoolUp = dur >= 30 ? { start: 0, end: Math.min(30, dur) } : null;
  const inFlight = !spoolUp ? null : dur >= 60 ? { start: 30, end: dur - 30 } : { start: 20, end: dur - 10 };
  return { spoolUp, inFlight };
}

async function main() {
  const files = process.argv.slice(2);
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join('/home/betaflight/vibanalyse/public/samples', f);
    const buf = fs.readFileSync(abs);
    console.log(`\n=== ${path.basename(abs)} ===`);
    const r = await parseBlackboxFile(new File([buf], abs), path.basename(abs));
    const log = r.logs[0];
    console.log(`dur=${log.durationSec.toFixed(1)}s frames=${log.totalFrames} rate=${log.sampleRateHz}Hz`);
    const { spoolUp, inFlight } = quickWindows(log.durationSec);
    console.log(`spoolUp: ${spoolUp ? `${spoolUp.start}~${spoolUp.end.toFixed(1)}s` : 'not analyzable (< 30s)'}`);
    console.log(`inFlight: ${inFlight ? `${inFlight.start}~${inFlight.end.toFixed(1)}s (${(inFlight.end - inFlight.start).toFixed(1)}s)` : 'not analyzable'}`);

    for (const [name, w] of [['all', undefined] as const, ['spool-up', spoolUp] as const, ['in-flight', inFlight] as const]) {
      if (name !== 'all' && !w) continue;
      const s = analyzeVibrations(log, { mainRpm: 2300, tailGearRatio: 4.45, motorPinionTeeth: 11, mainGearTeeth: 110, motorKv: 1100, batteryCells: 6, bladeCount: 2 }, w);
      console.log(`[${name}] grade=${s.overallGrade} gyroRms=${s.gyroRms.overall} accRms=${s.accRms.overall} rpm=${s.detectedHeadSpeedRpm} harmonics=${s.harmonics.main1P}/${s.harmonics.main2P}/${s.harmonics.tail1P.toFixed(1)} peaks=${s.peaks.length} diag=${s.diagnostics.length}`);
      for (const p of s.peaks.slice(0, 3)) console.log(`   peak: ${p.axis} ${p.freqHz}Hz amp=${p.amplitude} — ${p.probableSource.slice(0, 60)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
