/** RFC 6266: ASCII fallback for older clients, UTF-8 filename for modern clients. */
export const documentContentDisposition = (mode: 'inline' | 'attachment', filename: string) => {
  const safe = new TextDecoder().decode(new TextEncoder().encode(filename))
    .replace(/[\u0000-\u001f\u007f"\\]/g, '_') || 'document';
  const fallback = safe.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
