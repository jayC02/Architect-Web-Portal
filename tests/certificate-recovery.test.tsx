import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import AutomationFailureRecovery from '../src/components/automation/AutomationFailureRecovery';
import { readAutomationFailureMetadata } from '../src/lib/automation/failure-recovery';

const metadata = readAutomationFailureMetadata({
  outcome: 'failed_retryable', failureCategory: 'CERTIFICATE_VALIDATION_FAILED', retrySafe: true,
  safeRetryPoint: 'main_details', currentSection: 'main_details',
  nextAction: 'Certifier registration was not found. Correct the saved certificate details before retrying.',
}, 'FAILED_RETRYABLE', 'main_details');
assert.equal(metadata.headline, 'Certifier details need correction');
assert.equal(metadata.recoveryAction, 'retry');
const html = renderToStaticMarkup(<AutomationFailureRecovery metadata={metadata} context={{
  client: null, site: null, applicationId: 'test-warrant', documentsHref: '/projects/test/documents', portalHref: null,
  typeOfWorkKeys: ['new_build'], typeOfWorkOptions: [], agentDefaults: null, organisationName: 'Test organisation', canManageAgentDefaults: false,
}} applicationType="BUILDING_WARRANT" retrying={false} onRetry={async () => {}} detailsHref="/automation-job/test-job" />);
assert.match(html, /href="\/building-warrant\/test-warrant\/preparation"/);
assert.match(html, /Correct certifier details/);
assert.match(html, /Certifier registration was not found/);
assert.match(html, /Retry application/);
console.log('Certificate recovery: observed correction message, canonical editor link and safe retry passed.');
