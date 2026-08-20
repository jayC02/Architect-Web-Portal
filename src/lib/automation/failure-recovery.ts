export type FailureRecoveryAction =
  | 'retry'
  | 'review_address'
  | 'update_login'
  | 'review_applicant'
  | 'review_agent'
  | 'review_site'
  | 'review_type_of_work'
  | 'review_documents'
  | 'review_portal'
  | 'close';

export type AutomationFailureMetadata = {
  category: string | null;
  headline: string | null;
  stage: string | null;
  stageDescription: string | null;
  explanation: string | null;
  nextAction: string | null;
  recoveryAction: FailureRecoveryAction;
  recoveryFields: string[];
  retrySafe: boolean;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

const knownActions = new Set<FailureRecoveryAction>([
  'retry',
  'review_address',
  'update_login',
  'review_applicant',
  'review_agent',
  'review_site',
  'review_type_of_work',
  'review_documents',
  'review_portal',
  'close',
]);

const actionForCategory = (category: string | null): FailureRecoveryAction => ({
  AUTHENTICATION_FAILED: 'update_login',
  ADDRESS_RESOLUTION_FAILED: 'review_address',
  APPLICANT_DATA_INVALID: 'review_applicant',
  AGENT_DATA_INVALID: 'review_agent',
  SITE_DATA_INVALID: 'review_site',
  TYPE_OF_WORK_REQUIRED: 'review_type_of_work',
  DOCUMENT_UPLOAD_FAILED: 'review_documents',
  DOCUMENT_REQUIRED: 'review_documents',
}[category ?? ''] as FailureRecoveryAction | undefined) ?? 'review_portal';

const categoryPresentation: Record<string, { headline: string; stage: string; explanation: string }> = {
  AUTHENTICATION_FAILED: { headline: "Couldn't sign in to eDevelopment", stage: 'login', explanation: 'The application did not progress beyond sign-in.' },
  ADDRESS_RESOLUTION_FAILED: { headline: 'Property address could not be resolved', stage: 'address_selection', explanation: 'Architect Pro stopped rather than selecting the wrong property.' },
  APPLICANT_DATA_INVALID: { headline: 'Applicant information required', stage: 'applicant_details', explanation: 'Correct the applicant information before starting another attempt.' },
  AGENT_DATA_INVALID: { headline: 'Agent information required', stage: 'agent_details', explanation: 'Correct the practice or agent information before starting another attempt.' },
  SITE_DATA_INVALID: { headline: 'Site information required', stage: 'address_selection', explanation: 'Correct the saved site information before starting another attempt.' },
  TYPE_OF_WORK_REQUIRED: { headline: 'Type of work required', stage: 'main_details', explanation: 'Select at least one type of work before running the application.' },
  DOCUMENT_UPLOAD_FAILED: { headline: 'Supporting documents need review', stage: 'documents', explanation: 'Review the project documents before starting another attempt.' },
};

export const readAutomationFailureMetadata = (
  resultData: unknown,
  status: string,
  fallbackStage: string | null,
): AutomationFailureMetadata => {
  const result = objectValue(resultData);
  const category = text(result.failureCategory) ?? text(result.errorCode);
  const categoryDefaults = category ? categoryPresentation[category] : undefined;
  const explicitAction = text(result.recoveryAction) as FailureRecoveryAction | null;
  const recoveryAction = explicitAction && knownActions.has(explicitAction)
    ? explicitAction
    : actionForCategory(category);
  const safeRetryPoint = text(result.safeRetryPoint);
  const retrySafe = status === 'FAILED_RETRYABLE'
    && (result.retrySafe === true || (result.outcome === 'failed_retryable' && Boolean(safeRetryPoint)));
  return {
    category,
    headline: text(result.errorHeadline) ?? categoryDefaults?.headline ?? null,
    stage: categoryDefaults?.stage ?? text(result.currentSection) ?? fallbackStage,
    stageDescription: text(result.stageDescription),
    explanation: text(result.progressionMessage) ?? categoryDefaults?.explanation ?? null,
    nextAction: text(result.nextAction),
    recoveryAction,
    recoveryFields: Array.isArray(result.recoveryFields)
      ? result.recoveryFields.filter((value): value is string => typeof value === 'string')
      : [],
    retrySafe,
  };
};
