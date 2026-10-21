# FIBRE OPS

Dépôt de production de **FIBRE OPS**, application de suivi des interventions fibre.

## Architecture de production
- **GitHub** : source de vérité du code
- **Cloudflare** : hébergement et déploiement
- **Supabase** : authentification, base de données et logique métier

## Déploiement
- Branche de production : `main`
- Application principale : `index.html`
- Publication : racine du dépôt (`.`)
- Aucun build applicatif requis : l’application est servie comme site statique
- Headers Cloudflare : `_headers`
- PWA : `manifest.webmanifest`, `sw.js`, `icons/`

Le projet Cloudflare doit être relié à ce dépôt. Chaque commit fusionné sur `main` peut déclencher un nouveau déploiement automatique selon la configuration Cloudflare.

## Données
Les données de production sont stockées dans Supabase et ne doivent jamais être recréées, remplacées ou réinitialisées lors d’un déploiement du front-end.

## Règles de maintenance
- Ne jamais exposer de clé `service_role` dans le front-end.
- Ne pas remettre d’anciens bots ou scripts de test dans le parcours de production.
- Tester ajout, modification et suppression d’une intervention avant toute mise en production importante.
- Conserver la compatibilité mobile et PWA.
