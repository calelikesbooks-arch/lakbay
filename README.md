# LAKBAY

Research-backed commuting guide for Marilao, Meycauayan and Bocaue (Bulacan) to Monumento, SM North EDSA and Cubao.

**Status: Milestone 1 (app shell).** Route search, fares, saved trips, community and accounts are placeholders and do not work yet.

## Requirements

- Node.js 20.19 or newer (22 LTS recommended)
- Git

## Run locally

```bash
npm install
copy .env.example .env.local      # Windows (Command Prompt)
# cp .env.example .env.local      # macOS / Linux / Git Bash
npm run dev
```

Open http://localhost:5173

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server with live reload |
| `npm run typecheck` | Check TypeScript types |
| `npm run build` | Type-check and build the production site into `dist/` |
| `npm run preview` | Serve the built `dist/` folder locally |

## Environment variables

See `.env.example`. All `VITE_` values are public. Never put a Supabase secret / service_role key here.

## Database

Supabase PostgreSQL + PostGIS schema, security rules, tests and rollback: see [docs/database.md](docs/database.md).



## Project layout

```
src/
  components/  ui/ (buttons, cards…), layout/ (shell, nav), feedback/ (errors, loading), map/
  pages/       one file per screen
  lib/         env, Supabase client, storage, feature status list
  theme/       light/dark theme
  types/       shared TypeScript types
data/          transport data (Milestone 2+)
scripts/       data validation and build scripts (Milestone 2+)
supabase/      SQL migrations (Phase 3)
docs/          project documents
```

## Map attribution

Map data © OpenStreetMap contributors. Default style from OpenFreeMap.
