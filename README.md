# FIBRE OPS

Application statique en HTML, CSS et JavaScript, avec Supabase pour Auth, REST et RPC.

## Production

- URL : https://intervention-fibre-final.pages.dev/
- Hébergement : **Cloudflare Pages**, dans le tableau de bord « Workers et Pages ».
- Dépôt : `Stay66000/Intervention-Fibre-FINAL`.
- Branche de production : `main`, déploiements automatiques activés (capture vérifiée le 21 octobre 2026).
- Point d’entrée : `index.html`. Aucun bundler ni installation npm requis.
- En-têtes Cloudflare : `_headers`.
- PWA existante : `manifest.webmanifest`, `sw.js`, `icons/`.

La commande de build, le répertoire publié et les variables du tableau de bord restent à vérifier dans les paramètres Cloudflare. Le code actuel est servi directement et n’effectue aucune substitution de variables d’environnement. La clé Supabase présente dans le navigateur est une clé **publishable**, pas une clé administrateur.

## Vérification locale

Exécuter depuis la racine :

```sh
node --test tests/interventions.test.cjs
python -m http.server 8000
```

Les tests utilisent des réponses simulées et ne contactent pas Supabase. L’application ouverte localement pointe toutefois vers la **production** : ne pas y saisir de données de test sans environnement isolé.

## Données et sécurité

Ne pas réinitialiser la base. Les montants historiques sont calculés et protégés côté serveur. Les droits de lecture sont définis par colonne : éviter `select('*')` sur les interventions.

La suppression passe par `delete_my_intervention`. Pour certaines anciennes interventions de binôme, elle masque la ligne pour l’utilisateur courant et conserve les données du partenaire.

**Attention : `sheets-test.html` n’est pas un environnement isolé.** Cette page charge l’application principale et permet un import manuel dans la même base de production. Ne pas considérer ses données comme jetables. Ne pas supprimer cet outil sans vérifier son usage.

## Retour arrière

Utiliser le retour à un déploiement Cloudflare précédent ou un commit Git de réversion. Le lot de fiabilité ne modifie ni le schéma ni les données existantes. Une restauration du front-end n’est pas une restauration de la base.
