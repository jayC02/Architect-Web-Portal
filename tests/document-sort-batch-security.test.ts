import assert from 'node:assert/strict';
import fs from 'node:fs';

const acceptRoute = fs.readFileSync('src/pages/api/document-sort-batches/[id]/accept.ts', 'utf8');
const createRoute = fs.readFileSync('src/pages/api/projects/[id]/document-sort-batches.ts', 'utf8');
const documentsHub = fs.readFileSync('src/pages/api/documents/hub.ts', 'utf8');
const documentsList = fs.readFileSync('src/pages/api/documents/list.ts', 'utf8');
const documentsUpload = fs.readFileSync('src/pages/documents/upload.astro', 'utf8');
const documentRoute = fs.readFileSync('src/pages/api/documents/[id].ts', 'utf8');
const sortReviewPage = fs.readFileSync('src/pages/projects/[id]/files/sort/[batchId].astro', 'utf8');
const documentFolder = fs.readFileSync('src/pages/documents/projects/[projectId].astro', 'utf8');
const documentFolderApi = fs.readFileSync('src/pages/api/documents/projects/[projectId].ts', 'utf8');

assert.match(acceptRoute, /requireOrganisation\(context\)/, 'accept route requires an authenticated organisation');
assert.match(acceptRoute, /where:\s*\{\s*id,\s*organisationId:\s*organisation\.id/s, 'accept route scopes batch lookup by organisation');
assert.match(acceptRoute, /projectDocument\.updateMany\(\{\s*where:\s*\{\s*id:\s*item\.documentId,\s*organisationId:\s*organisation\.id,\s*projectId:\s*batch\.projectId/s, 'accept route scopes document updates by organisation and project');
assert.match(acceptRoute, /documentSortBatchAcceptSchema/, 'accept route validates submitted document types');

assert.match(createRoute, /assertAllowedOrigin\(context\.request\)/, 'batch upload route checks request origin');
assert.match(createRoute, /assertRateLimit\(context,\s*rateLimitPolicies\.upload/s, 'batch upload route rate limits uploads');
assert.match(createRoute, /requireProjectAccess\(organisation\.id,\s*projectId\)/, 'batch upload route checks project ownership');
assert.doesNotMatch(createRoute, /organisationId\s*=\s*(?:form|body|context\.url)/, 'batch upload route does not trust submitted organisation ids');

assert.match(documentsHub, /requireOrganisation\(context\)/, 'documents hub endpoint requires an authenticated organisation');
assert.match(documentsHub, /where:\s*\{\s*organisationId:\s*organisation\.id\s*\}/s, 'documents hub project folders are organisation scoped');
assert.match(documentsHub, /where:\s*\{\s*organisationId:\s*organisation\.id\s*\}/s, 'documents hub document index is organisation scoped');
assert.match(documentsList, /requireOrganisation\(context\)/, 'documents list endpoint requires an authenticated organisation');
assert.match(documentsList, /organisationId:\s*organisation\.id/s, 'documents list endpoint is organisation scoped');
assert.match(documentsList, /documentsListQuerySchema\.parse/, 'documents list endpoint validates filters');
assert.match(documentsUpload, /where:\s*\{\s*organisationId:\s*auth\.organisation\.id\s*\}/s, 'documents upload project dropdown is organisation scoped');
assert.match(documentsUpload, /\/api\/projects\/\$\{projectSelect\.value\}\/document-sort-batches/, 'documents upload reuses the secured project batch upload API');
assert.match(documentsUpload, /This upload is locked to the current project/, 'project-scoped uploads do not ask the user to choose the same project again');
assert.match(createRoute, /submittedReturnTo === 'document-folder' \|\| submittedReturnTo === 'project-detail'/, 'batch upload preserves project-detail return routing');
assert.match(acceptRoute, /body\.returnTo === 'project-detail'/, 'accept route recognises project-detail return routing');
assert.match(acceptRoute, /#documents/, 'saving a project-scoped review returns to the project documents section');
assert.match(documentFolder, /where:\s*\{\s*id:\s*projectId,\s*organisationId:\s*auth\.organisation\.id\s*\}/s, 'project document folder access is organisation scoped');
assert.match(documentFolderApi, /requireProjectAccess\(organisation\.id,\s*projectId\)/, 'lazy project document folder endpoint checks project ownership');
assert.match(documentFolder, /data-action=\{`\/api\/projects\/\$\{project\.id\}\/document-sort-batches`\}/, 'project document folder reuses the secured project batch upload API');
assert.match(createRoute, /await requireProjectAccess\(organisation\.id,\s*projectId\)/, 'uploading from documents requires valid project membership through project access');
assert.match(acceptRoute, /allItemsAccepted \? DocumentSortBatchStatus\.ACCEPTED : DocumentSortBatchStatus\.NEEDS_REVIEW/, 'unchecked review items keep the batch needing review instead of being silently accepted');

console.log('document sort batch security tests passed');

assert.match(documentRoute, /requireOrganisation\(context\)/, 'document view route requires organisation session');
assert.match(documentRoute, /where:\s*\{ id, organisationId: organisation\.id \}/s, 'document view route scopes document lookup by organisation');
assert.match(documentRoute, /storageKey = assertSafeStorageKey/, 'document view route validates storage keys before reading files');
assert.match(sortReviewPage, /href=\{documentHref\}/, 'review filenames and open links use the secure document route');
assert.doesNotMatch(sortReviewPage, /storageUrl/, 'review page does not expose raw storage URLs');
assert.doesNotMatch(sortReviewPage, /Accept selected|Accept all high confidence|Select all|Deselect all|Expand low confidence only/, 'review page hides noisy bulk actions from the primary flow');