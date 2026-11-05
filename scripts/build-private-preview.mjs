import fs from 'node:fs';
import path from 'node:path';
const functional=!process.argv.includes('--visual');
const root=process.cwd(), out=path.join(root,'dist');
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(root)){
  if(/\.(js|css|webmanifest)$/.test(name))fs.copyFileSync(path.join(root,name),path.join(out,name));
}
fs.cpSync(path.join(root,'legal'),path.join(out,'legal'),{recursive:true});
fs.copyFileSync('offline.html',path.join(out,'offline.html'));
if(fs.existsSync('icons'))fs.cpSync('icons',path.join(out,'icons'),{recursive:true});
let html=fs.readFileSync('index.html','utf8');
const middleware=fs.readFileSync('functions/_middleware.js','utf8');
const styles=[...middleware.matchAll(/<link rel="stylesheet" href="(\/[^"']+\.css\?v=\d+)">/g)].map(x=>'<link rel="stylesheet" href="'+x[1]+'">');
// The private demonstration has its own Documents screen. Keep the main-branch
// module in the source checkout, but don't mount a duplicate in this preview.
const scripts=[...middleware.matchAll(/src="(\/[^"']+\.js\?v=\d+)"/g)].filter(x=>functional||!x[1].startsWith('/documents-v2.js?')).map(x=>'<script src="'+x[1]+'"></script>');
// Reproduce Cloudflare's injection order in this static, isolated preview.
html=html.replace('</head>',styles.join('\n')+'\n<link rel="stylesheet" href="/preview-demo.css">\n<link rel="stylesheet" href="/documents-demo.css">\n</head>');
html=html.replace('</body>',scripts.join('\n')+'\n<script src="/preview-demo.js"></script>\n'+(functional?'':'<script src="/documents-demo.js"></script>')+'\n</body>');
html=html.replace(/const SUPABASE_URL='[^']+';/,"const SUPABASE_URL='https://preview.invalid';")
  .replace(/const SUPABASE_KEY='[^']+';/,"const SUPABASE_KEY='preview-local-only';")
  .replace(/if\('serviceWorker' in navigator[^\n]+/,'// No service worker in the private visual test.');
const csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; worker-src 'self' blob:; frame-src 'self'; form-action 'none'; base-uri 'self'; object-src 'none'";
html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="'+csp+'">\n<meta name="robots" content="noindex,nofollow">');
if(functional)html=html.replace('<body>','<body data-functional-preview="true">');
html=html.replace(/<body([^>]*)>/,'<body$1><aside class="preview-ribbon"><span>TEST PRIVÉ · DONNÉES FICTIVES</span><button type="button" id="previewReset">Réinitialiser</button></aside>');
fs.writeFileSync(path.join(out,'index.html'),html);
fs.copyFileSync('preview/preview-demo.js',path.join(out,'preview-demo.js'));
fs.copyFileSync('preview/preview-demo.css',path.join(out,'preview-demo.css'));
fs.copyFileSync('preview/documents-demo.js',path.join(out,'documents-demo.js'));
fs.copyFileSync('preview/documents-demo.css',path.join(out,'documents-demo.css'));
fs.copyFileSync('preview/qa.html',path.join(out,'qa.html'));
console.log('Private static preview built. Production backend replaced with local fixture adapter.');
