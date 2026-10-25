-- FIBRE OPS — Société V2 / stratégie gratuite
--
-- IMPORTANT : ce fichier documente les ajouts V2 actifs sur le projet Supabase partagé.
-- Aucun DROP de policy existante ici : le site de production doit continuer à fonctionner
-- pendant toute la validation de la preview Cloudflare.
--
-- Migrations déjà appliquées de manière additive :
--   company_v2_additive_foundation
--   company_v2_google_backup_privacy_jobs
--   company_v2_google_backup_privacy_worker_schedule
--   company_v2_google_backup_privacy_service_rpc
--   company_v2_owner_index
--
-- Principes de sécurité :
-- 1. Les fonctions V2 ne sont pas exécutables par anon.
-- 2. Les actions patron vérifient l'appartenance et le rôle côté serveur.
-- 3. Les lectures technicien V2 expurgent les données financières masquées.
-- 4. L'édition technicien V2 n'autorise que les champs terrain.
-- 5. Si hide_prices=true, les snapshots Google sont expurgés avant envoi.
-- 6. Un worker séparé efface/masque les colonnes financières du classeur Google.
-- 7. Le verrouillage RLS final des anciennes lectures directes sera appliqué uniquement
--    après validation de la preview et bascule du front vers les RPC V2.

-- Colonnes société V2 :
-- companies.owner_user_id
-- companies.siret
-- companies.address_line1
-- companies.postal_code
-- companies.city
-- companies.country
-- companies.email
-- companies.phone
-- intervention_types.default_technician_amount

-- RPC V2 disponibles :
-- company_v2_create_self_company(...)
-- company_v2_get_profile()
-- company_v2_update_profile(...)
-- company_v2_admin_get_types()
-- company_v2_set_default_tariff(...)
-- company_v2_get_my_interventions()
-- company_v2_update_my_intervention(...)

-- Le trigger company_v2_seed_member_defaults_trigger initialise uniquement les tarifs
-- manquants des nouveaux techniciens à partir du tarif par défaut de la typologie.
-- Un tarif personnalisé existant n'est jamais écrasé.

-- Le trigger google_backup_privacy_refresh_trigger recrée les jobs de sauvegarde du
-- technicien lorsqu'un patron active/désactive hide_prices. Les jobs masqués ne contiennent
-- ni applied_amount, ni agency_amount_snapshot, ni montant de complément.

-- Le cron fibre_ops_google_backup_privacy_worker tourne chaque minute, en parallèle du
-- worker Google historique. Il n'est pas accessible publiquement : son endpoint exige le
-- secret interne x-fibre-worker et sa RPC de ciblage est réservée à service_role.

-- À NE PAS AJOUTER AVANT VALIDATION DE LA PREVIEW :
-- Toute policy restrictive qui empêcherait l'ancien front de lire/mettre à jour directement
-- les interventions société. Cette étape sera le verrouillage final au moment de la fusion.
