# Documents et rappels — preview Roadmap V2

La branche intègre le main `6b468d4e7582d747e9770783d552f0ba34749a23`.
Le déploiement concerne uniquement `feature/fibre-ops-roadmap-v2`. La PR reste en brouillon.

## Parcours

Réglages ouvre une page dans le flux de navigation, sans superposition ni renvoi vers Profil.
Cette page contient Déconnexion et l'accès à Mes documents professionnels.
Ajouter, modifier, filtrer et supprimer des documents est possible. Le fichier est facultatif.
Types : AIPR, CACES / R486, habilitation électrique, permis de conduire, visite médicale, autre.
La date d'expiration saisie est la seule référence. Le seuil d'alerte est réglable par document (0 à 365 jours).
Le jour de l'expiration est inclus dans « Expire bientôt » ; le lendemain passe en « Expiré ».

## Confidentialité

La base Supabase existante est partagée avec la production. La migration ajoute uniquement une table
`professional_documents`, ses droits RLS et le bucket privé `professional-documents`.
Les documents restent personnels, y compris pour les comptes société et administrateurs.
Les fichiers sont limités à 10 Mo (PDF, JPEG, PNG, WebP). Leur consultation utilise un lien signé valable 60 secondes.
Aucun fichier ni métadonnée document n'est placé dans le cache hors ligne ou dans Google Sheets.
Le remplacement crée un nouvel objet ; les politiques ne permettent pas d'écraser un objet existant.
L'ajout de ces ressources n'ajoute aucun abonnement. Les quotas gratuits du fournisseur restent applicables.

## Rappels

Une bannière signale les échéances à l'ouverture et pendant l'utilisation.
Le rappel intelligent de fin de journée est facultatif : après l'heure locale choisie, il apparaît
si aucune intervention personnelle n'est chargée pour la journée. Les saisies hors ligne non synchronisées
peuvent ne pas être prises en compte avant leur synchronisation. Les préférences sont stockées dans user_settings.
Une action permet de masquer la bannière pour aujourd'hui dans la session du navigateur.
Application fermée : aucun push, SMS ou email n'est envoyé. Aucun service payant ni publication sur les stores.

## Vérification

Tests Node : régressions existantes, navigation dédiée, CRUD des métadonnées, échappement du contenu,
statuts aux limites de dates (y compris année bissextile).
Vérification SQL transactionnelle avec annulation : lecture propriétaire, invisibilité pour un autre compte,
bucket privé et limite de taille.
La vérification visuelle automatisée n'a pas pu démarrer : erreur de lecteur Windows dans le navigateur de contrôle.

À tester sur iPhone : ajouter un PDF puis une image, ouvrir le fichier, remplacer le fichier,
modifier la date et le seuil, supprimer, activer le rappel de fin de journée, puis vérifier Déconnexion.
