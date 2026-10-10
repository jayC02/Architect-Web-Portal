export const prerender = false;
import type { APIRoute } from 'astro';
import { jsonResponse } from '@/lib/utils/http';
export const GET: APIRoute = () => jsonResponse(410, { error: 'Scheduled PDF processing has been retired. Analyse documents directly from the application or project.' });
