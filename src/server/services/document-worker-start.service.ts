import { waitUntil } from '@vercel/functions';
import { runDocumentProcessingWorker } from './document-processing.service';

export function startDocumentWorker(organisationId: string) {
  const work = runDocumentProcessingWorker(organisationId).catch(() => {
    console.info('document-worker-start', { organisationId, recovery: 'scheduled-sweep' });
  });
  // This is only an acceleration. PostgreSQL and the scheduled sweep own recovery.
  waitUntil(work);
}
