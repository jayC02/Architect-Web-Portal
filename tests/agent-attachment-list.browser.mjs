import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = process.argv[2];
if (!root) throw new Error('Pass the Agent repository path as the first argument.');
const source = await readFile(path.join(root, 'automation/common/uploads.py'), 'utf8');
const script = source.match(/ATTACHMENT_LIST_SCRIPT = r"""([\s\S]*?)"""/)[1];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  for (const [fixture, expected, unattached] of [
    ['planning', ['D_23_050_Outline_Specification'], ['NotUploaded']],
    ['warrant', ['AP0123456789abcdef01'], []],
  ]) {
    await page.setContent(await readFile(path.join(root, `tests/fixtures/supporting-documents-${fixture}.html`), 'utf8'));
    const result = await page.evaluate(`(() => { ${script} })()`);
    assert.equal(result.recognized, true);
    assert.deepEqual(result.titles, expected);
    assert.deepEqual(result.unattached, unattached);
    assert.equal(result.paginated, false);
    if (fixture === 'warrant') assert.deepEqual(result.legacyRows, [{ editId: 'MainContent_SupportingDocumentationWizard_btnEdit2', attached: true }]);
    assert.ok(!result.titles.includes('HeadingOnly'));
    await page.locator('table tr:has(td)').evaluateAll(rows => rows.forEach(row => row.remove()));
    assert.deepEqual((await page.evaluate(`(() => { ${script} })()`)).titles, []);
    assert.equal((await page.evaluate(`(() => { ${script} })()`)).recognized, true);
  }
  console.log('Attachment reader verified in Chrome against the supplied Planning and Building Warrant table structures.');
} finally { await browser.close(); }
