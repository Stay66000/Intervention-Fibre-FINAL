# FIBRE OPS — branche d’essai Documents

Base : main a9cc11937e462c5fa63291adf0d3560a9d1f96c0.

## Application réelle

Le middleware charge documents-v2.js et documents-v2.css. Il ne charge aucun adaptateur de démonstration. L’authentification, les interventions, l’OCR, l’historique, les finances, les sociétés, les exports et les sauvegardes restent ceux de main.

Les documents sont rattachés au compte connecté : CRUD, filtres, statuts calculés depuis les dates saisies, plusieurs PDF/JPEG/PNG/WebP (20 fichiers maximum, 10 Mo chacun), consultation des photos et PDF, plein écran et téléchargement. Les anciens file_path restent consultables ; les nouveaux fichiers sont ajoutés dans professional_document_pages. La modification conserve les fichiers existants.

Le bucket professional-documents est privé. Les liens de consultation sont signés à la demande pour 60 secondes, puis le fichier est chargé en mémoire sans stockage persistant côté application. Les images sont libérées à la fermeture ou au changement de compte. Aucun accès société aux fichiers personnels n’est ajouté.

Les préférences de rappels sont enregistrées dans user_settings.preferences. Le rappel de fin de journée respecte les jours, l’heure locale, la tolérance et un maximum d’une apparition par jour sur le navigateur. Les rappels fonctionnent dans l’application ouverte. Web Push, envois par cron, vue employeur et téléchargement permanent hors ligne ne sont pas livrés par cette branche.

## Base de données

Aucune nouvelle migration n’est nécessaire sur le projet existant : la table professional_document_pages a déjà été créée par la migration distante 20261102101448. Le script supabase/security/proposed-document-pages.sql est une copie de référence de cette migration appliquée ; ne pas l’exécuter à nouveau sur ce projet.

Contrôle RLS réel du 2 novembre 2026 : deux identités synthétiques dans une transaction annulée. Lecture propriétaire autorisée, lecture/modification/suppression par l’autre identité refusées, ajout d’une page sur le document de l’autre identité refusé. Aucun compte synthétique n’a persisté. Les politiques Storage et le caractère privé du bucket ont été inspectés. Ce contrôle ne remplace pas un essai HTTP de téléversement et consultation avec un compte connecté.

## Aperçu privé de validation

`node scripts/build-private-preview.mjs` fabrique un aperçu avec le même contrôleur Documents que la branche réelle et un adaptateur de données local. Aucun service externe n’est contacté. Les fichiers d’exemple et les téléversements de cet aperçu restent dans IndexedDB. Les fonctions qui exigent un serveur (Google OAuth/Sheets, invitations, certaines opérations société/facturation) n’y sont pas validées de bout en bout.

`node scripts/build-private-preview.mjs --visual` restaure l’ancienne maquette Documents indépendante, conservée pour référence.

`npm test` vérifie les régressions, dont les interventions, les exports, la synchronisation Sheets, le cloisonnement de l’interface et les nouveaux parcours Documents.

## Cloudflare avant tout essai réel

Le propriétaire a demandé une préversion Cloudflare sur cette branche et choisi de ne pas activer Cloudflare Access. La préversion peut donc être accessible publiquement ; ne tester qu’avec des comptes et fichiers fictifs. Cette préversion utilise la base Supabase de production : ne modifier que des données explicitement réservées aux tests. Les paramètres et secrets nécessaires doivent être disponibles dans l’environnement Preview ; ne pas les copier dans les fichiers du dépôt. Aucun merge main n’est autorisé avant validation du propriétaire.

Essai à mener avec des fichiers fictifs : connexion email/mot de passe, création d’un document à deux fichiers, rechargement, ouverture de chaque page, plein écran/fermeture, ajout d’une troisième page, modification des dates et suppression. Confirmer ensuite une création, modification, suppression d’intervention et leur synchronisation sur le Sheet de test autorisé.
