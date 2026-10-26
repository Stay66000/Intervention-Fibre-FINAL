# Google Sheets — mode technicien sans prix

Cette règle fait partie de Société V2 et doit être appliquée par le worker Google côté serveur.

## Source d’autorité

`public.company_members.hide_prices = true` pour le technicien actif de la société.

Le trigger `private.enqueue_google_backup_intervention()` de `company-v2-preview.sql` marque alors chaque snapshot de job avec :

- `backup_price_visibility = "hidden"`
- suppression de `applied_amount`
- suppression de `agency_amount_snapshot`
- suppression des champs monétaires de `operator_data`

Le worker NE DOIT PAS tenter de reconstruire un prix à partir d’une autre table.

## Modèle mensuel lorsque les prix sont masqués

Colonnes visibles autorisées :

1. Date
2. N° intervention
3. Adresse client
4. Typologie raccordement
5. Réussite / Échec
6. Opérateur
7. Mode
8. Commentaire

Aucune colonne :

- Montant
- Total journalier
- Prix agence
- Tarif technicien
- Montant complément
- Total opérateur en euros
- Total mensuel en euros

Le récapitulatif latéral financier n’est pas créé.

## Journal technique masqué

Le journal conserve uniquement :

- Event ID
- Action
- Horodatage
- Date
- Référence
- Adresse
- Typologie
- Résultat
- Opérateur
- Mode
- Commentaire
- État
- ID FIBRE OPS

Aucun champ monétaire ne doit être présent, même dans une colonne masquée.

## Changement de visibilité

Le worker doit versionner séparément les deux modèles :

- `priced`
- `hidden`

Si le mode d’un technicien change et que la feuille mensuelle existante a un modèle incompatible, la feuille existante est archivée en lecture seule et une nouvelle feuille compatible est recréée avant toute nouvelle écriture. Ceci évite de laisser d’anciens montants visibles après activation de `hide_prices`.

## Contrôle de sécurité avant validation

Test obligatoire avec un technicien `hide_prices=true` :

- UI : aucun montant
- RPC catalogue : montant nul/0 sans prix agence
- RPC historique : aucun payout exposé
- REST direct : impossible de lire `agency_amount`, `applied_amount` ou `agency_amount_snapshot` des lignes société
- Google Sheet : aucune colonne financière
- `_JOURNAL_BACKUP` : aucune donnée financière
