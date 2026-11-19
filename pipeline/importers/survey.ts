/**
 * Field survey / official document CSV importer.
 * Template: data/templates/survey_locations.csv
 *
 * Rules (rows that break them are REJECTED, not guessed):
 *  - real coordinates (lon, lat) measured in the field or printed in the document
 *  - a name as used on signs/locally
 *  - a source: type, title, and the date observed (survey) or published (document)
 */
import { inPhilippines } from '../lib/geo';
import { parseCsvObjects } from '../lib/csv';
import { cleanName, splitList } from '../lib/text';
import { emptyDraft, MODE_CODES, STOP_KINDS, TERMINAL_KINDS, type DraftCandidate } from '../lib/types';

export interface RejectedRow {
  line: number;
  record_id: string;
  reasons: string[];
}

const SOURCE_TYPES = ['field_survey', 'official_document', 'operator'] as const;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function buildSurveyCandidates(csvText: string, today = new Date()): { candidates: DraftCandidate[]; rejected: RejectedRow[] } {
  const rows = parseCsvObjects(csvText);
  const candidates: DraftCandidate[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  const todayIso = today.toISOString().slice(0, 10);

  rows.forEach((r, index) => {
    const line = index + 2; // header is line 1
    const reasons: string[] = [];
    const recordId = r.record_id ?? '';
    const kind = r.kind;
    const lon = r.lon === '' || r.lon === undefined ? NaN : Number(r.lon);
    const lat = r.lat === '' || r.lat === undefined ? NaN : Number(r.lat);

    // Template rows contain made-up values and must never be imported.
    if (/^EXAMPLE/i.test(recordId)) reasons.push('EXAMPLE row from the template: replace it with real surveyed data');
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(recordId)) reasons.push('record_id must be 2-60 letters, digits, - or _');
    else if (seen.has(recordId)) reasons.push('record_id is used twice in this file');
    if (kind !== 'terminal' && kind !== 'stop') reasons.push('kind must be "terminal" or "stop"');
    if (!cleanName(r.name)) reasons.push('name is required (never invented)');
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) reasons.push('lon and lat are required (never invented)');
    else if (!inPhilippines(lon, lat)) reasons.push(inPhilippines(lat, lon) ? 'lon/lat look swapped' : 'coordinates are outside the Philippines');

    const classification = r.classification || (kind === 'terminal' ? 'terminal' : 'designated_stop');
    const allowed: readonly string[] = kind === 'terminal' ? TERMINAL_KINDS : STOP_KINDS;
    if (kind && !allowed.includes(classification)) reasons.push(`classification "${classification}" is not valid for ${kind}`);

    const modes = splitList(r.mode_codes);
    const badModes = modes.filter((m) => !(MODE_CODES as readonly string[]).includes(m));
    if (badModes.length) reasons.push(`unknown mode codes: ${badModes.join(', ')}`);

    if (!cleanName(r.municipality) || !cleanName(r.province)) reasons.push('municipality and province are required');

    const sourceType = r.source_type;
    if (!(SOURCE_TYPES as readonly string[]).includes(sourceType)) reasons.push('source_type must be field_survey, official_document or operator');
    if (!cleanName(r.source_title)) reasons.push('source_title is required');
    if (r.source_url && !/^https?:\/\//.test(r.source_url)) reasons.push('source_url must start with http(s)://');
    const observed = r.observed_on ?? '';
    const published = r.published_on ?? '';
    if (!observed && !published) reasons.push('observed_on (survey) or published_on (document) is required');
    for (const [label, value] of [['observed_on', observed], ['published_on', published]] as const) {
      if (value && !isDate(value)) reasons.push(`${label} must be YYYY-MM-DD`);
      else if (value && value > todayIso) reasons.push(`${label} cannot be in the future`);
    }
    if (sourceType === 'field_survey' && !cleanName(r.observer)) reasons.push('observer is required for field surveys');

    if (reasons.length) {
      rejected.push({ line, record_id: recordId, reasons });
      return;
    }
    seen.add(recordId);
    candidates.push(
      emptyDraft({
        external_id: `survey:${recordId}`,
        // The document/page URL (if any): rows citing the same URL share one source record.
        external_url: r.source_url || null,
        kind: kind as 'terminal' | 'stop',
        classification,
        name: cleanName(r.name),
        alt_names: splitList(r.alt_names),
        mode_hints: modes,
        mode_confidence: modes.length ? 'tagged' : 'unknown',
        municipality: cleanName(r.municipality),
        province: cleanName(r.province),
        lon,
        lat,
        raw_tags: Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')),
        attributes: {
          priority: 3,
          landmark: cleanName(r.landmark),
          notes: cleanName(r.notes),
          source: {
            type: sourceType,
            title: cleanName(r.source_title),
            url: r.source_url || null,
            document_number: cleanName(r.document_number),
            observed_on: observed || null,
            published_on: published || null,
            observer: cleanName(r.observer),
          },
        },
        upstream_timestamp: (observed || published) ? `${observed || published}T00:00:00+08:00` : null,
      }),
    );
  });

  return { candidates, rejected };
}
