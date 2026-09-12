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
    id: 'blade230s',
    file: 'Blade_230S_M2_20260812_142244.bbl',
    title: 'Blade 230S M2',
    craft: 'Blade 230S',
    tag: '정상 / 클린 비행',
    accent: 'emerald',
    meta: 'Rotorflight 4.6 · 994Hz · 47초',
    description: '컴팩트 플라이바 헬리. 헤드스피드/테일 RPM 모두 기록된 깨끗한 비행 로그.',
  },
  {
    id: 'specter700',
    file: 'Specter700V2_20260510_110556.bbl',
    title: 'Specter 700 V2',
    craft: 'Goblin Specter 700',
    tag: '장시간 비행',
    accent: 'cyan',
    meta: 'Rotorflight 4.6 · 504Hz · 262초',
    description: '262초 분량의 긴 비행. 스풀업/호버링/비행중 구간 선택 데모에 적합.',
  },
  {
    id: 'trex450',
    file: 'Trex_450_FlyWing_20260409_085338.bbl',
    title: 'Trex 450 FlyWing',
    craft: 'Align T-Rex 450',
    tag: '비행 중 진동 확인',
    accent: 'amber',
    meta: 'Rotorflight 4.6 · 981Hz · 219초',
    description: '450급 플라이바. 자이로/가속도/헤드스피드가 모두 기록된 실전 로그.',
  },
  {
    id: 'rtflblackbox',
    file: 'RTFL_BLACKBOX_LOG_20260815_192644.BBL',
    title: 'Rotorflight Blackbox',
    craft: 'Rotorflight BBL',
    tag: '실전 블랙박스 로그',
    accent: 'rose',
    meta: 'Rotorflight 4.5 · 995Hz · 357초',
    description: '실전 비행에서 기록된 정품 Rotorflight BBL 로그. 완전한 데이터 세트 포함.',
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
