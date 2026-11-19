/**
 * Import areas. To expand LAKBAY to another municipality, add one entry.
 *
 * Boundaries are NOT typed here: the pipeline asks OpenStreetMap for the
 * official administrative boundary (by name + admin level inside a parent
 * area) and imports only what lies inside it.
 *
 * Philippine OSM admin levels (check on openstreetmap.org if a lookup fails):
 *   region = 3, province = 4, city/municipality = 6, barangay = 10
 */
export interface ImportAreaConfig {
  code: string;
  name: string;
  municipality: string;
  province: string;
  region: string;
  osm: {
    /** Regular expression matched against the boundary's name tag. */
    nameRegex: string;
    adminLevel: number;
    parentName: string;
    parentAdminLevel: number;
  };
  /** Included in `--all`. Large cities are off by default. */
  enabledByDefault: boolean;
}

export const AREAS: ImportAreaConfig[] = [
  {
    code: 'ph-bulacan-marilao',
    name: 'Marilao, Bulacan',
    municipality: 'Marilao',
    province: 'Bulacan',
    region: 'Central Luzon (Region III)',
    osm: { nameRegex: '^Marilao$', adminLevel: 6, parentName: 'Bulacan', parentAdminLevel: 4 },
    enabledByDefault: true,
  },
  {
    code: 'ph-bulacan-meycauayan',
    name: 'Meycauayan, Bulacan',
    municipality: 'Meycauayan',
    province: 'Bulacan',
    region: 'Central Luzon (Region III)',
    osm: { nameRegex: '^(City of )?Meycauayan( City)?$', adminLevel: 6, parentName: 'Bulacan', parentAdminLevel: 4 },
    enabledByDefault: true,
  },
  {
    code: 'ph-bulacan-bocaue',
    name: 'Bocaue, Bulacan',
    municipality: 'Bocaue',
    province: 'Bulacan',
    region: 'Central Luzon (Region III)',
    osm: { nameRegex: '^Bocaue$', adminLevel: 6, parentName: 'Bulacan', parentAdminLevel: 4 },
    enabledByDefault: true,
  },
  // Metro Manila ends of the pilot corridor. Bulacan-to-Metro Manila routes
  // that touch the three towns are already imported WITH their Metro Manila
  // stops; enable these only to import every stop in these big cities.
  // Metro Manila has no provinces in OSM: parent is the region (level 3).
  // Verify the names/levels on openstreetmap.org before enabling.
  {
    code: 'ph-ncr-caloocan',
    name: 'Caloocan (Monumento area)',
    municipality: 'Caloocan',
    province: 'Metro Manila',
    region: 'National Capital Region',
    osm: { nameRegex: '^(City of )?Caloocan( City)?$', adminLevel: 6, parentName: 'Metro Manila', parentAdminLevel: 3 },
    enabledByDefault: false,
  },
  {
    code: 'ph-ncr-quezon-city',
    name: 'Quezon City (SM North EDSA, Cubao)',
    municipality: 'Quezon City',
    province: 'Metro Manila',
    region: 'National Capital Region',
    osm: { nameRegex: '^Quezon City$', adminLevel: 6, parentName: 'Metro Manila', parentAdminLevel: 3 },
    enabledByDefault: false,
  },
];

export function findArea(code: string): ImportAreaConfig | undefined {
  return AREAS.find((a) => a.code === code);
}
