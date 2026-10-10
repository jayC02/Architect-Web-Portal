// Test-process preload only. Never imported by the application or deployment.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === 'https://api.openai.com/v1/responses') return originalFetch('http://127.0.0.1:4331/__ai', init);
  if (url.includes('api.postcodes.io')) return Promise.resolve(Response.json({ status: 404, error: 'Synthetic postcode fixture' }, { status: 404 }));
  return originalFetch(input, init);
};
