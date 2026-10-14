import { env } from 'cloudflare:workers';
import { handleProfile } from '../../../server/profile.mjs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleProfile(request, env); }
export function PUT(request: Request) { return handleProfile(request, env); }
