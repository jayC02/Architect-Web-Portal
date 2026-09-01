import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const settings = source('src/pages/settings.astro');
for (const destination of ['Practice', 'Certifiers', 'Integrations', 'Preferences']) {
  assert.match(settings, new RegExp(`title: '${destination}'`), `Settings links to ${destination}`);
}
assert.doesNotMatch(settings, /Desktop job history|Automatic workflow reminders|workflowTargets/, 'internal automation configuration is absent from the Settings landing page');

const practicePage = source('src/pages/settings/practice.astro');
const practiceForm = source('src/components/live/DirectoryEditor.tsx');
assert.match(practicePage, /<AgentDefaultsForm/, 'Practice reuses the canonical organisation defaults form');
assert.match(practiceForm, /data-action="\/api\/settings\/organisation-defaults"/, 'Practice saves through the existing persistence action');
assert.match(practiceForm, />Practice details</);
assert.match(practiceForm, />Default application contact</);
for (const field of ['practiceName', 'agentFirstName', 'agentLastName', 'agentEmail', 'agentPhone', 'agentBuildingNumber', 'agentAddressLine1', 'agentAddressLine2', 'agentTownCity', 'agentPostcode', 'agentCountry']) {
  assert.match(practiceForm, new RegExp(`name="${field}"`), `Practice hydrates and saves ${field}`);
}
assert.doesNotMatch(practiceForm, /name="defaultCertifierPresetId"/, 'default certifier is managed naturally in Certifiers');

const certifierPage = source('src/pages/settings/certifiers.astro');
const certifierSettings = source('src/components/settings/CertifierSettings.tsx');
assert.match(certifierPage, /organisationCertifierPreset\.findMany/, 'saved certifiers hydrate from the canonical model');
assert.match(certifierSettings, /Saved certifiers/);
assert.match(certifierSettings, /showModal\(\)/, 'Add and Edit use a contextual modal');
assert.match(certifierSettings, /editing \? 'PATCH' : 'POST'/, 'the shared editor persists through existing create and update actions');
assert.match(certifierSettings, /Use as organisation default/);
assert.match(certifierSettings, /Default<\/span>/, 'the organisation default is visible in the compact list');

const dashboard = source('src/pages/dashboard.astro');
const setupCard = source('src/components/dashboard/DesktopAutomationSetupCard.tsx');
assert.match(dashboard, /<DesktopAutomationSetupCard client:idle/);
assert.match(setupCard, /\/api\/settings\/desktop-agents/, 'Dashboard uses the existing Agent status API');
assert.match(setupCard, /agent\.connected && agent\.usable && !agent\.revokedAt/, 'only a connected compatible Agent hides setup onboarding');
assert.match(setupCard, /onConnected=\{\(\) => setVisible\(false\)\}/, 'setup card disappears immediately after connection');

const launch = source('src/components/automation/AutomationLaunchButton.tsx');
assert.match(launch, /Desktop Agent required/);
assert.match(launch, /dialogRef[\s\S]*showModal\(\)/, 'no-Agent Run opens the contextual setup modal');
assert.match(launch, /`\/api\/automation-jobs\/\$\{jobId\}\/run`/, 'Run still authorises the existing queued job');
assert.match(launch, /Your application is safely queued/, 'queued application continuity is explained');
assert.match(launch, /Your queued application will start automatically/, 'connection requires no second Run');
assert.doesNotMatch(launch, /window\.location.*settings|href=.*settings/, 'contextual setup does not navigate to Settings');

const integrations = source('src/pages/settings/integrations.astro');
const setupFlow = source('src/components/integrations/AgentSetupFlow.tsx');
for (const state of ['Download & connect Agent', 'Connected and ready', 'Agent is offline', 'Open Agent', 'Reinstall Agent']) {
  assert.match(setupFlow, new RegExp(state.replace('&', '\\&')), `Integrations exposes ${state}`);
}
assert.match(integrations, />View automation history</, 'run history remains available as secondary troubleshooting');
assert.match(source('src/pages/api/settings/desktop-agents/index.ts'), /agentSupportsJob/, 'Agent usability reuses the existing central compatibility contract');

const preferences = source('src/pages/settings/preferences.astro');
assert.doesNotMatch(preferences, /offsetDays|days.*input|WorkflowTarget/, 'Preferences does not reproduce lifecycle offsets');

const styles = source('src/styles/global.css');
assert.match(settings, /md:grid-cols-2/, 'Settings cards collapse to one column below the content breakpoint');
assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.settings-dialog/, 'drawers remain usable on small screens');
assert.match(styles, /prefers-reduced-motion: reduce/, 'motion respects the user preference');

console.log('settings simplification UI tests passed');
