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

## Condition bloquante avant activation publique et vente — décision du 27 octobre 2026

**Interdiction de modifier les interventions enregistrées d'un utilisateur via un accès administrateur, un assistant, un script de test ou une commande SQL de maintenance. Ne pas commercialiser tant que cette condition n'est pas mise en œuvre et vérifiée.**

Demande explicite de Brendan : « avant activation et vente du site cette option dois être totalement désactivé on ne dois plus pouvoir modifier les inter de qui que ce soit ».

- Les opérations exceptionnelles de cette bêta (ajout d'interventions fictives aux bots, corrections directes, rattachement des anciens imports) sont temporaires. Elles ne constituent pas une fonction d'administration disponible en production.
- Rendre les interventions enregistrées immuables en production : une éventuelle correction doit conserver l'original et passer par une procédure explicite, attribuée et tracée, sans réécriture silencieuse et sans modification par un tiers.
- Retirer les possibilités de modification depuis les rôles plateforme, société et autres utilisateurs ; faire respecter la règle côté serveur, RPC, permissions SQL et RLS. Masquer les boutons ne suffit pas.
- Retirer ou déconnecter l'accès d'écriture des assistants/connecteurs à la base de production ; révoquer les identifiants de test, scripts de peuplement et accès de maintenance capables de modifier les interventions. Les futurs essais doivent utiliser un environnement de test distinct.
- Terminer puis retirer les autorisations et mécanismes exceptionnels de transfert d'historique de bêta, notamment les approbations privées de rattachement vérifié, avant ouverture commerciale.
- Conserver les écritures techniques nécessaires aux nouvelles saisies et aux sauvegardes avec des droits strictement limités ; elles ne doivent pas donner un droit général de réécriture des anciennes interventions.
- Vérifier par des tests négatifs qu'un technicien, son binôme, un administrateur société, un administrateur plateforme et un ancien accès de test ne peuvent pas modifier les interventions enregistrées.
- La validation de ce verrou doit figurer dans la vérification finale avant activation des abonnements et première vente.

**Limite à traiter dans la gestion des accès :** la RLS ne bloque pas le propriétaire technique de la base ni un rôle PostgreSQL privilégié. Le respect de cette décision exige aussi le retrait des accès opérationnels privilégiés à la production, leur séparation de l'environnement de test et une gestion explicite de l'accès d'infrastructure. Ne jamais présenter une simple restriction de l'interface comme une impossibilité technique absolue pour le propriétaire de l'infrastructure.

Statut : **exigence enregistrée ; désactivation définitive à réaliser avant commercialisation.** Cette note ne révoque pas les accès actuels et ne constitue pas une validation de sécurité de la production.
