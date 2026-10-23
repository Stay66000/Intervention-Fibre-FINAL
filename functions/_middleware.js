// FIBRE OPS — conformité / sécurité
// Modules amovibles injectés côté Cloudflare Pages.

class HeadInjector {
  element(element) {
    element.append('<link rel="stylesheet" href="/fibre-compliance.css?v=1">', { html: true });
  }
}

class BodyInjector {
  element(element) {
    element.append('<script src="/fibre-compliance.js?v=1"></script>', { html: true });
    element.append('<script src="/fibre-backend-security.js?v=1"></script>', { html: true });
  }
}

export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const type = response.headers.get('content-type') || '';

  if (context.request.method !== 'GET' || !type.includes('text/html') || url.pathname.startsWith('/legal/')) {
    return response;
  }

  return new HTMLRewriter()
    .on('head', new HeadInjector())
    .on('body', new BodyInjector())
    .transform(response);
}
