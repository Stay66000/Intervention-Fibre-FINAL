const fs=require('fs');
let html=fs.readFileSync('index.html','utf8');
html=html.replace(/<!-- FIBRE OPS SAVED SUPPLEMENTS START -->[\s\S]*?<!-- FIBRE OPS SAVED SUPPLEMENTS END -->\s*/g,'');
const anchor='<!-- FIBRE OPS TUTORIAL START -->\n<script src="./fibre-tutorial.js?v=1"></script>';
if(!html.includes(anchor))throw new Error('Ancre du script tutoriel introuvable en bas de page');
const block='<!-- FIBRE OPS SAVED SUPPLEMENTS START -->\n<script src="./supplement-presets.js?v=2"></script>\n<!-- FIBRE OPS SAVED SUPPLEMENTS END -->\n';
html=html.replace(anchor,block+anchor);
fs.writeFileSync('index.html',html);
