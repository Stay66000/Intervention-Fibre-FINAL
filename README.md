# FIBRE OPS

Dépôt de production de **FIBRE OPS**, application de suivi des interventions fibre.

## Architecture de production
- **GitHub** : source de vérité du code
- **Cloudflare Pages** : hébergement et déploiement
- **Supabase** : authentification, base de données et logique métier

## Déploiement
- Branche de production : `main`
- Application principale : `index.html`
- Publication : racine du dépôt (`.`)
- Aucun build applicatif requis : l’application est servie comme site statique
- Headers Cloudflare : `_headers`
- PWA : `manifest.webmanifest`, `sw.js`, `icons/`

Le projet Cloudflare `intervention-fibre-final` est relié à ce dépôt. Les branches peuvent recevoir une preview et chaque modification fusionnée sur `main` déclenche le déploiement de production.

## Cache / PWA
- `index.html`, `sw.js` et `manifest.webmanifest` sont revalidés via les headers Cloudflare.
- Le service worker privilégie le réseau et utilise le cache seulement comme secours hors ligne.
- Le service worker ne modifie pas le HTML et n’injecte aucun script applicatif.
- Les anciens caches FIBRE OPS sont supprimés lors de l’activation d’une nouvelle version du service worker.

## Données
Les données de production sont stockées dans Supabase et ne doivent jamais être recréées, remplacées ou réinitialisées lors d’un déploiement du front-end.

## Règles de maintenance
- Ne jamais exposer de clé `service_role` dans le front-end.
- Ne pas remettre d’anciens bots, hotfix injectés ou scripts de test dans le parcours de production.
- Avant une modification importante, valider la preview Cloudflare et la syntaxe JavaScript.
- Après déploiement, tester connexion, ajout, modification, suppression, rafraîchissement et installation PWA.
- Conserver la compatibilité mobile.
