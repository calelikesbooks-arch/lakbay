/**
 * LAKBAY data pipeline.
 *
 *   npm run pipeline -- help
 *   npm run pipeline -- areas
 *   npm run pipeline -- osm --dry-run                  (all default areas, no database)
 *   npm run pipeline -- osm --area ph-bulacan-marilao  (upload to the review queue)
 *   npm run pipeline -- csv --file data/survey/my_survey.csv [--provider lgu_records] [--dry-run]
 *   npm run pipeline -- gtfs --provider dotc_ptis_gtfs --dir data/raw/gtfs [--bbox w,s,e,n] [--dry-run]
 *
 * Every candidate lands in the admin review queue as UNVERIFIED.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AREAS, findArea, type ImportAreaConfig } from './config/areas';
import { buildGtfsCandidates } from './importers/gtfs';
import { buildOsmCandidates } from './importers/osm';
import { buildSurveyCandidates } from './importers/survey';
import { contactForUserAgent, overpassUrl } from './lib/env';
import { finalizeCandidates, summarize } from './lib/finalize';
import { sha256 } from './lib/hash';
import { placesQuery, routesQuery, runOverpass } from './lib/overpass';
import { writeReport } from './lib/report';
import type { DraftCandidate } from './lib/types';

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, 'pipeline', 'cache', 'overpass');
const OUT_DIR = join(ROOT, 'pipeline', 'output');
const log = (m: string) => console.log(m);

const HELP = `LAKBAY data pipeline

Commands
  areas                         List configured import areas
  osm   [--area CODE]... [--all-areas] [--dry-run] [--refresh]
                                Import terminals, stops and route relations from
                                OpenStreetMap (Overpass). Default: areas enabled by default.
  csv   --file PATH [--provider CODE] [--dry-run]
                                Import field-survey / official-document rows
                                (template: data/templates/survey_locations.csv)
  gtfs  --provider CODE --dir PATH [--bbox W,S,E,N] [--dry-run]
                                Import an unzipped GTFS feed (provider must be approved)

Settings: .env.pipeline (copy .env.pipeline.example). Reports: pipeline/output/
`;

async function uploadOrReport(opts: {
  title: string;
  provider: string;
  attribution: string;
  runKind: 'osm_overpass' | 'gtfs' | 'csv';
  dryRun: boolean;
  drafts: DraftCandidate[];
  params: Record<string, unknown>;
  snapshotSha256: string | null;
  upstreamTimestamp: string | null;
  notes: string[];
  areas?: { area: ImportAreaConfig; relationId: number | null }[];
  extra?: Record<string, unknown>;
}) {
  const candidates = finalizeCandidates(opts.drafts);
  const summary = summarize(candidates);
  let runId: string | null = null;
  let extra = opts.extra ?? {};

  if (!opts.dryRun) {
    const db = await import('./lib/db');
    const client = await db.connect();
    for (const a of opts.areas ?? []) await db.upsertArea(client, a.area, a.relationId);
    runId = await db.startRun(client, opts.provider, opts.runKind, opts.params, opts.areas?.length === 1 ? opts.areas[0].area.code : null);
    log(`Run ${runId} started.`);
    try {
      const totals = await db.uploadCandidates(client, runId, candidates, log);
      const matched = await db.matchRun(client, runId);
      extra = { ...extra, upload: totals, matched_existing_records: matched };
      await db.finishRun(client, runId, 'completed', { ...summary, ...extra }, opts.snapshotSha256, opts.upstreamTimestamp);
      log(`Run ${runId} completed: ${JSON.stringify(totals)}; ${matched} matched to existing LAKBAY records.`);
    } catch (error) {
      await db.finishRun(client, runId, 'failed', { ...summary }, opts.snapshotSha256, opts.upstreamTimestamp, String(error));
      throw error;
    }
  }

  const files = writeReport(OUT_DIR, {
    title: opts.title,
    provider: opts.provider,
    attribution: opts.attribution,
    dryRun: opts.dryRun,
    runId,
    summary,
    candidates,
    notes: opts.notes,
    extra,
  });
  log('');
  log(`${summary.total} candidates: ${JSON.stringify(summary.byKind)}, quality ${JSON.stringify(summary.byQuality)}`);
  log(`Report: ${files.markdown}`);
  if (opts.dryRun) log('Dry run: nothing was written to the database.');
}

async function commandOsm(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      area: { type: 'string', multiple: true },
      'all-areas': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      refresh: { type: 'boolean', default: false },
    },
  });
  const areas = values.area?.length
    ? values.area.map((code) => {
        const a = findArea(code);
        if (!a) throw new Error(`Unknown area "${code}". Run "npm run pipeline -- areas".`);
        return a;
      })
    : AREAS.filter((a) => values['all-areas'] || a.enabledByDefault);

  const contact = contactForUserAgent();
  const endpoint = overpassUrl();
  const drafts: DraftCandidate[] = [];
  const notes: string[] = [];
  const hashes: string[] = [];
  const areaResults: { area: ImportAreaConfig; relationId: number | null }[] = [];
  let upstream: string | null = null;

  for (const area of areas) {
    log(`\n${area.name}`);
    const fetchOpts = { endpoint, contact, cacheDir: CACHE_DIR, refresh: values.refresh, log };
    const places = await runOverpass(placesQuery(area), fetchOpts);
    const routes = await runOverpass(routesQuery(area), fetchOpts);
    const result = buildOsmCandidates(area, places.data, routes.data);
    log(`  OSM boundary relation ${result.areaRelationId}; ${result.candidates.length} candidates`);
    drafts.push(...result.candidates);
    notes.push(...result.notes.map((n) => `${area.name}: ${n}`));
    hashes.push(places.sha256, routes.sha256);
    areaResults.push({ area, relationId: result.areaRelationId });
    upstream = result.upstreamTimestamp ?? upstream;
  }

  await uploadOrReport({
    title: `OpenStreetMap import: ${areas.map((a) => a.name).join('; ')}`,
    provider: 'openstreetmap_overpass',
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
    runKind: 'osm_overpass',
    dryRun: values['dry-run'],
    drafts,
    params: { area_codes: areas.map((a) => a.code), endpoint },
    snapshotSha256: sha256(hashes.join('')),
    upstreamTimestamp: upstream,
    notes,
    areas: areaResults,
  });
}

async function commandCsv(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      file: { type: 'string' },
      provider: { type: 'string', default: 'lakbay_field_survey' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.file) throw new Error('Give --file path/to/file.csv');
  const text = readFileSync(values.file, 'utf8');
  const { candidates, rejected } = buildSurveyCandidates(text);
  for (const r of rejected) log(`  REJECTED line ${r.line} (${r.record_id || 'no id'}): ${r.reasons.join('; ')}`);
  await uploadOrReport({
    title: `CSV import: ${values.file}`,
    provider: values.provider!,
    attribution: 'See each row\'s source',
    runKind: 'csv',
    dryRun: values['dry-run'],
    drafts: candidates,
    params: { file: values.file },
    snapshotSha256: sha256(text),
    upstreamTimestamp: null,
    notes: rejected.map((r) => `Rejected line ${r.line} (${r.record_id || 'no id'}): ${r.reasons.join('; ')}`),
    extra: { rejected_rows: rejected.length },
  });
}

async function commandGtfs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      provider: { type: 'string' },
      dir: { type: 'string' },
      bbox: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  if (!values.provider || !values.dir) throw new Error('Give --provider CODE and --dir PATH (an unzipped GTFS folder)');
  let bbox: [number, number, number, number] | undefined;
  if (values.bbox) {
    const parts = values.bbox.split(',').map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[0] >= parts[2] || parts[1] >= parts[3]) {
      throw new Error('--bbox must be west,south,east,north');
    }
    bbox = parts as [number, number, number, number];
  }
  const { candidates, notes } = buildGtfsCandidates({ providerCode: values.provider, dir: values.dir, bbox });
  const snapshot = sha256(['stops.txt', 'routes.txt', 'trips.txt'].map((f) => readFileSync(join(values.dir!, f))).join(''));
  await uploadOrReport({
    title: `GTFS import: ${values.provider}`,
    provider: values.provider,
    attribution: 'See the provider entry in the source registry',
    runKind: 'gtfs',
    dryRun: values['dry-run'],
    drafts: candidates,
    params: { dir: values.dir, bbox: bbox ?? null },
    snapshotSha256: snapshot,
    upstreamTimestamp: null,
    notes,
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'areas':
      for (const a of AREAS) log(`${a.enabledByDefault ? '*' : ' '} ${a.code.padEnd(26)} ${a.name}`);
      log('\n* = imported by default');
      break;
    case 'osm':
      await commandOsm(rest);
      break;
    case 'csv':
      await commandCsv(rest);
      break;
    case 'gtfs':
      await commandGtfs(rest);
      break;
    default:
      log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(`\nERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
