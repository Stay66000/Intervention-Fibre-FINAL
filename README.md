# FIBRE OPS — Production

Dépôt officiel de production de FIBRE OPS.

- Branche de production : `main`
- Hébergement : Netlify
- Dossier publié : racine du dépôt (`.`)
- Point d’entrée : `index.html`
- Supabase reste le backend de l’application.

## Déploiement

Une fois ce dépôt relié au site Netlify existant, chaque commit sur `main` déclenche automatiquement un nouveau déploiement.

## Règle de travail

`main` doit toujours rester déployable. Pour une grosse évolution, on privilégie une branche de travail puis une validation avant fusion.
