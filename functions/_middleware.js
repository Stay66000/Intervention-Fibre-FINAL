import { securityHeaders } from './_lib/security-headers.js';

export async function onRequest(context) {
  const upstream = await context.next();
  const type = upstream.headers.get('content-type') || '';
  if (context.request.method !== 'GET' || !type.includes('text/html')) return upstream;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const response = new Response(upstream.body, upstream);
  for (const [name,value] of Object.entries(securityHeaders(nonce))) response.headers.set(name,value);
  const legal = new URL(context.request.url).pathname.startsWith('/legal/');
  return new HTMLRewriter()
    .on('script', { element(element) { element.setAttribute('nonce', nonce); } })
    .on('head', { element(element) {
      if (!legal) element.append('<link rel="stylesheet" href="/fibre-compliance.css?v=1">', { html: true });
    } })
    .on('body', { element(element) {
      if (!legal) element.append('<script nonce="'+nonce+'" src="/fibre-compliance.js?v=1"></script>', { html: true });
    } })
    .transform(response);
}
