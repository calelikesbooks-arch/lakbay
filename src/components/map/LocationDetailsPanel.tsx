import { useEffect, useState } from 'react';
import { formatDate } from '../../lib/format';
import {
  fetchLocationDetail,
  fetchRoutesServing,
  toVerification,
  type LocationDetail,
  type ServingRoute,
} from '../../lib/map/data';
import { modeColor } from '../../lib/map/modes';
import type { LoadState } from '../../types';
import { EvidencePanel } from '../evidence/EvidencePanel';
import { VerificationBadge } from '../evidence/VerificationBadge';
import { Signboard } from '../route/Signboard';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { MapModeChip } from './MapModeChip';
import type { Selection } from './types';

interface LocationDetailsPanelProps {
  selection: Selection;
  activeVariantId: string | null;
  routeLoadingId: string | null;
  routeMessage: string | null;
  onClose: () => void;
  onToggleRoute: (route: ServingRoute) => void;
  onSetOrigin: () => void;
  onSetDestination: () => void;
}

const subtypeLabel: Record<string, string> = {
  terminal: 'Terminal',
  transport_hub: 'Transport hub',
  rail_station: 'Rail station',
  loading_bay: 'Loading bay',
  designated_stop: 'Designated stop',
  loading_area: 'Loading area',
  terminal_bay: 'Terminal bay',
  informal_stop: 'Informal stop',
};

const directionLabel: Record<string, string> = {
  outbound: 'Outbound',
  inbound: 'Inbound',
  loop: 'Loop',
  bidirectional: 'Both directions',
};

/** Details for a selected terminal or stop: info, routes, sources. */
export function LocationDetailsPanel(props: LocationDetailsPanelProps) {
  const { selection } = props;
  const [detail, setDetail] = useState<LoadState<LocationDetail | null>>({ status: 'loading' });
  const [routes, setRoutes] = useState<LoadState<ServingRoute[]>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setDetail({ status: 'loading' });
    setRoutes({ status: 'loading' });
    fetchLocationDetail(selection.kind, selection.id).then((r) => {
      if (!cancelled) setDetail(r.ok ? { status: 'success', data: r.data } : { status: 'error', message: r.message });
    });
    fetchRoutesServing(selection.kind, selection.id).then((r) => {
      if (!cancelled) setRoutes(r.ok ? { status: 'success', data: r.data } : { status: 'error', message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [selection.kind, selection.id]);

  const d = detail.status === 'success' ? detail.data : null;

  return (
    <aside
      aria-label={`${selection.kind === 'terminal' ? 'Terminal' : 'Stop'} details`}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[70%] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-4 shadow-2xl animate-sheet md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:max-h-none md:w-96 md:rounded-3xl md:border"
    >
      <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line md:hidden" aria-hidden="true" />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-wider text-muted uppercase">
            {d ? subtypeLabel[d.subtype] ?? d.subtype : selection.kind === 'terminal' ? 'Terminal' : 'Stop'}
          </p>
          <h2 className="mt-0.5 text-lg font-extrabold leading-tight">{d?.name ?? selection.name}</h2>
          {d && (
            <p className="mt-0.5 text-sm text-muted">
              {d.municipality}, {d.province}
            </p>
          )}
        </div>
        <button type="button" onClick={props.onClose} aria-label="Close details" className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-surface-2">
          <Icon name="x" className="size-5" />
        </button>
      </header>

      {detail.status === 'loading' && (
        <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
          <Spinner className="size-5" /> Loading details…
        </div>
      )}
      {detail.status === 'error' && <p role="alert" className="py-4 text-sm text-red-700 dark:text-red-300">{detail.message}</p>}
      {detail.status === 'success' && !d && (
        <p className="py-4 text-sm text-muted">This location is no longer available. It may have been retired or is not verified.</p>
      )}

      {d && (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <VerificationBadge verification={toVerification(d.status, d.lastVerifiedOn)} showDate />
            {d.nextReviewOn && <span className="text-xs text-muted">Next check {formatDate(d.nextReviewOn)}</span>}
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={props.onSetOrigin}>
              <span className="size-2.5 rounded-full border-2 border-brand-500" aria-hidden="true" /> Start here
            </Button>
            <Button size="sm" variant="secondary" className="flex-1" onClick={props.onSetDestination}>
              <Icon name="pin" className="size-4 text-sun-500" /> Go here
            </Button>
          </div>

          <dl className="space-y-1.5 text-sm">
            {d.altNames.length > 0 && <Row label="Also called" value={d.altNames.join(', ')} />}
            {d.address && <Row label="Address" value={d.address} />}
            {d.landmark && <Row label="Landmark" value={d.landmark} />}
            {d.operatingHours && <Row label="Hours" value={d.operatingHours} />}
          </dl>
          {d.notes && <p className="text-sm text-ink/85">{d.notes}</p>}

          <section aria-labelledby="serving-heading">
            <h3 id="serving-heading" className="mb-2 text-xs font-bold tracking-wider text-muted uppercase">
              Routes here
            </h3>
            {routes.status === 'loading' && <p className="text-sm text-muted">Loading routes…</p>}
            {routes.status === 'error' && <p className="text-sm text-red-700 dark:text-red-300">{routes.message}</p>}
            {routes.status === 'success' && routes.data.length === 0 && (
              <p className="rounded-2xl bg-surface-2 p-3 text-sm text-muted">No verified routes are linked to this location yet.</p>
            )}
            {routes.status === 'success' && routes.data.length > 0 && (
              <ul className="space-y-2">
                {routes.data.map((route) => {
                  const active = props.activeVariantId === route.variantId;
                  const loading = props.routeLoadingId === route.variantId;
                  return (
                    <li
                      key={route.variantId}
                      className="rounded-2xl border border-line p-3"
                      style={{ borderLeftWidth: 4, borderLeftColor: modeColor(route.modeCode) }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <MapModeChip code={route.modeCode} label={route.modeLabel} />
                        <span className="text-xs text-muted">
                          {directionLabel[route.direction] ?? route.direction}
                          {route.variantName !== 'Main' && ` · ${route.variantName}`}
                        </span>
                      </div>
                      <p className="mt-1.5 font-semibold">{route.routeName}</p>
                      {route.signboard && (
                        <p className="mt-1.5 text-xs">
                          <Signboard text={route.signboard} />
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <VerificationBadge verification={toVerification(route.status, route.lastVerifiedOn)} />
                        {route.hasGeometry ? (
                          <Button size="sm" variant={active ? 'navy' : 'secondary'} onClick={() => props.onToggleRoute(route)} disabled={loading}>
                            {loading ? <Spinner className="size-4" /> : <Icon name="route" className="size-4" />}
                            {active ? 'Hide route' : 'Show route'}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">No verified route line yet</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {props.routeMessage && <p role="status" className="mt-2 text-sm text-muted">{props.routeMessage}</p>}
          </section>

          <EvidencePanel verification={toVerification(d.status, d.lastVerifiedOn)} sources={d.sources} />
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted">{label}:</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
