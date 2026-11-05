/* Domain operations for document pages. Storage and metadata are supplied by
 * the caller; these helpers never use a privileged credential. */
export const PAGE_TYPES = new Set(['application/pdf','image/jpeg','image/png','image/webp']);
export const MAX_PAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGES = 20;

export function validatePages(files, existingCount = 0) {
  if (!Number.isInteger(existingCount) || existingCount < 0) throw Error('Nombre de pages invalide');
  if (existingCount + files.length > MAX_PAGES) throw Error(`Maximum ${MAX_PAGES} pages par document`);
  for (const file of files) {
    if (!PAGE_TYPES.has(file.type)) throw Error('Choisis des fichiers PDF, JPG, PNG ou WebP');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PAGE_BYTES) throw Error('Chaque fichier doit peser entre 1 octet et 10 Mo');
  }
}

export function legacyPage(row) {
  return row?.file_path ? [{ path: row.file_path, name: 'Document existant', legacy: true }] : [];
}

// Obtain a short-lived link only when a page is opened. The server's Storage
// policy remains authoritative; the client check is additional protection.
export async function signedPageUrl({page, ownerId, currentOwner, sign, storageOrigin}) {
  if (!ownerId || currentOwner() !== ownerId) throw Error('Session modifiée');
  const path = String(page?.path || '');
  if (!path.startsWith(`${ownerId}/`) || path.split('/').some(part => !part || part === '.' || part === '..')) throw Error('Page inaccessible');
  const signed = await sign(path, 60);
  if (currentOwner() !== ownerId) throw Error('Session modifiée');
  const base = new URL(storageOrigin);
  const url = new URL(signed, base);
  if (base.protocol !== 'https:' || url.origin !== base.origin || !url.pathname.startsWith('/storage/v1/object/sign/professional-documents/')) throw Error('Lien de consultation invalide');
  return url.href;
}

// Uploads are committed to metadata as a batch. On failure, remove only the
// new objects; never remove a pre-existing page or the legacy file.
export async function appendPages({files, existingCount, ownerId, currentOwner, makeId, upload, commit, remove}) {
  validatePages(files, existingCount);
  if (!ownerId || currentOwner() !== ownerId) throw Error('Session modifiée');
  const uploaded = [];
  let commitAttempted = false;
  try {
    for (const file of files) {
      if (currentOwner() !== ownerId) throw Error('Session modifiée');
      const path = `${ownerId}/${makeId()}`;
      await upload(path, file);
      uploaded.push({ path, name: file.name, type: file.type, size: file.size });
    }
    if (currentOwner() !== ownerId) throw Error('Session modifiée');
    commitAttempted = true;
    await commit(uploaded);
    return uploaded;
  } catch (error) {
    // A lost acknowledgement can mean metadata was actually committed. The
    // caller must explicitly confirm no references exist before deleting.
    if (commitAttempted) {
      error.unconfirmedPages = uploaded;
    } else {
      const cleanup = await Promise.allSettled(uploaded.map(page => remove(page.path)));
      error.cleanupFailed = cleanup.some(result => result.status === 'rejected');
    }
    throw error;
  }
}
