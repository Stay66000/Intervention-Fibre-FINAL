# Backup backend FIBRE OPS — 2026-10-23

État sauvegardé avant activation de l'invitation technicien par e-mail et du durcissement backend.

Projet Supabase : `fibre-ops-production` (`dvvoqfswlqdwvxamfsot`, eu-west-3).

Cette branche contient le code applicatif complet avant la modification ainsi que les éléments SQL/Edge Function ciblés nécessaires à un rollback logique.

Points sauvegardés :
- Edge Function production `company-create-technician-access` v2 (mot de passe temporaire).
- Fonction `platform_list_companies()` avant réduction des données Platform Admin.
- Politiques RLS `profiles_company_peer_select` et `profiles_select_team_peer` avant suppression.

Aucune donnée utilisateur n'est copiée dans GitHub.
