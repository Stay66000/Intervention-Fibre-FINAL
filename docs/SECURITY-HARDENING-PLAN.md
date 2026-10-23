# FIBRE OPS — plan de durcissement sécurité

Branche de test uniquement. Aucun changement Supabase de production n'est appliqué par ce document.

## Décisions validées

- Mot de passe minimum conservé à 8 caractères pour le moment.
- Pas de 2FA pour le moment.
- Session persistante : la recharge ou la réouverture ne doit pas déconnecter un utilisateur tant que la session peut être renouvelée. Une déconnexion explicite, une révocation, un changement d'identifiants ou la suppression du stockage local peuvent mettre fin à la session.
- Création d'un technicien société : remplacer la génération de mot de passe temporaire par une invitation e-mail ; le technicien définit lui-même son mot de passe.
- Platform Admin : aucun accès métier courant aux interventions, factures, montants, adresses ou historiques privés.
- Isolation stricte par utilisateur / société / binôme via contrôles serveur et RLS.
- Capture OCR : locale, consultable pendant la saisie, nettoyée après sauvegarde réussie.

## État déjà constaté

- Toutes les tables publiques auditées ont la RLS activée.
- Le frontend utilise une clé Supabase publiable, pas une clé serveur secrète.
- Les sessions sont déjà conservées dans localStorage avec refresh token et renouvellement automatique.
- Le projet Supabase de production est en région eu-west-3.

## Points à corriger avant ouverture large

1. Auditer les fonctions SECURITY DEFINER exposées aux utilisateurs authentifiés et conserver uniquement celles qui sont intentionnelles et sécurisées.
2. Remplacer `company-create-technician-access` par une fonction d'invitation sans mot de passe communiqué à l'Admin Société.
3. Retirer `admin_email` de `platform_list_companies()` afin que le Platform Admin n'ait pas cet accès par défaut.
4. Réduire l'accès des techniciens aux profils complets des collègues ; exposer uniquement les champs strictement nécessaires à l'UX.
5. Ajouter une journalisation des opérations administratives sensibles avant commercialisation.
6. Définir et documenter les durées de conservation.
7. Ajouter une procédure d'export/suppression de compte compatible avec les obligations légales de conservation.

## Déploiement conseillé

- Étape 1 : valider visuellement la branche Cloudflare de test.
- Étape 2 : déployer l'Edge Function d'invitation et modifier l'UI de création employé.
- Étape 3 : appliquer les migrations de durcissement RLS/RPC après tests multi-comptes.
- Étape 4 : re-lancer les Security Advisors Supabase.
- Étape 5 : tester deux techniciens de sociétés différentes et vérifier qu'aucun identifiant manipulé côté navigateur ne permet un accès croisé.
- Étape 6 : fusionner dans `main` seulement après validation.
