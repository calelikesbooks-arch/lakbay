/** Final step shared by every importer: dedupe → validate → quality → hash. */
import { findBatchDuplicates, type DedupeOptions } from './dedupe';
import { contentHash } from './hash';
import { qualityOf, validateCandidate } from './validate';
import type { Candidate, DraftCandidate } from './types';

export function finalizeCandidates(drafts: DraftCandidate[], now = new Date(), dedupe?: DedupeOptions): Candidate[] {
  // Same object found twice (e.g. as a stop of a route from another area AND
  // as a place inside its own area): keep the copy that knows its area.
  const byId = new Map<string, DraftCandidate>();
  const rank = (d: DraftCandidate) => (d.area_code ? 2 : d.municipality ? 1 : 0);
  for (const d of drafts) {
    const existing = byId.get(d.external_id);
    if (!existing || rank(d) > rank(existing)) byId.set(d.external_id, d);
  }
  const unique = [...byId.values()];

  const duplicates = findBatchDuplicates(unique as (DraftCandidate & { attributes: { priority?: number } })[], dedupe);

  const finalized = unique.map((d): Candidate => {
    const duplicateOf = duplicates.get(d.external_id) ?? null;
    const issues = validateCandidate(d, now);
    if (duplicateOf) {
      issues.push({
        code: 'possible_duplicate_in_batch',
        severity: 'warning',
        message: `Probably the same place as ${duplicateOf}. Usually reject this one and review the other.`,
      });
    }
    return {
      ...d,
      issues,
      quality: qualityOf(issues),
      content_hash: contentHash(d),
      batch_duplicate_of: duplicateOf,
    };
  });

  // Representatives first, so duplicate pointers resolve during upload.
  return finalized.sort((a, b) => Number(!!a.batch_duplicate_of) - Number(!!b.batch_duplicate_of));
}

export interface Summary {
  total: number;
  byKind: Record<string, number>;
  byQuality: Record<string, number>;
  byIssue: Record<string, number>;
  duplicatesInBatch: number;
}

export function summarize(candidates: Candidate[]): Summary {
  const count = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});
  return {
    total: candidates.length,
    byKind: count(candidates.map((c) => c.kind)),
    byQuality: count(candidates.map((c) => c.quality)),
    byIssue: count(candidates.flatMap((c) => c.issues.map((i) => i.code))),
    duplicatesInBatch: candidates.filter((c) => c.batch_duplicate_of).length,
  };
}
