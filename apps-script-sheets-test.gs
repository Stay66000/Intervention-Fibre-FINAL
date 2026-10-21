const FIBRE_OPS_SHEET_ID = '1UqtwDaimRNjYcAcKO6Rzo_Z6NV0wQdsDuxeeG4zrZis';
const FIBRE_OPS_TECH = 'Brendan';
const FIBRE_OPS_VERSION = '2';

function fibreJson_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function fibreSheet_() {
  const ss = SpreadsheetApp.openById(FIBRE_OPS_SHEET_ID);
  const sheet = ss.getSheetByName(FIBRE_OPS_TECH);
  if (!sheet) throw new Error('Onglet Brendan introuvable');
  return sheet;
}

function fibreNorm_(value) {
  return String(value == null ? '' : value).trim();
}

function fibreDateFr_(value) {
  const s = fibreNorm_(value);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function fibreFindById_(sheet, id) {
  id = fibreNorm_(id);
  if (!id || sheet.getLastRow() < 2) return 0;
  const values = sheet.getRange(2, 15, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (fibreNorm_(values[i][0]) === id) return i + 2;
  }
  return 0;
}

function fibreWriteRow_(sheet, row, p) {
  // On ne touche pas aux colonnes calculées G et K:N.
  sheet.getRange(row, 1).setValue(fibreDateFr_(p.date));
  sheet.getRange(row, 2).setValue(fibreNorm_(p.num));
  sheet.getRange(row, 3).setValue(fibreNorm_(p.addr));
  sheet.getRange(row, 4).setValue(fibreNorm_(p.typo));
  sheet.getRange(row, 5).setValue(fibreNorm_(p.statut) || 'Réussite');
  sheet.getRange(row, 6).setValue(fibreNorm_(p.op));
  sheet.getRange(row, 8).setValue(fibreNorm_(p.solo) || 'Solo');
  sheet.getRange(row, 9).setValue(Number(p.montant) || 0);
  sheet.getRange(row, 10).setValue(fibreNorm_(p.comment));
  sheet.getRange(row, 15).setValue(fibreNorm_(p.id));
}

function fibreAppend_(sheet, p) {
  const id = fibreNorm_(p.id);
  if (!id) return { ok: false, error: 'id_required' };

  // Idempotence : un retry du même ajout ne crée jamais une deuxième ligne.
  const existing = fibreFindById_(sheet, id);
  if (existing) {
    fibreWriteRow_(sheet, existing, p);
    return { ok: true, action: 'update_existing_create', row: existing, id };
  }

  const previous = Math.max(2, sheet.getLastRow());
  const row = sheet.getLastRow() + 1;
  sheet.insertRowAfter(sheet.getLastRow());

  // Reprend le format de la ligne précédente, sans copier ses valeurs.
  if (previous >= 2) {
    sheet.getRange(previous, 1, 1, 15)
      .copyTo(sheet.getRange(row, 1, 1, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

    // Copie uniquement les formules des colonnes calculées G et K:N.
    const calcCols = [7, 11, 12, 13, 14];
    calcCols.forEach(col => {
      const formula = sheet.getRange(previous, col).getFormula();
      if (formula) {
        sheet.getRange(previous, col).copyTo(
          sheet.getRange(row, col),
          SpreadsheetApp.CopyPasteType.PASTE_FORMULA,
          false
        );
      }
    });
  }

  fibreWriteRow_(sheet, row, p);
  return { ok: true, action: 'create', row, id };
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (String(params.health || '') === '1') {
      return fibreJson_({
        ok: true,
        version: FIBRE_OPS_VERSION,
        supportsMutations: true,
        target: 'TEST FIBRE OPS - Suivis octobre - DUPLICATA',
        tech: FIBRE_OPS_TECH
      });
    }

    const sheet = fibreSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return fibreJson_([]);

    const values = sheet.getRange(2, 1, lastRow - 1, 15).getDisplayValues();
    const rows = values
      .filter(r => fibreNorm_(r[1]))
      .map(r => ({
        date: r[0],
        num: r[1],
        addr: r[2],
        typo: r[3],
        statut: r[4],
        op: r[5],
        solo: r[7],
        montant: Number(String(r[8] || '').replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0,
        comment: r[9],
        id: r[14]
      }));

    return fibreJson_(rows);
  } catch (err) {
    return fibreJson_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw) return fibreJson_({ ok: false, error: 'empty_body' });

    const p = JSON.parse(raw);
    const action = fibreNorm_(p.action).toLowerCase() || 'create';
    const sheet = fibreSheet_();

    if (action === 'create') return fibreJson_(fibreAppend_(sheet, p));

    const id = fibreNorm_(p.id);
    if (!id) return fibreJson_({ ok: false, error: 'id_required_for_' + action });

    const row = fibreFindById_(sheet, id);
    if (!row) {
      // Sécurité absolue : un update/delete introuvable ne devient JAMAIS un append.
      return fibreJson_({ ok: false, error: 'row_not_found', action, id });
    }

    if (action === 'update') {
      fibreWriteRow_(sheet, row, p);
      return fibreJson_({ ok: true, action: 'update', row, id });
    }

    if (action === 'delete') {
      sheet.deleteRow(row);
      return fibreJson_({ ok: true, action: 'delete', row, id });
    }

    return fibreJson_({ ok: false, error: 'unsupported_action', action });
  } catch (err) {
    return fibreJson_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
