# Nettoyage Cloudflare / PWA

Plan de migration technique, sans changement de données Supabase.

## État validé
- Production branch Cloudflare : `main`
- Projet Cloudflare Pages : `intervention-fibre-final`
- Application statique, sans build applicatif nécessaire
- Publication depuis la racine du dépôt
- `_headers` présent pour les règles Cloudflare

## Étapes de nettoyage
1. Conserver `index.html` et `sw.js` en revalidation systématique côté navigateur.
2. Simplifier le service worker : réseau en priorité, cache uniquement comme secours.
3. Retirer toute transformation du HTML dans le service worker.
4. Migrer dans `index.html` les comportements encore assurés par `app-hotfix.js` :
   - accès facturation pour `technician`, `platform_admin` et `admin` dans l’espace personnel ;
   - état visuel cohérent de l’onglet Historique lors de l’ouverture de la facturation ;
   - classe `billing-solo` synchronisée avec l’accès facturation.
5. Enregistrer le service worker avec `updateViaCache: 'none'` afin de fiabiliser la détection des nouvelles versions.
6. Retirer `app-hotfix.js` du cache puis du dépôt.
7. Incrémenter la version du cache afin d’éliminer l’ancien cache PWA lors de l’activation du nouveau service worker.
8. Tester le tout sur une preview Cloudflare avant fusion sur `main`.

## Tests avant production
- connexion ;
- chargement des interventions existantes ;
- facturation depuis l’espace personnel platform admin ;
- ajout d’une intervention test ;
- modification ;
- suppression ;
- rechargement de la page ;
- fermeture/réouverture de la PWA ;
- mise à jour de la PWA après un nouveau déploiement ;
- ouverture hors ligne de l’interface sans prétendre qu’une écriture Supabase a réussi.
