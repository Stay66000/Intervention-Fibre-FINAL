# FIBRE OPS — Terrain V4, first five improvements

## Navigation

The five primary destinations are Home, History, New intervention, Finances and
Profile. Finances links to the existing invoice tools and fuel page. Profile links
to the existing tariff catalog and contains display settings, entry preferences,
backup status and the existing advanced settings. Company-administrator screens
and server permissions are unchanged.

## Faster entry

The default opening screen is New intervention, configurable in Profile.
Operator, type, result and work mode defaults are saved in the current user's
existing settings preferences. Types and teammates are validated against the
current account on application; a stale preference never authorizes access.
Existing drafts take precedence. Resetting preferences does not clear a draft.

Save and continue retains the choices/date and clears reference, address,
comment and one-off supplements. Both save buttons share an in-flight guard.
A confirmed write remains confirmed if the follow-up data read fails.

## Backup visibility

The Sheets beta transport remains enabled. The status card distinguishes:

- a database write acknowledged during this device session;
- queued beta writes;
- an opaque Sheets transmission with unverified receipt;
- the last transmitted change verified by a read of the beta Sheet.

Verification compares a SHA-256 fingerprint of the row's returned fields (or
absence after deletion). It certifies only the last change, never the full
historical backup. A mismatch or request failure never produces a green verified
state. Receipt metadata is scoped by account and contains no copied address or
comment. Existing beta outbox behavior and its known limitations remain; this
release does not create a new authenticated backup backend or offline database.

## History and presentation

History adds account-local remembered period/operator/result/work-mode/search
filters, card/table presentations, keyboard activation and an escaped detail
dialog. The existing edit dialog retains its financial locks and read-only
historical-company protection. Hidden prices are respected in all new views.
Operator colors, navigation icons, input focus/touch targets, spacing and
reduced-motion behavior are harmonized.

## Validation

`npm ci --ignore-scripts && npm test` runs pure filtering/preference tests,
DOM-based application workflow checks, mock Sheets receipt checks and the existing
security regression suite. All fixture identities and data are synthetic. UI and
receipt tests prevent real network access or supply mock network responses.
