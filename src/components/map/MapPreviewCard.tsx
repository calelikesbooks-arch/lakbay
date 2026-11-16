import { Link } from 'react-router';
import { Icon } from '../ui/Icon';

/**
 * Lightweight link card to the Map page. The drawing is decorative
 * (not a real map), so the heavy MapLibre library only loads on /map.
 */
export function MapPreviewCard() {
  return (
    <Link
      to="/map"
      className="group relative block overflow-hidden rounded-[var(--radius-card)] border border-line bg-navy-900 text-white"
    >
      <svg viewBox="0 0 320 150" className="h-36 w-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <rect width="320" height="150" fill="#131d38" />
        <g stroke="#26324f" strokeWidth="1">
          {[20, 50, 80, 110, 140].map((y) => (
            <line key={y} x1="0" x2="320" y1={y} y2={y} />
          ))}
          {[40, 100, 160, 220, 280].map((x) => (
            <line key={x} y1="0" y2="150" x1={x} x2={x} />
          ))}
        </g>
        <path d="M-10 120 C 60 110, 90 70, 150 72 S 250 40, 330 30" fill="none" stroke="#344673" strokeWidth="10" strokeLinecap="round" />
        <path d="M30 116 C 80 106, 100 74, 150 72 S 240 44, 286 36" fill="none" stroke="#f9c440" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="7 6" />
        <circle cx="30" cy="116" r="7" fill="#3fb6a2" />
        <circle cx="286" cy="36" r="8" fill="#f9c440" />
        <circle cx="286" cy="36" r="3" fill="#131d38" />
      </svg>
      <div className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="font-bold">Explore the map</p>
          <p className="text-sm text-navy-200">Bulacan to Metro Manila pilot area</p>
        </div>
        <span className="grid size-10 place-items-center rounded-full bg-white/10 transition-transform group-hover:translate-x-0.5">
          <Icon name="arrowRight" className="size-5" />
        </span>
      </div>
    </Link>
  );
}
