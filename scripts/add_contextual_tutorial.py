from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

start = '<!-- FIBRE OPS TUTORIAL START -->'
end = '<!-- FIBRE OPS TUTORIAL END -->'

if start in text or 'fibre-tutorial.js' in text or 'fibre-tutorial.css' in text:
    raise SystemExit('Le tutoriel semble déjà inclus dans index.html')

css = '''\n<!-- FIBRE OPS TUTORIAL START -->\n<link rel="stylesheet" href="./fibre-tutorial.css?v=1">\n<!-- FIBRE OPS TUTORIAL END -->\n'''
js = '''\n<!-- FIBRE OPS TUTORIAL START -->\n<script src="./fibre-tutorial.js?v=1"></script>\n<!-- FIBRE OPS TUTORIAL END -->\n'''

if '</head>' not in text or '</body>' not in text:
    raise SystemExit('Balises head/body introuvables')

text = text.replace('</head>', css + '</head>', 1)
text = text.rsplit('</body>', 1)[0] + js + '</body>' + text.rsplit('</body>', 1)[1]

if text.count(start) != 2 or text.count(end) != 2:
    raise SystemExit('Nombre de blocs tutoriel inattendu')

path.write_text(text, encoding='utf-8')
print('Hooks tutoriel ajoutés à index.html')
