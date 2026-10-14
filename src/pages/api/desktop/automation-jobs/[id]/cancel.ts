export const prerender = false;
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { assertRateLimit, rateLimitPolicies } from '@/lib/server/rate-limit';
import { parseBody, withErrorHandling } from '@/lib/utils/handlers';
import { HttpError, jsonResponse } from '@/lib/utils/http';
import { requireAgentAuth } from '@/server/auth/agent-credential';
import { cancelAutomationJob } from '@/server/services/automation-queue.service';

export const POST: APIRoute = context => withErrorHandling(async () => {
  assertRateLimit(context, rateLimitPolicies.desktop, 'desktop-agent:cancel');
  const agent = await requireAgentAuth(context);
  if (!context.params.id) throw new HttpError(400, 'Automation job id is required.');
  const body = await parseBody(context.request, z.object({ agentRunId: z.string().uuid() }).strict());
  const result = await cancelAutomationJob({ organisationId: agent.organisationId, jobId: context.params.id,
    agent: { id: agent.id, runId: body.agentRunId, credentialHash: agent.credentialHash } });
  return jsonResponse(200, { ok: true, ...result });
}, context);
