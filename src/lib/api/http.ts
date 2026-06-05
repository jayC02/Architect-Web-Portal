export type ApiRequestOptions = RequestInit & {
  json?: unknown;
};

export const apiRequest = async <T = unknown>(url: string, options: ApiRequestOptions = {}) => {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(options.json);
  }

  const response = await fetch(url, {
    ...options,
    credentials: options.credentials ?? 'same-origin',
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : 'Request failed.');
  }

  return data as T;
};
