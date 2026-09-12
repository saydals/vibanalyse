/**
 * Parser verification script: run against real .bbl files in log-sample/
 * Usage: node_modules/.bin/tsx scripts/test-parse.ts <file.bbl> [...]
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseBlackboxFile } from '../src/utils/blackboxParser';

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: tsx scripts/test-parse.ts <file.bbl> [...]');
    process.exit(1);
  }
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.join('/home/betaflight/vibanalyse/log-sample', f);
    const buf = fs.readFileSync(abs);
    console.log(`\n=== ${path.basename(abs)} (${(buf.length / 1e6).toFixed(1)} MB) ===`);
    try {
      const t0 = Date.now();
      const result = await parseBlackboxFile(new File([buf], abs), path.basename(abs));
      const dt = Date.now() - t0;
      console.log(`parsed ${result.logs.length} log(s) in ${dt} ms`);
      for (const log of result.logs) {
        console.log({
          craftName: log.craftName,
          firmware: `${log.firmwareType} ${log.firmwareVersion}`,
          sampleRateHz: log.sampleRateHz,
          durationSec: Number(log.durationSec.toFixed(2)),
          totalFrames: log.totalFrames,
          looptimeUs: log.looptimeUs,
          isRotorflight: log.rotorflightValidation.isRotorflight,
          reasons: log.rotorflightValidation.reasons,
        });
        // gyro sanity
        const t0s = log.time[0], t1s = log.time[log.totalFrames - 1];
        console.log(`time[0]=${t0s.toFixed(3)}, time[last]=${t1s.toFixed(3)}`);
        const slice = (a: Float32Array | undefined) => a ? Array.from(a.slice(0, 5)).map(v => +v.toFixed(3)).join(',') : '(none)';
        const stat = (a?: Float32Array) => {
          if (!a) return '(undefined)';
          let mn = Infinity, mx = -Infinity, nz = 0;
          for (let i = 0; i < a.length; i++) { if (a[i] < mn) mn = a[i]; if (a[i] > mx) mx = a[i]; if (a[i] !== 0) nz++; }
          return `min=${mn.toFixed(1)} max=${mx.toFixed(1)} nonzero=${nz}/${a.length}`;
        };
        console.log(`gyro.roll  : ${stat(log.gyro.roll)}`);
        console.log(`gyro.pitch : ${stat(log.gyro.pitch)}`);
        console.log(`gyro.yaw   : ${stat(log.gyro.yaw)}`);
        console.log(`acc.x      : ${stat(log.acc.x)}`);
        console.log(`acc.y      : ${stat(log.acc.y)}`);
        console.log(`acc.z      : ${stat(log.acc.z)}`);
        console.log(`rpm        : ${stat(log.rpm)}`);
        console.log(`tailRpm    : ${stat(log.tailRpm)}`);
        console.log(`throttle   : ${stat(log.throttle)}`);
        console.log(`vbat       : ${stat(log.vbat)}`);
        console.log(`events     : ${log.events.length}`);
        // frame interval stats
        let dts: number[] = [];
        for (let i = 1; i < Math.min(2000, log.totalFrames); i++) dts.push(log.time[i] - log.time[i - 1]);
        dts.sort((a, b) => a - b);
        console.log(`dt median=${dts[Math.floor(dts.length / 2)].toFixed(4)}s p5=${dts[Math.floor(dts.length * 0.05)].toFixed(4)} p95=${dts[Math.floor(dts.length * 0.95)].toFixed(4)}`);
        // NaN scan
        let nanCount = 0;
        for (let i = 0; i < log.totalFrames; i++) {
          if (!isFinite(log.gyro.roll[i]) || !isFinite(log.gyro.pitch[i]) || !isFinite(log.gyro.yaw[i])) nanCount++;
        }
        console.log(`NaN gyro frames: ${nanCount}/${log.totalFrames}`);
      }
    } catch (e: any) {
      console.error('PARSE ERROR:', e && (e.stack || e.message || e));
    }
  }
}
main();
