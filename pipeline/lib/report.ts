/** Writes a JSON + Markdown report of every run to pipeline/output/. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Summary } from './finalize';
import type { Candidate } from './types';

export interface ReportInput {
  title: string;
  provider: string;
  attribution: string;
  dryRun: boolean;
  runId: string | null;
  summary: Summary;
  candidates: Candidate[];
  notes: string[];
  extra?: Record<string, unknown>;
}

export function writeReport(outDir: string, input: ReportInput): { json: string; markdown: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = join(outDir, `${stamp}-${input.provider}${input.dryRun ? '-dry-run' : ''}`);

  writeFileSync(
    `${base}.json`,
    JSON.stringify({ ...input, generatedAt: new Date().toISOString() }, null, 2),
  );

  const lines: string[] = [];
  lines.push(`# ${input.title}`, '');
  lines.push(`- Provider: \`${input.provider}\` (${input.attribution})`);
  lines.push(`- Mode: ${input.dryRun ? '**dry run** (nothing written to the database)' : `uploaded as run \`${input.runId}\``}`);
  lines.push(`- Candidates: ${input.summary.total} (${Object.entries(input.summary.byKind).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'})`);
  lines.push(`- Quality: ${Object.entries(input.summary.byQuality).map(([k, v]) => `${v} ${k}`).join(', ') || 'n/a'}`);
  lines.push(`- Possible duplicates inside this batch: ${input.summary.duplicatesInBatch}`, '');
  lines.push('All candidates are UNVERIFIED. They appear in the admin review queue and nowhere else.', '');
  if (input.extra) lines.push('```json', JSON.stringify(input.extra, null, 2), '```', '');
  if (Object.keys(input.summary.byIssue).length) {
    lines.push('## Issues', '', '| Issue | Count |', '| --- | --- |');
    for (const [code, count] of Object.entries(input.summary.byIssue).sort((a, b) => b[1] - a[1])) lines.push(`| ${code} | ${count} |`);
    lines.push('');
  }
  const blocked = input.candidates.filter((c) => c.quality === 'blocked');
  if (blocked.length) {
    lines.push('## Blocked (cannot be promoted)', '');
    for (const c of blocked.slice(0, 200)) {
      lines.push(`- \`${c.external_id}\` ${c.name ?? '(no name)'}: ${c.issues.filter((i) => i.severity === 'blocker').map((i) => i.message).join(' ')}`);
    }
    lines.push('');
  }
  if (input.notes.length) lines.push('## Notes', '', ...input.notes.map((n) => `- ${n}`), '');
  writeFileSync(`${base}.md`, lines.join('\n'));
  return { json: `${base}.json`, markdown: `${base}.md` };
}
