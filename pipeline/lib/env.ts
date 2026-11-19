/**
 * Pipeline settings from ".env.pipeline" (never committed; see .env.pipeline.example).
 * The pipeline signs in as a MODERATOR/ADMIN user. It does NOT use the
 * Supabase service_role key, and refuses to run if one is supplied.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PipelineEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
  password: string;
  contact: string;
  overpassUrl: string;
}

const ENV_FILE = resolve(process.cwd(), '.env.pipeline');

export function loadEnvFile(): void {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

export function contactForUserAgent(): string {
  loadEnvFile();
  const contact = (process.env.PIPELINE_CONTACT ?? '').trim();
  if (!contact) {
    throw new Error(
      'Set PIPELINE_CONTACT in .env.pipeline (your repo URL or email). Overpass requires a User-Agent that identifies the application.',
    );
  }
  return contact;
}

export function overpassUrl(): string {
  loadEnvFile();
  return (process.env.OVERPASS_URL ?? '').trim() || 'https://overpass-api.de/api/interpreter';
}

function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role === 'service_role';
  } catch {
    return false;
  }
}

export function readDbEnv(): PipelineEnv {
  loadEnvFile();
  const need = (name: string) => {
    const value = (process.env[name] ?? '').trim();
    if (!value) throw new Error(`Missing ${name} in .env.pipeline (see .env.pipeline.example).`);
    return value;
  };
  const env: PipelineEnv = {
    supabaseUrl: need('SUPABASE_URL').replace(/\/+$/, ''),
    supabaseAnonKey: need('SUPABASE_ANON_KEY'),
    email: need('LAKBAY_PIPELINE_EMAIL'),
    password: need('LAKBAY_PIPELINE_PASSWORD'),
    contact: need('PIPELINE_CONTACT'),
    overpassUrl: overpassUrl(),
  };
  if (looksLikeSecretKey(env.supabaseAnonKey)) {
    throw new Error('SUPABASE_ANON_KEY is a SECRET/service_role key. Use the publishable/anon key; the pipeline signs in as a moderator.');
  }
  return env;
}
