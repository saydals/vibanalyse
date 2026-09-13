/**
 * Real Rotorflight blackbox sample logs (served from /samples in public/).
 * Replaces the old synthetic sampleData generator — these are genuine
 * Rotorflight 4.5/4.6 flight recorder files from the log-sample directory.
 */

import { BlackboxLog } from '../types/blackbox';
import { parseBlackboxFile } from './blackboxParser';

export interface RealSample {
  id: string;
  file: string;
  title: string;
  craft: string;
  tag: string;
  accent: 'emerald' | 'amber' | 'rose' | 'cyan';
  meta: string;
  description: string;
}

export const REAL_SAMPLES: RealSample[] = [
  {
    id: 'default',
    file: 'sample.bbl',
    title: 'Sample',
    craft: 'Rotorflight Sample',
    tag: '기본 샘플',
    accent: 'cyan',
    meta: '기본 제공 샘플 로그',
    description: '기본 샘플 BBL 파일입니다.',
  },
];

export const DEFAULT_SAMPLE: RealSample = REAL_SAMPLES[0];

/** Resolve a sample file to a URL relative to the app base path (/vibanalyse/). */
export function sampleUrl(file: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}samples/${file}`;
}

/** Fetch + parse a bundled real .bbl sample with the real parser. */
export async function fetchSampleLogs(sample: RealSample): Promise<BlackboxLog[]> {
  const url = sampleUrl(sample.file);
  console.log('[fetchSampleLogs] URL:', url);
  const res = await fetch(url);
  console.log('[fetchSampleLogs] Status:', res.status);
  if (!res.ok) throw new Error(`샘플 로그 다운로드 실패 (HTTP ${res.status})`);
  const buf = await res.arrayBuffer();
  console.log('[fetchSampleLogs] Buffer size:', buf.byteLength);
  const result = await parseBlackboxFile(buf, sample.file);
  console.log('[fetchSampleLogs] Parsed logs:', result.logs.length);
  if (result.logs.length === 0) throw new Error('샘플 로그에서 유효한 비행 데이터를 찾을 수 없습니다.');
  return result.logs;
}
