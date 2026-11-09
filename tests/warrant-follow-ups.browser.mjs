import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { renderPlanningForm, renderWarrantForm } from './fixtures/warrant-form-render.mjs';

// Real production page, real scripts and built CSS; isolated session/database delegates.
const output = path.resolve('output/warrant-follow-ups');
await fs.mkdir(output, { recursive: true });
const rendered = await renderWarrantForm();
const html = `<!doctype html><html lang="en"><head><title>Warrant functional verification</title><style>${rendered.css}</style></head><body><main class="mx-auto max-w-5xl p-5">${rendered.form}</main>${rendered.scripts.map(script => `<script type="module">${script}</script>`).join('')}</body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.setContent(html);
  await page.waitForTimeout(100);

  // Layout: sections in portal order, each follow-up directly under its own question.
  const visibleSections = await page.locator('[data-prep-section]').evaluateAll(sections => sections.filter(section => !section.hidden).map(section => section.id));
  assert.deepEqual(visibleSections, ['details', 'questions', 'sustainability', 'certificates', 'fee', 'declaration']);
  for (const [question, followUp, shownWhenTicked] of [
    ['applicantIsOwner', '[data-owner-details]', false],
    ['fireAndRescueServiceEnforcingAuthority', '[data-fire-authority-name]', false],
    ['listedBuildingOrConservationArea', '[data-listing-details]', true],
    ['otherHistoricalImportance', '[data-historical-details]', true],
    ['scottishMinistersRelaxationDirection', '[data-relaxation-details]', true],
    ['dangerousBuildingNotice', '[data-dangerous-references]', true],
    ['coveredBySTAS', '[data-stas-reference]', true],
  ]) {
    const row = page.locator(`[data-prep-question="${question}"]`);
    const tick = page.locator(`[name="${question}"]`);
    const panel = row.locator(followUp);
    assert.equal(await panel.count(), 1, `${followUp} sits inside the ${question} row`);
    await tick.setChecked(!shownWhenTicked);
    assert.equal(await panel.isVisible(), false, `${followUp} is hidden until ${question} asks for it`);
    await tick.setChecked(shownWhenTicked);
    assert.equal(await panel.isVisible(), true, `${followUp} appears for ${question}`);
    const controlBox = await row.locator('label').first().boundingBox();
    const panelBox = await panel.boundingBox();
    const gap = panelBox.y - (controlBox.y + controlBox.height);
    assert.ok(gap >= 0 && gap <= 24, `${followUp} is directly under ${question}, gap ${gap}px`);
    await tick.setChecked(!shownWhenTicked);
  }
  assert.equal(await page.locator('[data-prep-section="declaration"] [name="declarationAuthorised"]').count(), 1);
  assert.equal(await page.locator('[data-prep-section="certificates"] [name="approvedCertifierOfConstruction"]').count(), 1);

  // Missing answers: reported per section, and a blocked save reports through the summary.
  assert.equal(await page.locator('[data-prep-summary]').isVisible(), false, 'no error summary before a save attempt');
  assert.equal(await page.locator('[data-prep-section="details"]').getAttribute('data-state'), 'needs');
  assert.equal(await page.locator('[data-prep-section="questions"]').getAttribute('data-state'), 'done');
  await page.locator('form button.btn-primary').click();
  await page.waitForTimeout(50);
  assert.equal(await page.locator('[data-prep-summary]').isVisible(), true, 'a blocked save shows the summary');
  assert.equal(await page.locator('[data-prep-summary-link="details"]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-prep-summary')), true, 'a blocked save moves focus to the summary');
  assert.equal(await page.locator('[name="demolitionWeeks"]').getAttribute('aria-invalid'), 'true');
  await page.locator('[data-prep-summary-link="details"]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'conversionDescriptions', 'a summary link goes to the first missing answer');
  await page.locator('[name="conversionDescriptions"]').first().uncheck();

  assert.equal(await page.locator('[data-owner-details]').isVisible(), false);
  assert.equal(await page.locator('[name="registrationAPart1"]').isDisabled(), true);
  await page.locator('[name="conversionDescriptions"][value="C2"]').check();
  await page.locator('[name="demolitionWeeks"]').fill('4');
  await page.locator('[name="includesServices"]').check();
  assert.equal(await page.locator('form').evaluate(form => new FormData(form).get('includesServices')), 'on');
  await page.selectOption('[name="higherLevelsSustainability"]', 'false');
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), true, 'No design certifier does not require any registration fields');
  await page.selectOption('[name="designCertifierSelected"]', 'true');
  assert.equal(await page.locator('[name="registrationAPart1"]').isEnabled(), true);
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), false, 'chosen design certifier requires its registration details');
  await page.selectOption('[name="designCertifierSelected"]', 'false');
  await page.locator('[name="applicantIsOwner"]').uncheck();
  assert.equal(await page.locator('[data-owner-details]').isVisible(), true);
  assert.equal(await page.locator('[data-owner-manual]').isVisible(), false);
  await page.selectOption('[name="ownerIsClient"]', 'true');
  assert.equal(await page.locator('[data-owner-client]').isVisible(), true);
  assert.equal(await page.locator('[name="ownerFirstName"]').isDisabled(), true);
  await page.selectOption('[name="ownerIsClient"]', 'false');
  assert.equal(await page.locator('[data-owner-manual]').isVisible(), true);
  assert.equal(await page.locator('[name="ownerFirstName"]').isEnabled(), true);
  assert.equal(await page.locator('[name="ownerFirstName"]').evaluate(field => field.required), true);
  await page.locator('[name="fireAndRescueServiceEnforcingAuthority"]').uncheck();
  assert.equal(await page.locator('[data-fire-authority-name]').isVisible(), true);
  assert.equal(await page.locator('[name="fireAuthorityName"]').getAttribute('maxlength'), '20');
  for (const [question, field] of [['otherHistoricalImportance', 'historicalBuildingDetails'], ['dangerousBuildingNotice', 'dangerousBuildingReferences']]) {
    await page.locator(`[name="${question}"]`).check();
    assert.equal(await page.locator(`[name="${field}"]`).isVisible(), true);
    assert.equal(await page.locator(`[name="${field}"]`).evaluate(input => input.required), true);
    assert.equal(await page.locator(`[name="${field}"]`).getAttribute('maxlength'), '750');
  }
  await page.locator('[name="scottishMinistersRelaxationDirection"]').check();
  await page.locator('[name="relaxationDates"]').first().fill('2026-11-01');
  assert.equal(await page.locator('[name="relaxationDates"]').first().inputValue(), '2026-11-01');
  await page.locator('[name="relaxationReferences"]').first().fill('RD-1');
  await page.locator('[data-add-relaxation]').click();
  assert.equal(await page.locator('[data-relaxation-row]').count(), 2);
  await page.locator('[name="relaxationReferences"]').nth(1).fill('RD-2');
  await page.locator('[name="relaxationDates"]').nth(1).fill('2026-11-02');
  await page.selectOption('[name="approvedCertifierOfConstruction"]', 'true');
  assert.equal(await page.locator('[name="constructionSchemeType"]').isVisible(), true);
  assert.equal(await page.locator('[name="constructionRegistrationNumber"]').evaluate(field => field.required), true);
  await page.selectOption('[name="approvedCertifierOfConstruction"]', 'false');
  assert.equal(await page.locator('[data-construction-certificate]').isVisible(), false);
  assert.equal(await page.locator('[data-sustainability]').isVisible(), true);
  await page.selectOption('[name="higherLevelsSustainability"]', 'true');
  await page.selectOption('[name="sustainabilityMultipleBuildings"]', 'true');
  assert.equal(await page.locator('[name="sustainabilityBuildingCount"]').isVisible(), true);
  await page.selectOption('[name="sustainabilityDomesticUse"]', 'true');
  await page.selectOption('[name="sustainabilityNonDomesticUse"]', 'true');
  assert.equal(await page.locator('[name="sustainabilityDomesticLevels"]').count(), 8);
  assert.equal(await page.locator('[name="sustainabilityNonDomesticLevels"]').count(), 8);
  assert.equal(await page.locator('[name="sustainabilityDomesticLevels"]').first().locator('option').count(), 6);
  assert.equal(await page.locator('[name="sustainabilityDomesticLevels"]').nth(1).locator('option').count(), 3);
  for (const name of ['sustainabilityDomesticLevels', 'sustainabilityNonDomesticLevels']) {
    for (const field of await page.locator(`[name="${name}"]`).all()) await field.selectOption('gold');
  }
  const posted = await page.locator('form').evaluate(form => Object.fromEntries(['sustainabilityDomesticLevels', 'sustainabilityNonDomesticLevels'].map(name => [name, new FormData(form).getAll(name)])));
  assert.deepEqual(posted.sustainabilityDomesticLevels, Array(8).fill('gold'));
  assert.deepEqual(posted.sustainabilityNonDomesticLevels, Array(8).fill('gold'));
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  await page.selectOption('[name="higherLevelsSustainability"]', 'false');
  assert.equal(await page.locator('[data-sustainability-levels="domestic"]').isVisible(), false);
  assert.equal(await page.locator('[name="sustainabilityDomesticLevels"]').first().evaluate(field => field.required), false);
  await page.locator('[name="applicantIsOwner"]').check();
  assert.equal(await page.locator('[data-owner-details]').isVisible(), false);
  assert.equal(await page.locator('[name="ownerFirstName"]').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Browser: production preparation form, optional design certificate, conditional follow-ups, repeated directions, owner reuse, both matrices, serialization and mobile width passed.');

  // Project screening: entered at the top of the page when missing, through the existing screening route.
  const unscreened = await renderWarrantForm({ project: { id: 'test-project', name: 'Unscreened project', projectType: 'domestic_alteration_extension', buildingUse: null, typeOfWorkKeys: ['domestic_alteration_extension'],
    client: { id: 'test-client', name: 'Saved Client' }, site: { addressLine1: 'Test Street', townCity: 'Test Town', postcode: 'AB1 2CD' } } });
  const screeningForm = unscreened.html.match(/<form id="prep-screening"[^>]*>/)?.[0] ?? '';
  assert.ok(screeningForm && !/\shidden/.test(screeningForm), 'an unscreened project shows the screening form open at the top');
  assert.match(screeningForm, /data-screening-action="\/api\/projects\/test-project\/screener"/, 'screening saves through the existing project screening route');
  assert.ok(unscreened.html.indexOf('id="prep-screening"') < unscreened.html.indexOf('data-api-form'), 'screening comes before the application questions');
  assert.match(unscreened.html, /name="buildingUse"/);
  assert.match(unscreened.html, />Domestic alteration \/ extension</, 'work types use the portal wording');
  assert.match(rendered.html, /<form id="prep-screening"[^>]*\shidden/, 'a screened project keeps the screening form closed behind Change');

  // Planning: parking follows vehicle access and only posts when it applies.
  const planning = await renderPlanningForm();
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.setContent(`<!doctype html><html lang="en"><head><title>Planning functional verification</title><style>${planning.css}</style></head><body><main class="mx-auto max-w-5xl p-5">${planning.form}</main>${planning.scripts.map(script => `<script type="module">${script}</script>`).join('')}</body></html>`);
  await page.waitForTimeout(100);
  const parkingRow = page.locator('[data-prep-question="newOrAlteredVehicleAccess"]');
  const postedParking = () => page.locator('form').evaluate(form => new FormData(form).has('currentParkingSpaces'));
  assert.equal(await parkingRow.locator('[data-planning-parking]').count(), 1, 'parking sits inside the vehicle-access row');
  assert.equal(await page.locator('[name="currentParkingSpaces"]').isVisible(), false);
  assert.equal(await postedParking(), false);
  await page.locator('[name="applicationFee"]').fill('300');
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), true, 'no vehicle access needs no parking answers');
  await page.selectOption('[name="newOrAlteredVehicleAccess"]', 'true');
  assert.equal(await page.locator('[name="currentParkingSpaces"]').isVisible(), true);
  assert.equal(await page.locator('[name="proposedParkingSpaces"]').evaluate(field => field.required), true);
  assert.equal(await postedParking(), true);
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), false, 'vehicle access requires both parking answers');
  await page.locator('[name="currentParkingSpaces"]').fill('1');
  await page.locator('[name="proposedParkingSpaces"]').fill('2');
  assert.equal(await page.locator('form').evaluate(form => form.checkValidity()), true);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('[data-prep-section="questions"]').getAttribute('data-state'), 'done');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.selectOption('[name="newOrAlteredVehicleAccess"]', 'false');
  assert.equal(await page.locator('[name="currentParkingSpaces"]').isVisible(), false);
  assert.equal(await postedParking(), false);
  assert.deepEqual(errors, []);
  console.log('Browser: Planning form, parking follow-up and mobile width passed.');
} finally { await browser.close(); }
