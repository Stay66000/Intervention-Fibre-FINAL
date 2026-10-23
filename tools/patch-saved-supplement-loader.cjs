const fs=require('fs');
let html=fs.readFileSync('index.html','utf8');
if(!html.includes('supplement-presets.js')){
  const anchor='<!-- FIBRE OPS TUTORIAL START -->';
  if(!html.includes(anchor))throw new Error('Ancre tutoriel introuvable');
  const block='<!-- FIBRE OPS SAVED SUPPLEMENTS START -->\n<script src="./supplement-presets.js?v=1"></script>\n<!-- FIBRE OPS SAVED SUPPLEMENTS END -->\n';
  html=html.replace(anchor,block+anchor);
}
html=html.replace('V3 Production 1.4','V3 Production 1.5');
fs.writeFileSync('index.html',html);
