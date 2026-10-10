import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
// Loopback-only provider stand-in used by isolated browser verification.
const root = path.resolve('output/workflow/mock-storage');
const files = new Map();
const resumable = new Map();
const server = http.createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', 'http://127.0.0.1:4330');
  response.setHeader('access-control-allow-methods', 'GET,PUT,POST,DELETE,OPTIONS,HEAD,PATCH');
  response.setHeader('access-control-allow-headers', 'content-type,x-upsert,authorization,apikey,x-signature,tus-resumable,upload-length,upload-offset,upload-metadata');
  response.setHeader('access-control-expose-headers', 'Location,Upload-Offset,Upload-Length,Tus-Resumable');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  const url = new URL(request.url, 'http://127.0.0.1:4331');
  if (url.pathname.startsWith('/storage/v1/upload/resumable')) {
    response.setHeader('Tus-Resumable', '1.0.0');
    if (!request.headers['x-signature']) { response.writeHead(403).end(); return; }
    let id = url.pathname.split('/')[5];
    let record = resumable.get(id);
    if (request.method === 'POST') {
      const metadata = Object.fromEntries(String(request.headers['upload-metadata'] ?? '').split(',').filter(Boolean).map(pair => { const [key, value] = pair.trim().split(' '); return [key, Buffer.from(value ?? '', 'base64').toString()]; }));
      if (!metadata.objectName?.startsWith('organisations/') || metadata.objectName.includes('..')) { response.writeHead(400).end(); return; }
      id = randomUUID(); record = { key: metadata.objectName, type: metadata.contentType, length: Number(request.headers['upload-length']), bytes: Buffer.alloc(0) }; resumable.set(id, record);
      response.setHeader('Location', `http://127.0.0.1:4331/storage/v1/upload/resumable/${id}`);
    }
    if (!record) { response.writeHead(404).end(); return; }
    if (request.method === 'HEAD') { response.setHeader('Upload-Length', String(record.length)); response.setHeader('Upload-Offset', String(record.bytes.length)); response.writeHead(200).end(); return; }
    if (request.method === 'PATCH' && Number(request.headers['upload-offset']) !== record.bytes.length) { response.writeHead(409).end(); return; }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    record.bytes = Buffer.concat([record.bytes, ...chunks]);
    if (record.bytes.length === record.length) {
      const destination = path.join(root, record.key); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, record.bytes);
      files.set(record.key, { size: record.length, mimetype: record.type });
    }
    response.setHeader('Upload-Offset', String(record.bytes.length)); response.writeHead(request.method === 'POST' ? 201 : 204).end(); return;
  }
  let key = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\/object\/(upload\/sign\/|info\/|)?mock-bucket\//, ''));
  if (!key.startsWith('organisations/') || key.includes('..')) { response.writeHead(400).end(); return; }
  const destination = path.join(root, key);
  const json = (status, data) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.pathname.includes('/upload/sign/')) { json(200, { url: `/object/mock-bucket/${key}`, token: 'loopback-test-token' }); return; }
  if (request.method === 'PUT') {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks); files.set(key, { size: bytes.length, mimetype: request.headers['content-type'] });
    await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes);
    json(200, { ok: true }); return;
  }
  if (request.method === 'DELETE') { await fs.rm(destination, { force: true }); files.delete(key); json(200, { ok: true }); return; }
  const bytes = await fs.readFile(destination).catch(() => null);
  if (!bytes) { json(404, { error: 'not found' }); return; }
  if (url.pathname.includes('/info/')) { json(200, { metadata: files.get(key) ?? { size: bytes.length, mimetype: 'application/pdf' } }); return; }
  response.writeHead(200, { 'content-type': files.get(key)?.mimetype ?? 'application/pdf' }); response.end(bytes);
});
server.listen(4331, '127.0.0.1', () => console.log('Isolated mock storage listening on loopback port 4331.'));
