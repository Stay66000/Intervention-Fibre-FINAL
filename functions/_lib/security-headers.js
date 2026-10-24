export function securityHeaders(nonce) {
  return {
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'nonce-"+nonce+"' 'strict-dynamic' 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://dvvoqfswlqdwvxamfsot.supabase.co wss://dvvoqfswlqdwvxamfsot.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://script.google.com https://script.googleusercontent.com; worker-src 'self' blob: https://cdn.jsdelivr.net; frame-src 'self'; upgrade-insecure-requests",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cache-Control': 'no-store',
  };
}
