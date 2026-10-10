import { Prisma } from '@prisma/client';

/** Poolers may reset search_path between requests. Match Prisma's configured
 * schema explicitly for raw locks/counters, including isolated previews. */
export function databaseTable(name: 'UploadRateLimit' | 'Organisation' | 'Project' | 'ApplicationDraft' | 'DocumentProcessingJob' | 'ProjectUploadIntent' | 'ProjectFeeMilestone' | 'ProjectFeePlan') {
  const schema = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public' : 'public';
  return Prisma.raw(`"${schema.replaceAll('"', '""')}"."${name}"`);
}
