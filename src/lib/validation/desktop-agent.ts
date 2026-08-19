import { AgentOperatingState, AutomationJobType } from '@prisma/client';
import { z } from 'zod';

export const AGENT_CAPABILITY_CONTRACT_VERSION = 1 as const;
export const DESKTOP_PROGRESS_CONTRACT_VERSION = 1 as const;

export const agentCapabilitiesSchema = z.object({
  workflows: z.array(z.enum([
    AutomationJobType.HOUSEHOLDER_PLANNING,
    AutomationJobType.BUILDING_WARRANT,
  ])).min(1).max(10),
  snapshotVersions: z.array(z.number().int().min(1).max(20)).min(1).max(10),
  callbackContractVersions: z.array(z.number().int().min(1).max(20)).min(1).max(10),
  progressContractVersions: z.array(z.number().int().min(1).max(20)).min(1).max(10),
}).strict();

export const agentEnrollmentExchangeSchema = z.object({
  token: z.string().trim().regex(/^ape_[A-Za-z0-9_-]{40,100}$/),
  organisationId: z.string().trim().min(8).max(120),
  installationId: z.string().uuid(),
  machineName: z.string().trim().min(1).max(120),
  agentVersion: z.string().trim().min(1).max(40),
  capabilities: agentCapabilitiesSchema,
}).strict();

export const agentHeartbeatSchema = z.object({
  version: z.literal(AGENT_CAPABILITY_CONTRACT_VERSION),
  agentVersion: z.string().trim().min(1).max(40),
  capabilities: agentCapabilitiesSchema,
  state: z.nativeEnum(AgentOperatingState),
  currentJobId: z.string().trim().min(8).max(120).nullable().optional(),
  agentRunId: z.string().uuid().nullable().optional(),
}).strict();

export const agentClaimSchema = z.object({
  agentRunId: z.string().uuid(),
}).strict();

export const desktopProgressSchema = z.object({
  version: z.literal(DESKTOP_PROGRESS_CONTRACT_VERSION),
  jobId: z.string().trim().min(8).max(120),
  agentRunId: z.string().uuid(),
  sequence: z.number().int().positive(),
  occurredAt: z.string().datetime({ offset: true }),
  status: z.enum(['RUNNING', 'USER_ACTION_REQUIRED', 'ERROR']),
  progress: z.object({
    stage: z.string().trim().min(1).max(100),
    stageState: z.enum(['pending', 'running', 'completed', 'user_action_required', 'failed']),
    percent: z.number().int().min(0).max(100),
    etaSeconds: z.number().int().min(0).max(86_400).nullable(),
    message: z.string().trim().min(1).max(500),
  }).strict(),
}).strict();

export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

