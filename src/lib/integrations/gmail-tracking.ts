const MAX_STORED_EXCERPT = 4_000;

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
};

export type GmailMessagePayload = {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet?: string;
  historyId?: string;
  payload?: GmailMessagePart;
};

export type ParsedGmailAttachment = {
  gmailAttachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type ParsedGmailMessage = {
  gmailMessageId: string;
  gmailThreadId: string;
  sender: string;
  recipients: string[];
  subject: string;
  sentAt: Date;
  text: string;
  excerpt: string;
  attachments: ParsedGmailAttachment[];
};

export type GmailProjectCandidate = {
  id: string;
  name: string;
  internalReference?: string | null;
  siteAddress?: string | null;
  site?: {
    addressLine1: string;
    addressLine2?: string | null;
    townCity: string;
    postcode: string;
  } | null;
  client?: { email?: string | null } | null;
  planningApplications?: Array<{ id: string; applicationReference?: string | null }>;
  warrantApplications?: Array<{ id: string; warrantReference?: string | null }>;
  linkedThreadIds?: string[];
};

export type GmailProjectMatch = {
  status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';
  projectId: string | null;
  planningApplicationId: string | null;
  buildingWarrantApplicationId: string | null;
  confidence: number;
  reason: string;
  candidates: Array<{ projectId: string; score: number; reason: string }>;
};

export type ExtractedGmailUpdate = {
  updateType: 'PLANNING_APPLICATION' | 'BUILDING_WARRANT' | 'DEADLINE' | 'PROJECT_ACTIVITY';
  fieldName: string;
  value: string;
  confidence: number;
  reason: string;
  deadline?: {
    title: string;
    type: 'PLANNING_DECISION' | 'WARRANT_RESPONSE' | 'WARRANT_EXPIRY' | 'INTERNAL_TASK' | 'INSPECTION' | 'CUSTOM';
    dueDate: string;
  };
};

const normalise = (value: string) => value
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}@.\s-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const decodeEntity = (entity: string) => {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  const key = entity.toLowerCase();
  if (named[key]) return named[key];
  if (key.startsWith('#x')) {
    const point = Number.parseInt(key.slice(2), 16);
    return Number.isFinite(point) ? String.fromCodePoint(point) : '';
  }
  if (key.startsWith('#')) {
    const point = Number.parseInt(key.slice(1), 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : '';
  }
  return '';
};

export const sanitiseEmailHtml = (html: string) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style|head|svg|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&([a-z0-9#]+);/gi, (_, entity: string) => decodeEntity(entity))
  .replace(/\r/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

export const decodeGmailBody = (value?: string) => {
  if (!value) return '';
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return '';
  }
};

const getHeader = (part: GmailMessagePart | undefined, name: string) =>
  part?.headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value?.trim() ?? '';

const collectParts = (part: GmailMessagePart | undefined): GmailMessagePart[] => {
  if (!part) return [];
  return [part, ...(part.parts ?? []).flatMap(collectParts)];
};

const extractAddress = (value: string) => {
  const bracketed = value.match(/<([^>]+)>/)?.[1];
  return (bracketed ?? value).trim().toLowerCase();
};

const parseRecipients = (value: string) => value
  .split(',')
  .map(extractAddress)
  .filter(Boolean);

export const parseGmailMessage = (message: GmailMessagePayload): ParsedGmailMessage => {
  const parts = collectParts(message.payload);
  const plainParts = parts
    .filter((part) => part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data)
    .map((part) => decodeGmailBody(part.body?.data));
  const htmlParts = parts
    .filter((part) => part.mimeType?.toLowerCase() === 'text/html' && part.body?.data)
    .map((part) => sanitiseEmailHtml(decodeGmailBody(part.body?.data)));
  const text = (plainParts.length ? plainParts : htmlParts)
    .join('\n\n')
    .replace(/\u0000/g, '')
    .trim();
  const attachments = parts
    .filter((part) => Boolean(part.filename && part.body?.attachmentId))
    .map((part) => ({
      gmailAttachmentId: part.body!.attachmentId!,
      fileName: part.filename!.slice(0, 255),
      mimeType: (part.mimeType || 'application/octet-stream').slice(0, 160),
      sizeBytes: Math.max(0, part.body?.size ?? 0),
    }));
  const sentAt = message.internalDate && /^\d+$/.test(message.internalDate)
    ? new Date(Number(message.internalDate))
    : new Date(getHeader(message.payload, 'Date') || Date.now());
  const safeDate = Number.isNaN(sentAt.getTime()) ? new Date() : sentAt;

  return {
    gmailMessageId: message.id,
    gmailThreadId: message.threadId,
    sender: extractAddress(getHeader(message.payload, 'From')),
    recipients: [
      ...parseRecipients(getHeader(message.payload, 'To')),
      ...parseRecipients(getHeader(message.payload, 'Cc')),
    ],
    subject: getHeader(message.payload, 'Subject').slice(0, 500) || '(No subject)',
    sentAt: safeDate,
    text,
    excerpt: (text || message.snippet || '').slice(0, MAX_STORED_EXCERPT),
    attachments,
  };
};

const projectAddress = (candidate: GmailProjectCandidate) => [
  candidate.site?.addressLine1,
  candidate.site?.addressLine2,
  candidate.site?.townCity,
  candidate.site?.postcode,
  candidate.siteAddress,
].filter(Boolean).join(' ');

const meaningfulAddressTokens = (value: string) => normalise(value)
  .split(' ')
  .filter((token) => token.length >= 4 && !['road', 'street', 'avenue', 'drive', 'court', 'glasgow'].includes(token));

const exactIdentifierMatch = (haystack: string, value?: string | null) => {
  const identifier = normalise(value ?? '');
  if (identifier.length < 3) return false;
  return haystack.includes(identifier);
};

export const isLikelyProjectEmail = (
  input: Pick<ParsedGmailMessage, 'gmailThreadId' | 'sender' | 'subject' | 'excerpt'>,
  candidates: GmailProjectCandidate[],
) => {
  const content = normalise(`${input.subject} ${input.excerpt}`);
  return candidates.some((candidate) => (
    candidate.linkedThreadIds?.includes(input.gmailThreadId)
    || exactIdentifierMatch(content, candidate.internalReference)
    || candidate.planningApplications?.some((item) => exactIdentifierMatch(content, item.applicationReference))
    || candidate.warrantApplications?.some((item) => exactIdentifierMatch(content, item.warrantReference))
    || (candidate.site?.postcode && exactIdentifierMatch(content, candidate.site.postcode))
    || (candidate.client?.email && input.sender === candidate.client.email.toLowerCase())
  ));
};

export const matchEmailToProjects = (
  email: Pick<ParsedGmailMessage, 'gmailThreadId' | 'sender' | 'subject' | 'text' | 'excerpt'>,
  candidates: GmailProjectCandidate[],
): GmailProjectMatch => {
  const content = normalise(`${email.subject} ${email.text || email.excerpt}`);
  const scored = candidates.map((candidate) => {
    let score = 0;
    let planningApplicationId: string | null = null;
    let buildingWarrantApplicationId: string | null = null;
    const reasons: string[] = [];

    const planningMatch = candidate.planningApplications?.find((item) => exactIdentifierMatch(content, item.applicationReference));
    const warrantMatch = candidate.warrantApplications?.find((item) => exactIdentifierMatch(content, item.warrantReference));
    if (planningMatch) {
      score += 120;
      planningApplicationId = planningMatch.id;
      reasons.push('exact planning reference');
    }
    if (warrantMatch) {
      score += 120;
      buildingWarrantApplicationId = warrantMatch.id;
      reasons.push('exact warrant reference');
    }
    if (exactIdentifierMatch(content, candidate.internalReference)) {
      score += 100;
      reasons.push('exact project reference');
    }
    if (candidate.linkedThreadIds?.includes(email.gmailThreadId)) {
      score += 110;
      reasons.push('confirmed Gmail thread');
    }

    const postcode = normalise(candidate.site?.postcode ?? '').replace(/\s/g, '');
    const compactContent = content.replace(/\s/g, '');
    if (postcode.length >= 5 && compactContent.includes(postcode)) {
      score += 35;
      reasons.push('exact postcode');
      const addressLine = normalise(candidate.site?.addressLine1 ?? candidate.siteAddress ?? '');
      if (addressLine.length >= 5 && content.includes(addressLine)) {
        score += 60;
        reasons.push('exact site address');
      }
      const addressTokens = meaningfulAddressTokens(projectAddress(candidate));
      const matchedTokens = addressTokens.filter((token) => content.includes(token));
      if (matchedTokens.length) {
        score += Math.min(30, matchedTokens.length * 10);
        reasons.push('address match');
      }
    }

    if (candidate.client?.email && email.sender === candidate.client.email.toLowerCase()) {
      score += 30;
      reasons.push('client email');
    }
    const nameTokens = meaningfulAddressTokens(candidate.name);
    const nameMatches = nameTokens.filter((token) => content.includes(token)).length;
    if (nameMatches) {
      score += Math.min(20, nameMatches * 8);
      reasons.push('project name');
    }

    return {
      projectId: candidate.id,
      planningApplicationId,
      buildingWarrantApplicationId,
      score,
      reason: reasons.join(', '),
    };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 30) {
    return {
      status: 'UNMATCHED',
      projectId: null,
      planningApplicationId: null,
      buildingWarrantApplicationId: null,
      confidence: 0,
      reason: 'No strong project identifier was found.',
      candidates: scored.map(({ projectId, score, reason }) => ({ projectId, score, reason })),
    };
  }
  const second = scored[1];
  if (second && best.score - second.score < 25) {
    return {
      status: 'AMBIGUOUS',
      projectId: null,
      planningApplicationId: null,
      buildingWarrantApplicationId: null,
      confidence: Math.min(0.8, best.score / 150),
      reason: 'More than one project has a plausible match.',
      candidates: scored.slice(0, 5).map(({ projectId, score, reason }) => ({ projectId, score, reason })),
    };
  }
  return {
    status: 'MATCHED',
    projectId: best.projectId,
    planningApplicationId: best.planningApplicationId,
    buildingWarrantApplicationId: best.buildingWarrantApplicationId,
    confidence: Math.min(0.99, 0.55 + best.score / 250),
    reason: best.reason || 'Project context matched.',
    candidates: scored.slice(0, 5).map(({ projectId, score, reason }) => ({ projectId, score, reason })),
  };
};

const monthNumbers: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8,
  september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const toIsoDate = (day: number, month: number, year: number) => {
  const date = new Date(Date.UTC(year < 100 ? 2000 + year : year, month, day, 12));
  if (
    date.getUTCDate() !== day
    || date.getUTCMonth() !== month
    || date.getUTCFullYear() !== (year < 100 ? 2000 + year : year)
  ) return null;
  return date.toISOString();
};

export const extractExplicitDates = (value: string) => {
  const results: Array<{ raw: string; iso: string; index: number }> = [];
  for (const match of value.matchAll(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/g)) {
    const iso = toIsoDate(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (iso) results.push({ raw: match[0], iso, index: match.index ?? 0 });
  }
  for (const match of value.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi)) {
    const month = monthNumbers[match[2].toLowerCase()];
    const iso = month === undefined ? null : toIsoDate(Number(match[1]), month, Number(match[3]));
    if (iso) results.push({ raw: match[0], iso, index: match.index ?? 0 });
  }
  return results.sort((a, b) => a.index - b.index);
};

const recognisedSender = (sender: string) => /@(.*\.)?(gov\.uk|eplanning\.scot|edevelopment\.scot)$/i.test(sender);

const referenceValue = (text: string, kind: 'planning' | 'warrant') => {
  const patterns = kind === 'planning'
    ? [
      /(?:planning\s+)?application\s+(?:reference|ref(?:erence)?\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{4,40})/i,
      /planning\s+ref(?:erence)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{4,40})/i,
    ]
    : [
      /(?:building\s+)?warrant\s+(?:reference|ref(?:erence)?\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{4,40})/i,
      /warrant\s+ref(?:erence)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/.-]{4,40})/i,
    ];
  return patterns.map((pattern) => text.match(pattern)?.[1]?.replace(/[.,;:]$/, '')).find(Boolean) ?? null;
};

const firstDateNear = (text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  if (!match) return null;
  const window = text.slice(match.index, match.index + 180);
  return extractExplicitDates(window)[0]?.iso ?? null;
};

export const extractGmailUpdates = (email: Pick<ParsedGmailMessage, 'sender' | 'subject' | 'text' | 'sentAt'>) => {
  const combined = `${email.subject}\n${email.text}`.slice(0, 100_000);
  const lower = combined.toLowerCase();
  const official = recognisedSender(email.sender);
  const strong = official ? 0.98 : 0.86;
  const updates: ExtractedGmailUpdate[] = [];
  const push = (update: ExtractedGmailUpdate) => {
    if (!updates.some((item) => item.updateType === update.updateType && item.fieldName === update.fieldName && item.value === update.value)) {
      updates.push(update);
    }
  };

  const planningReference = referenceValue(combined, 'planning');
  if (planningReference) push({
    updateType: 'PLANNING_APPLICATION',
    fieldName: 'applicationReference',
    value: planningReference,
    confidence: strong,
    reason: 'Explicit planning application reference in the email.',
  });
  const warrantReference = referenceValue(combined, 'warrant');
  if (warrantReference) push({
    updateType: 'BUILDING_WARRANT',
    fieldName: 'warrantReference',
    value: warrantReference,
    confidence: strong,
    reason: 'Explicit building warrant reference in the email.',
  });

  const planningContext = /planning|householder|eplanning/.test(lower);
  const warrantContext = /building warrant|warrant application|edevelopment/.test(lower);
  const receivedDate = email.sentAt.toISOString();

  if (planningContext && /\b(validated|validation complete|application is valid)\b/.test(lower)) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'status', value: 'VALIDATED', confidence: strong, reason: 'The email explicitly states that the planning application was validated.' });
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'validDate', value: receivedDate, confidence: official ? 0.94 : 0.8, reason: 'Validation email received date.' });
  } else if (planningContext && /\b(submitted|application received|we have received)\b/.test(lower)) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'status', value: 'SUBMITTED', confidence: strong, reason: 'The email explicitly confirms planning submission or receipt.' });
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'submissionDate', value: receivedDate, confidence: official ? 0.92 : 0.78, reason: 'Submission confirmation email received date.' });
  }
  if (planningContext && /\b(further information|additional information|additional documents|required documents)\b/.test(lower)) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'status', value: 'FURTHER_INFORMATION_REQUESTED', confidence: strong, reason: 'The email requests further information or documents.' });
  }
  if (planningContext && /\b(approved|permission granted|planning permission has been granted)\b/.test(lower)) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'status', value: 'APPROVED', confidence: strong, reason: 'The email explicitly confirms planning approval.' });
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'decisionDate', value: receivedDate, confidence: official ? 0.92 : 0.78, reason: 'Planning decision email received date.' });
  }
  if (planningContext && /\b(refused|permission refused|planning permission has been refused)\b/.test(lower)) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'status', value: 'REFUSED', confidence: strong, reason: 'The email explicitly confirms planning refusal.' });
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'decisionDate', value: receivedDate, confidence: official ? 0.92 : 0.78, reason: 'Planning decision email received date.' });
  }

  if (warrantContext && /\b(submitted|application received|we have received)\b/.test(lower)) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'status', value: 'SUBMITTED', confidence: strong, reason: 'The email explicitly confirms building warrant submission or receipt.' });
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'submissionDate', value: receivedDate, confidence: official ? 0.92 : 0.78, reason: 'Submission confirmation email received date.' });
  }
  if (warrantContext && /\b(further information|additional information|additional documents|required documents|amendment requested)\b/.test(lower)) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'status', value: 'FURTHER_INFORMATION_REQUESTED', confidence: strong, reason: 'The email requests further warrant information or an amendment.' });
  }
  if (warrantContext && /\b(warrant granted|building warrant has been granted|application granted)\b/.test(lower)) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'status', value: 'GRANTED', confidence: strong, reason: 'The email explicitly confirms that the building warrant was granted.' });
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'grantedDate', value: receivedDate, confidence: official ? 0.92 : 0.78, reason: 'Building warrant grant email received date.' });
  }
  if (warrantContext && /\b(rejected|application refused)\b/.test(lower)) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'status', value: 'REJECTED', confidence: strong, reason: 'The email explicitly confirms warrant rejection.' });
  }
  if (warrantContext && /\b(completion certificate).{0,80}\b(accepted|approved)\b/.test(lower)) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'completionCertificateStatus', value: 'ACCEPTED', confidence: strong, reason: 'The email explicitly confirms acceptance of the completion certificate.' });
  }

  const decisionTarget = firstDateNear(combined, /(?:decision|determination)\s+(?:target|due|date)|target\s+date/i);
  if (planningContext && decisionTarget) {
    push({ updateType: 'PLANNING_APPLICATION', fieldName: 'decisionTargetDate', value: decisionTarget, confidence: official ? 0.97 : 0.84, reason: 'Explicit planning decision target date.' });
    push({
      updateType: 'DEADLINE',
      fieldName: 'planningDecisionTarget',
      value: decisionTarget,
      confidence: official ? 0.97 : 0.84,
      reason: 'Explicit planning decision target date.',
      deadline: { title: 'Planning decision target', type: 'PLANNING_DECISION', dueDate: decisionTarget },
    });
  }
  const responseDate = firstDateNear(combined, /(?:first\s+response|response\s+(?:is\s+)?due|respond\s+by|information\s+(?:is\s+)?required\s+by)/i);
  if (responseDate) {
    push({
      updateType: 'DEADLINE',
      fieldName: warrantContext ? 'warrantResponse' : 'informationResponse',
      value: responseDate,
      confidence: official ? 0.95 : 0.82,
      reason: 'Explicit response deadline in the email.',
      deadline: {
        title: warrantContext ? 'Building Warrant response deadline' : 'Additional information deadline',
        type: warrantContext ? 'WARRANT_RESPONSE' : 'CUSTOM',
        dueDate: responseDate,
      },
    });
    if (warrantContext) push({ updateType: 'BUILDING_WARRANT', fieldName: 'firstResponseTargetDate', value: responseDate, confidence: official ? 0.95 : 0.82, reason: 'Explicit first response target date.' });
  }
  const expiryDate = firstDateNear(combined, /(?:warrant\s+)?expir(?:y|es|ation)/i);
  if (warrantContext && expiryDate) {
    push({ updateType: 'BUILDING_WARRANT', fieldName: 'expiryDate', value: expiryDate, confidence: official ? 0.97 : 0.84, reason: 'Explicit building warrant expiry date.' });
    push({
      updateType: 'DEADLINE',
      fieldName: 'warrantExpiry',
      value: expiryDate,
      confidence: official ? 0.97 : 0.84,
      reason: 'Explicit building warrant expiry date.',
      deadline: { title: 'Building Warrant expiry', type: 'WARRANT_EXPIRY', dueDate: expiryDate },
    });
  }
  const siteVisitDate = firstDateNear(combined, /site\s+(?:visit|inspection)|inspection\s+(?:date|arranged|booked)/i);
  if (siteVisitDate) push({
    updateType: 'DEADLINE',
    fieldName: 'siteVisit',
    value: siteVisitDate,
    confidence: official ? 0.94 : 0.82,
    reason: 'Explicit site visit or inspection date.',
    deadline: { title: 'Site visit', type: 'INSPECTION', dueDate: siteVisitDate },
  });

  return updates;
};
