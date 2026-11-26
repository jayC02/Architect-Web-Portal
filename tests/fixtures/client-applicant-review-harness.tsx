import { createRoot } from 'react-dom/client';
import ApplicationDraftReview from '../../src/components/applications/ApplicationDraftReview';
import { evaluateClientApplicationDraftReadiness } from '../../src/lib/application-draft-readiness';
import { clientReviewFixture } from './client-applicant-review';
import { AgentDefaultsForm } from '../../src/components/live/DirectoryEditor';
import '../../src/styles/global.css';

const scenario = new URLSearchParams(location.search).get('state');
const draft = clientReviewFixture();
if (scenario === 'missing-agent-phone') draft.review!.agent.phone = null;
if (scenario === 'paper-size') {
  draft.review!.documents[0].paperSize = null;
  draft.review!.documents[0].paperSizeNeedsReview = true;
  draft.documents[0].paperSizeAnalysis = { value: null, source: 'unknown', certainty: 'low',
    evidence: 'Title block says A1; PDF page dimensions are A3. Confirm the upload size.',
    page: 1, physicalSize: 'A3', mixedSizes: false, reviewRequired: true };
}
if (scenario === 'restored') draft.review = JSON.parse(sessionStorage.getItem('saved-review')!);
if (scenario === 'site-plan') {
  draft.review!.documents[0].documentType = 'SITE_PLAN';
  draft.documents[0].documentType = 'SITE_PLAN';
}
if (scenario === 'missing' || scenario === 'auto' || scenario === 'delayed') {
  draft.review!.client.email = null;
  for (const key of ['buildingNumber', 'addressLine1', 'townCity', 'postcode'] as const) draft.review!.client[key] = null;
}
if (scenario === 'default') {
  draft.review!.clientMode = 'existing';
  draft.review!.existingClientId = 'default-client';
  draft.review!.client.displayName = 'Prepared Name';
}
if (scenario === 'separate') {
  draft.review!.applicantDifferentFromClient = true;
  draft.review!.applicant = { ...draft.review!.client, displayName: 'James MacDonald', firstName: 'James', email: 'james@example.test' };
}
draft.issues = evaluateClientApplicationDraftReadiness(draft.review!);
createRoot(document.getElementById('root')!).render(scenario === 'agent-defaults'
  ? <AgentDefaultsForm organisationName="QA Practice" compact submitLabel="Save and resume application" />
  : <ApplicationDraftReview initialDraft={draft}
      documentTypes={[{value:'LOCATION_PLAN',label:'Location Plan'},{value:'SITE_PLAN',label:'Site / Block Plan'},{value:'BLOCK_PLAN',label:'Site / Block Plan'},{value:'OTHER',label:'Other'}]} typeOfWorkOptions={[]} certifierPresets={[]} />);
