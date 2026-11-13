import * as pdfjs from './vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// Group text fragments by their visual baseline; PDF extraction order alone is not
// sufficient for tables, especially when a cell is right aligned.
export function tableFromItems(pages) {
  let headers = null, starts = null;
  const output = [];
  for (const items of pages) {
    const lines = [];
    for (const item of items) {
      if (!item.str?.trim()) continue;
      const y = item.transform[5], x = item.transform[4];
      let line = lines.find(l => Math.abs(l.y - y) < 2);
      if (!line) lines.push(line = { y, items: [] });
      line.items.push({ ...item, x });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      const joined = norm(line.items.map(i => i.str).join(' '));
      if (/(REFINTER|REFERENCE|N°\s*OT|Nº\s*OT)/.test(joined) && /(MONTANT|REMUNERATION|TARIF|PRIX)/.test(joined)) {
        starts = line.items.map(i => i.x);
        headers = line.items.map(i => i.str.trim());
        if (!output.length) output.push(headers);
        continue;
      }
      if (!starts || !headers) continue;
      if (/^\s*(TOTAL|\d+\.?\s*(PENALIT|RETOUR)|CHECK VOISINAGE|PARTICIPATION|ACOMPTE|LOCATION)/.test(joined)) continue;
      const cells = headers.map(() => '');
      for (const item of line.items) {
        // Some exports combine adjacent numeric fields in one text fragment.
        const parts = item.str.trim().split(/\s+/);
        let offset = 0;
        for (const part of parts) {
          const x = item.x + (item.width || 0) * offset / Math.max(item.str.length, 1);
          let column = 0;
          for (let i = 1; i < starts.length; i++) if (x >= starts[i] - 2) column = i;
          cells[column] += (cells[column] ? ' ' : '') + part;
          offset += part.length + 1;
        }
      }
      // A reference-like value prevents totals, notes and wrapped labels entering
      // the reconciliation. Actual mapping is still confirmed by the user.
      if (cells.some(c => /\b\d{6,}\b/.test(c)) && cells.some(c => /^-?\d+[,.]?\d*\s*€?$/.test(c.trim()))) output.push(cells);
    }
  }
  if (!output.length || output.length === 1) throw new Error('Aucun tableau lisible détecté. Si le PDF est une image, utilise un PDF contenant du texte ou un fichier Excel/CSV.');
  return output;
}

export async function readPdfTable(buffer) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) pages.push((await (await pdf.getPage(n)).getTextContent()).items);
    return tableFromItems(pages);
  } finally { await pdf.destroy(); }
}
