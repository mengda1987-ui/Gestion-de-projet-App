import { NextResponse } from 'next/server';
import { route } from '@/lib/api/security';
export const PATCH = route(async () => NextResponse.json({ ok: false, code: 'USE_VERSIONED_PATCH', message: 'Use /api/board/patch with a version and entryId' }, { status: 410 }));
