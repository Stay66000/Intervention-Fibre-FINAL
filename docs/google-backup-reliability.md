# Fiabilité du miroir Google Sheets — 30 octobre 2026

Supabase est la source de vérité. Le classeur personnel Google est un miroir de secours, par ID immuable en colonne S. L’interface et les verrous financiers de FIBRE OPS sont conservés.

## Risques trouvés et corrigés

- L’ancien bridge navigateur Apps Script écrivait en parallèle du worker OAuth. Il est retiré de la page principale ; les anciens outils TEST restent isolés.
- L’index était limité au mois cible, écrasait silencieusement les occurrences d’un même ID et calculait la prochaine ligne uniquement avec la colonne S. Le nouvel index couvre tous les onglets mensuels et tient compte des lignes sans ID, sans réserver les lignes du tableau récapitulatif K:N.
- Un déplacement de mois laissait une ligne dans l’ancien mois. Le déplacement, la suppression des doublons et l’écriture de la ligne cible utilisent maintenant un seul batch Google atomique.
- Les suppressions conservaient une réussite et son montant. Les cellules d’intervention A:J et O:S sont désormais vidées ; l’événement reste dans `_JOURNAL_BACKUP`. Les lignes physiques sont conservées vides pour ne pas décaler le tableau K:N ou les index. Aucun montant supprimé ne participe aux totaux.
- Deux workers pouvaient écrire dans le même classeur. Un bail Postgres par identifiant de classeur protège les lectures, l’index, la planification et l’écriture. Aucun index global mutable n’est partagé entre requêtes.
- Les jobs retardés réécrivaient leur ancien snapshot. Ils appliquent maintenant l’état Supabase actuel, avec les règles d’accès et de rémunération propres au destinataire. Une intervention supprimée ne peut donc pas être recréée par un ancien upsert.
- Les compléments sont déjà inclus dans `applied_amount` par les triggers SQL. Ils ne sont plus ajoutés une seconde fois. Le gain personnel en binôme et le bénéficiaire Solo sont calculés côté SQL ; les paiements société restent propres à chaque technicien.
- Les formules utilisant des virgules produisaient des erreurs sur le classeur français. Le séparateur dépend maintenant de la locale du fichier, et les formules du modèle sont mises à niveau en place (V4).
- Les valeurs saisies étaient interprétées comme des formules ou nombres par `USER_ENTERED`. Les données utilisateur passent maintenant par des cellules typées : les zéros initiaux et le texte commençant par `=` sont conservés littéralement.
- Les écritures n’étaient pas immédiates : seul le cron d’une minute réveillait le worker. Un trigger de statement sur la file déclenche maintenant pg_net après COMMIT. Une panne Google ou pg_net ne fait pas échouer l’enregistrement.
- Les événements étaient perdus pendant une erreur OAuth. La file conserve maintenant les changements pour toute connexion déjà configurée, même interrompue ; les jobs bloqués sont repris à la reconnexion.
- Toute erreur de métadonnées lors d’une reconnexion pouvait créer un nouveau classeur. Une reconnexion conserve désormais le même fichier ; une panne temporaire ne déclenche pas de création de remplacement. L’état OAuth est consommé atomiquement.
- Le worker de confidentialité exécutait des requêtes chaque minute et pouvait concurrencer le miroir. La confidentialité est intégrée au même écrivain sérialisé ; son ancienne route est un simple relais compatible et son cron est supprimé.

## Démarrage, ancien contenu et reprise

Une comparaison est demandée une fois par ouverture et par compte connecté, sans polling navigateur. Elle utilise une lecture Supabase groupée des snapshots autorisés, une lecture des métadonnées Google et un `values:batchGet` des mois et des clés du journal. Un état déjà cohérent n’entraîne pas d’écriture de données Google pour les comptes avec prix visibles.

Les écarts sont réparés depuis Supabase : lignes absentes, champs ou montants différents, doublons, mauvais mois et IDs supprimés. Les lignes sans ID ne sont jamais associées par référence/adresse/date : elles sont conservées dans `_LEGACY_BACKUP`, puis retirées du miroir actif. Les anciens onglets `_ARCHIVE ...` restent des archives, pas des mois actifs.

Les échecs de jobs utilisent au maximum cinq tentatives (60 s, 5 min, 15 min, 1 h). Le contrôle au démarrage a lui aussi un état de reprise durable avec backoff, même sans job d’intervention. Une erreur temporaire de token ne demande pas de reconnexion ; `invalid_grant` ou un 401 met la connexion en pause. Une relance manuelle peut réactiver les échecs.

Après un timeout ambigu lors de l’écriture, le bail reste réservé quatre minutes : Google peut encore traiter la requête pendant 180 secondes. La reprise relit le classeur et les IDs d’événement, au lieu de réutiliser un index supposé valide.

Le cron restant vérifie uniquement la présence de travail exigible en SQL. Sans travail, aucun appel Edge/Google n’est lancé. Il sert à la reprise, pas à un polling permanent des feuilles.

## Validation des 20 cas demandés

| Cas | Vérification |
|---|---|
| Création | Tests modèle/worker, trigger SQL en transaction annulée, API Google réelle sur fichier temporaire |
| Modification simple / adresse | Même ligne et même ID, tests automatisés et Google réel |
| Opérateur / résultat | Mapping du miroir vérifié sur Google réel ; les verrous financiers existants empêchant certaines modifications depuis l’application sont conservés |
| Montant / mode Solo-Binôme / complément | Snapshots actuels, gain personnel, complément inclus une seule fois, tests automatisés et Google réel |
| Date / changement de mois | Une seule occurrence active, ancien mois vidé et totaux 0/100 vérifiés sur Google réel |
| Suppression / recréation | Montant retiré, journal conservé, nouvel ID et ancien job rejoué testés |
| Panne temporaire Google | Jobs conservés, backoff, limite de tentatives ; pannes simulées reproductibles |
| Reconnexion Google | Callback testé avec mocks : même classeur, reprise des jobs, échec temporaire sans nouveau fichier, état OAuth à usage unique ; renouvellement du vrai token vérifié via l’API Google |
| Double clic / double envoi | Garde UI, clé `client_event_id` conservée après erreur ambiguë et contrainte SQL d’unicité existante |
| Deux modifications rapides | Le dernier état Supabase gagne, indépendamment de l’ordre des jobs |
| Comparaison au démarrage | Une demande par compte/ouverture, reprise durable, test navigateur jsdom et réparation réelle du classeur Brendan |
| Anciennes lignes sans ID | Archivage sans rapprochement approximatif, test automatisé et Google réel |
| Doublons existants | Une occurrence canonique dans le bon mois, test automatisé et Google réel |
| Rejeu après erreur | Timeout après commit et échec d’acquittement Supabase : aucune seconde ligne ni second événement de journal |

58 tests Node sont passés. Le contrôle réel Google a passé 17 assertions sur un classeur temporaire ensuite mis à la corbeille. Les tests SQL ont été exécutés avec annulation intégrale des fixtures et ont confirmé les droits du rôle worker sur 85 interventions autorisées.

La reconnexion interactive avec un nouveau consentement utilisateur n’a pas été exécutée : les tests ont couvert le callback et le renouvellement de l’autorisation existante.

## Déploiement et exploitation

Migration appliquée : `20261030213735_reliable_google_backup_mirror.sql`.

Fonctions déployées : `google-drive-backup-worker` V4, `google-drive-backup-manager` V2, `google-drive-oauth-callback` V5 et `google-drive-backup-privacy-worker` V3. La fonction de maintenance utilisée temporairement pour la validation Google a été restaurée à son code initial.

La première réconciliation du compte Brendan a corrigé 82 lignes, ajouté 3 lignes autorisées absentes et retiré 2 lignes fantômes. Aucun doublon n’a été détecté. La seconde comparaison réelle a confirmé zéro ligne manquante, modifiée, dupliquée, déplacée, supprimée ou sans ID, avec une connexion Google saine et aucune erreur.

Les RPC de travail et de source sont réservées à `service_role`. La lecture privilégiée des droits et paiements reste dans une fonction privée à `search_path` vide, sans exposer de SELECT supplémentaire sur les tables métier. Le bail possède RLS et aucun droit client ; son absence volontaire de policy client apparaît comme information dans les advisors. Aucun nouvel avertissement de sécurité n’est introduit.

Pour une validation manuelle ultérieure : enregistrer puis modifier une intervention, constater le même ID en S et le même événement dans le journal ; changer le mois et vérifier une seule occurrence active ; supprimer puis comparer. `supabase/tests/google_backup_mirror.sql` est un test transactionnel réservé à un environnement avec un seul compte explicitement connecté.
