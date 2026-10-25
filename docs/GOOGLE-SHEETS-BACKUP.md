# FIBRE OPS — sauvegarde Google Sheets par technicien

## Objectif

Chaque technicien peut relier son propre compte Google depuis **Profil > Mes sauvegardes**.
Le classeur est créé avec l'autorisation du technicien et appartient à son Google Drive.
FIBRE OPS ne demande pas l'accès complet au Drive : le flux utilise `drive.file`.

## Structure du classeur

- un onglet lisible par mois (`Octobre 2026`, `Novembre 2026`, etc.) ;
- un onglet caché `_JOURNAL_BACKUP`, append-only, qui conserve les événements de
  création, modification et suppression avec un identifiant d'événement ;
- les suppressions FIBRE OPS marquent une ligne `Supprimée dans FIBRE OPS` au lieu
  de l'effacer du backup.

Le journal caché sert de filet de récupération. Les onglets mensuels restent la
vue simple destinée au technicien.

## OAuth

Le client Google **Fibre Ops Drive Backup** utilise :

- `openid`
- `email`
- `https://www.googleapis.com/auth/drive.file`
- `access_type=offline`
- `prompt=consent`

Callback :

`https://dvvoqfswlqdwvxamfsot.supabase.co/functions/v1/google-drive-oauth-callback`

Les secrets restent dans les secrets Edge Functions :

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REDIRECT_URI`

Le refresh token est stocké côté serveur uniquement. Il n'est jamais envoyé au
navigateur ni exposé dans l'interface Platform Admin.

## File et limites

Un trigger PostgreSQL crée un job après chaque INSERT / UPDATE / DELETE d'une
intervention appartenant à un utilisateur ayant activé le backup.

Le worker :
- traite au maximum 12 jobs par exécution ;
- plafonne les tentatives à 30 par minute et 300 par 24 h et par utilisateur ;
- effectue au maximum 5 tentatives par job ;
- utilise les délais 1 min, 5 min, 15 min, puis 1 h ;
- réutilise le même ID d'événement dans le journal pour rendre les retries
  idempotents ;
- reprend les jobs bloqués depuis plus de 10 minutes.

Cron appelle le worker toutes les minutes. Ainsi un retry n'exige pas que le site
reste ouvert.

## Fonctions

- `google-drive-oauth-start` — prépare l'autorisation Google, JWT obligatoire ;
- `google-drive-oauth-callback` — callback Google, valide un `state` à usage unique ;
- `google-drive-backup-manager` — statut, retry et déconnexion pour l'utilisateur ;
- `google-drive-backup-worker` — worker interne protégé par secret serveur.

## Ancien Sheets TEST

Le pont Google Sheets TEST existant reste inchangé pendant la validation. Il ne
doit être supprimé qu'après un test de bout en bout du nouveau système.