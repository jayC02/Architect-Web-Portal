import { createRoot } from 'react-dom/client';
import ApplicationDraftReview from '../../src/components/applications/ApplicationDraftReview';
import { evaluateClientApplicationDraftReadiness } from '../../src/lib/application-draft-readiness';
import { clientReviewFixture } from './client-applicant-review';
import '../../src/styles/global.css';

const scenario = new URLSearchParams(location.search).get('state');
const draft = clientReviewFixture();
if (scenario === 'restored') draft.review = JSON.parse(sessionStorage.getItem('saved-review')!);
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
createRoot(document.getElementById('root')!).render(<ApplicationDraftReview initialDraft={draft}
  documentTypes={[{value:'LOCATION_PLAN',label:'Location Plan'},{value:'OTHER',label:'Other'}]} typeOfWorkOptions={[]} certifierPresets={[]} />);
