# Webhook Google Sheets TEST v2

Ce webhook est réservé au classeur `TEST FIBRE OPS - Suivis octobre - DUPLICATA`.

## Installation

1. Ouvrir le classeur TEST dans Google Sheets.
2. Extensions → Apps Script.
3. Remplacer le contenu du projet par le fichier `apps-script-sheets-test.gs` de ce dépôt.
4. Enregistrer.
5. Déployer → Gérer les déploiements → Modifier le déploiement Web App existant.
6. Créer une nouvelle version en conservant l'accès Web App déjà utilisé.
7. Vérifier que l'URL `/exec` reste celle utilisée par FIBRE OPS.

## Contrat v2

- `GET ?health=1` → `{ supportsMutations: true, version: "2" }`
- `GET ?tech=Brendan` → liste des interventions
- `POST` sans `action` → création idempotente par ID
- `POST action=update` → mise à jour par colonne O (ID), jamais d'append si ID absent
- `POST action=delete` → suppression par colonne O (ID), jamais d'append

Tant que le webhook v2 n'est pas actif, FIBRE OPS autorise uniquement les créations et bloque automatiquement update/delete pour éviter les doublons.
