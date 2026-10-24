# Security hardening — 24 October 2026

The migration requires the existing FIBRE OPS schema. It does not delete business
data and is not a bootstrap migration for an empty database.

## Enforced boundaries

- All public tables require an active account. Invited accounts must finish
  provisioning and set a password before using business data. These checks use
  Auth-maintained fields and a private reservation table, never editable metadata.
- Personal/team policies cannot authorize writes into another company. Company
  catalogs require an active company administrator. Former team/company data are
  exposed only through the intended read-only history path.
- Hidden prices stay hidden in history and when returning to solo mode. Raw
  financial columns and profile authorization columns retain their restricted grants.
- Every existing authenticated SECURITY DEFINER business RPC additionally checks
  account readiness. Company administration reads also check company status.
- Invitations have company quotas, a globally unique pending email reservation,
  current-admin revalidation, atomic database provisioning and ownership-checked
  failure cleanup. Email delivery remains an external operation and cannot be
  made atomic with a database transaction. Unfinished provisioning is denied.
- Administrative changes are logged in a private audit table without secrets.
- Cloudflare HTML responses use a fresh CSP nonce and are not cached. Inline
  event attributes were removed. API/Auth responses must never enter PWA caches.

## Validation

Run `node --test tests/*.test.mjs` with Node 24.

Run `supabase/tests/security_boundaries.sql` against the existing schema after
the migration. The script creates synthetic accounts without sending mail, checks
company isolation, masked history, revoked mutations, disabled users, password
setup, quotas and service-only finalization, then rolls back all fixtures.
Run it in a single database connection; never remove its final ROLLBACK.

The SQL suite was also exercised on a local PostgreSQL-compatible engine seeded
with schema definitions only. No production user data was copied locally.

## Google Sheets beta — retained at the owner's request

The existing beta sync remains enabled. Its bridge, pull transport and Apps
Script retain their previous behavior. The HTML includes the same scripts and
CSP explicitly permits requests to script.google.com and its Googleusercontent
redirect. The sandbox iframe uses its parent's CSP nonce for copied/preloaded
scripts. No Google deployment is disabled or changed by this release.

The anonymous webhook's known risk remains deliberately outside this release.
Its future replacement should retain continuous independent backups and add
server-side authentication, signed requests, retry queues and versioned copies
before retiring the current beta integration.

## Operational limits

No security review guarantees perfect security. Mail delivery and the recipient's
full invitation flow need an end-to-end test with a controlled mailbox. Dependency
updates, audit-log retention and monitoring need ongoing maintenance. Existing
account settings (password minimum and no mandatory MFA) are preserved.

The production SQL regression suite passed in a rolled-back transaction. No
synthetic users remain. Nine Node regression tests passed. The preview login page and password-recovery navigation were checked in a
browser. HTTP checks confirmed no-store responses and matching script nonces.
Authenticated end-to-end browser flows were not completed. Real invitation email delivery
was deliberately not exercised with another person's mailbox.

Supabase Security Advisors still reports intentionally exposed guarded business
RPCs, private tables without client policies (closed by default), and disabled
leaked-password protection. Enable the latter in Authentication > Settings >
Password security if the project's plan supports it. This setting is outside
the connected tool's configuration capabilities and was not changed.
