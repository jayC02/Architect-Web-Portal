import { GmailPlanningClassification, PlanningStatus } from '@prisma/client';
import { extractExplicitDates, type ParsedGmailMessage } from '@/lib/integrations/gmail-tracking';

export type PlanningClassificationResult = {
  classification: GmailPlanningClassification;
  confidence: number;
  explicit: boolean;
  reason: string;
  effectiveDate: Date | null;
};

const contentFor = (email: Pick<ParsedGmailMessage, 'subject' | 'text' | 'excerpt'>) =>
  `${email.subject}\n${email.text || email.excerpt}`.slice(0, 100_000);

const explicitDateNear = (content: string, marker: RegExp) => {
  const match = marker.exec(content);
  if (!match) return null;
  const value = extractExplicitDates(content.slice(match.index, match.index + 180))[0]?.iso;
  return value ? new Date(value) : null;
};

export const classifyPlanningEmail = (
  email: Pick<ParsedGmailMessage, 'subject' | 'text' | 'excerpt' | 'sentAt'>,
): PlanningClassificationResult => {
  const content = contentFor(email);
  const lower = content.toLowerCase();
  const planningContext = /\b(planning|householder|planning permission|application)\b/.test(lower);
  if (!planningContext) {
    return { classification: GmailPlanningClassification.UNKNOWN, confidence: 0.1, explicit: false, reason: 'No Planning application context was found.', effectiveDate: null };
  }

  const tentative = /\b(recommend(?:ed|ation)?|minded to|draft|subject to committee|may be|likely to)\b/.test(lower);
  const approved = /\b(planning permission (?:is|has been) (?:hereby )?granted|permission (?:is|has been) granted|application (?:is|has been) approved|decision\s*[:\-]\s*approved|we have approved)\b/.test(lower);
  const refused = /\b(planning permission (?:is|has been) refused|permission (?:is|has been) refused|application (?:is|has been) refused|decision\s*[:\-]\s*refused|we have refused)\b/.test(lower);
  if (tentative && /\b(approv(?:e|ed|al)|grant(?:ed)?|refus(?:e|ed|al))\b/.test(lower)) {
    return { classification: GmailPlanningClassification.DECISION_OTHER, confidence: 0.72, explicit: false, reason: 'Decision wording is tentative or qualified and requires review.', effectiveDate: null };
  }
  if (approved && refused) {
    return { classification: GmailPlanningClassification.DECISION_OTHER, confidence: 0.55, explicit: false, reason: 'The message contains conflicting approval and refusal wording.', effectiveDate: null };
  }
  if (approved) {
    return {
      classification: GmailPlanningClassification.DECISION_APPROVED,
      confidence: 0.99,
      explicit: true,
      reason: 'The message explicitly confirms that Planning permission was granted.',
      effectiveDate: explicitDateNear(content, /(?:decision|permission|approved|granted)\s+(?:date|on)\s*[:\-]?/i),
    };
  }
  if (refused) {
    return {
      classification: GmailPlanningClassification.DECISION_REFUSED,
      confidence: 0.99,
      explicit: true,
      reason: 'The message explicitly confirms that Planning permission was refused.',
      effectiveDate: explicitDateNear(content, /(?:decision|permission|refused)\s+(?:date|on)\s*[:\-]?/i),
    };
  }
  if (/\b(further information is required|additional information is required|please provide (?:the )?(?:following|additional|further)|request for further information)\b/.test(lower)) {
    return { classification: GmailPlanningClassification.INFORMATION_REQUESTED, confidence: 0.98, explicit: true, reason: 'The authority explicitly requests additional Planning information.', effectiveDate: null };
  }
  if (/\b(application (?:has been|is) valid(?:ated)?|validation (?:is )?complete|application (?:has been|was) validated)\b/.test(lower)) {
    return {
      classification: GmailPlanningClassification.APPLICATION_VALIDATED,
      confidence: 0.98,
      explicit: true,
      reason: 'The message explicitly confirms Planning validation.',
      effectiveDate: explicitDateNear(content, /valid(?:ated|ation)(?:\s+date|\s+on)?\s*[:\-]?/i),
    };
  }
  if (/\b(we have received your (?:planning )?application|application (?:has been|was) received|receipt of (?:your )?(?:planning )?application)\b/.test(lower)) {
    return { classification: GmailPlanningClassification.APPLICATION_RECEIVED, confidence: 0.96, explicit: true, reason: 'The message explicitly acknowledges receipt of the Planning application.', effectiveDate: null };
  }
  if (/\b(decision notice|decision has been issued|application has been determined)\b/.test(lower)) {
    return { classification: GmailPlanningClassification.DECISION_OTHER, confidence: 0.75, explicit: false, reason: 'A Planning decision is mentioned but its outcome is not unambiguous.', effectiveDate: null };
  }
  return { classification: GmailPlanningClassification.LIKELY_PROJECT_EMAIL, confidence: 0.6, explicit: false, reason: 'The message appears Planning-related but has no controlled lifecycle outcome.', effectiveDate: null };
};

const authorityTokens = (authority: string | null | undefined) => (authority ?? '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(' ')
  .filter((token) => token.length >= 4 && !['council', 'authority', 'city', 'the'].includes(token));

export const hasExpectedAuthorityEvidence = (input: {
  sender: string;
  localAuthority?: string | null;
  content: string;
}) => {
  const sender = input.sender.toLowerCase();
  const trustedDomain = /@(.*\.)?(gov\.uk|eplanning\.scot|edevelopment\.scot)$/.test(sender);
  if (!trustedDomain) return false;
  const tokens = authorityTokens(input.localAuthority);
  if (!tokens.length) return false;
  const evidence = `${sender} ${input.content.toLowerCase()}`;
  return tokens.some((token) => evidence.includes(token));
};

const legalFrom: Partial<Record<GmailPlanningClassification, ReadonlySet<PlanningStatus>>> = {
  [GmailPlanningClassification.APPLICATION_RECEIVED]: new Set([
    PlanningStatus.NOT_STARTED,
    PlanningStatus.DRAFTING,
    PlanningStatus.SUBMITTED,
  ]),
  [GmailPlanningClassification.APPLICATION_VALIDATED]: new Set([
    PlanningStatus.SUBMITTED,
    PlanningStatus.IN_REVIEW,
    PlanningStatus.VALIDATED,
  ]),
  [GmailPlanningClassification.INFORMATION_REQUESTED]: new Set([
    PlanningStatus.SUBMITTED,
    PlanningStatus.VALIDATED,
    PlanningStatus.IN_REVIEW,
    PlanningStatus.FURTHER_INFORMATION_REQUESTED,
  ]),
  [GmailPlanningClassification.DECISION_APPROVED]: new Set([
    PlanningStatus.SUBMITTED,
    PlanningStatus.VALIDATED,
    PlanningStatus.IN_REVIEW,
    PlanningStatus.FURTHER_INFORMATION_REQUESTED,
    PlanningStatus.APPROVED,
  ]),
  [GmailPlanningClassification.DECISION_REFUSED]: new Set([
    PlanningStatus.SUBMITTED,
    PlanningStatus.VALIDATED,
    PlanningStatus.IN_REVIEW,
    PlanningStatus.FURTHER_INFORMATION_REQUESTED,
    PlanningStatus.REFUSED,
  ]),
};

export const planningStatusForClassification = (classification: GmailPlanningClassification) => ({
  [GmailPlanningClassification.APPLICATION_RECEIVED]: PlanningStatus.SUBMITTED,
  [GmailPlanningClassification.APPLICATION_VALIDATED]: PlanningStatus.VALIDATED,
  [GmailPlanningClassification.INFORMATION_REQUESTED]: PlanningStatus.FURTHER_INFORMATION_REQUESTED,
  [GmailPlanningClassification.DECISION_APPROVED]: PlanningStatus.APPROVED,
  [GmailPlanningClassification.DECISION_REFUSED]: PlanningStatus.REFUSED,
} as Partial<Record<GmailPlanningClassification, PlanningStatus>>)[classification] ?? null;

export type AutomaticTransitionDecision = {
  automatic: boolean;
  reason: string;
  targetStatus: PlanningStatus | null;
};

export const decideAutomaticPlanningTransition = (input: {
  classification: PlanningClassificationResult;
  currentStatus: PlanningStatus;
  uniqueProjectMatch: boolean;
  exactApplicationReference: boolean;
  expectedAuthority: boolean;
  newerManualState: boolean;
  deterministicMismatch?: boolean;
  aiClassification?: GmailPlanningClassification | null;
}): AutomaticTransitionDecision => {
  const targetStatus = planningStatusForClassification(input.classification.classification);
  const gates: Array<[boolean, string]> = [
    [Boolean(targetStatus), 'The classification has no automatic Planning transition.'],
    [input.uniqueProjectMatch, 'The email does not uniquely match one project.'],
    [input.exactApplicationReference, 'An exact Planning application reference is required.'],
    [input.expectedAuthority, 'The sender is not trusted evidence for the expected authority.'],
    [input.classification.explicit, 'The lifecycle wording is not explicit.'],
    [Boolean(legalFrom[input.classification.classification]?.has(input.currentStatus)), 'The current Planning state does not allow this transition.'],
    [!input.newerManualState, 'A newer application change protects the current state.'],
    [!input.deterministicMismatch, 'Deterministic evidence conflicts with the proposed transition.'],
    [!input.aiClassification || input.aiClassification === input.classification.classification, 'AI and deterministic classification disagree.'],
  ];
  const failure = gates.find(([passed]) => !passed);
  return failure
    ? { automatic: false, reason: failure[1], targetStatus }
    : { automatic: true, reason: 'All deterministic regulatory transition gates passed.', targetStatus };
};

export const gmailPlanningIdempotencyKey = (
  gmailMessageId: string,
  planningApplicationId: string,
  classification: GmailPlanningClassification,
) => `gmail:${gmailMessageId}:${planningApplicationId}:${classification.toLowerCase().replaceAll('_', '-')}`;
