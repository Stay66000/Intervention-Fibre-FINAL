import { securityHeaders } from './_lib/security-headers.js';

export async function onRequest(context) {
  const upstream = await context.next();
  const type = upstream.headers.get('content-type') || '';
  if (context.request.method !== 'GET' || !type.includes('text/html')) return upstream;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const response = new Response(upstream.body, upstream);
  for (const [name,value] of Object.entries(securityHeaders(nonce))) response.headers.set(name,value);
  const pathname = new URL(context.request.url).pathname;
  const standalone = pathname.startsWith('/legal/') || pathname === '/offline.html';
  return new HTMLRewriter()
    .on('script', { element(element) { element.setAttribute('nonce', nonce); } })
    .on('head', { element(element) {
      if (!standalone) {
        element.append('<link rel="stylesheet" href="/fibre-compliance.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/google-backup.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/mobile-overrides.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/settings-final.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/mobile-ui-hotfix.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/company-v2.css?v=1">', { html: true });
        element.append('<link rel="stylesheet" href="/roadmap-v2.css?v=3">', { html: true });
      }
    } })
    .on('body', { element(element) {
      if (!standalone) {
        element.append('<script nonce="'+nonce+'" src="/fibre-compliance.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/supabase-compat.js?v=2"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/google-backup.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/settings-final.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/company-v2.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/company-v2-runtime-fix.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/capture-v2.js?v=3"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/offline-v2.js?v=3"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/billing-roadmap-v2.js?v=3"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/finance-v2.js?v=3"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/roadmap-v2-runtime.js?v=1"></script>', { html: true });
        element.append('<script nonce="'+nonce+'" src="/preview-auth-redirect.js?v=1"></script>', { html: true });
      }
    } })
    .transform(response);
}
