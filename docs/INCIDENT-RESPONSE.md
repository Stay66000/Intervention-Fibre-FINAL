# FIBRE OPS — procédure interne incident / violation de données

Document interne préparatoire.

## 1. Détecter et contenir

- isoler la fonctionnalité ou la clé compromise ;
- révoquer les sessions/jetons concernés si nécessaire ;
- ne pas supprimer les journaux utiles à l'analyse ;
- empêcher la poursuite de l'accès non autorisé.

## 2. Qualifier

Documenter :
- date/heure de découverte ;
- systèmes concernés ;
- catégories de données ;
- volume approximatif ;
- catégories de personnes ;
- cause probable ;
- mesures de confinement ;
- conséquences possibles.

## 3. Évaluer le risque

Déterminer si l'incident constitue une violation de données personnelles et s'il présente un risque pour les droits et libertés des personnes.

## 4. Notification

Lorsque les conditions du RGPD sont réunies, préparer la notification à la CNIL dans les délais applicables. Si le risque est élevé, préparer également l'information des personnes concernées.

Même lorsqu'aucune notification externe n'est nécessaire, documenter la violation, l'analyse et la décision.

## 5. Informer un client société

Lorsque FIBRE OPS agit comme sous-traitant pour un client société, informer le client concerné sans retard indu avec les informations disponibles utiles à son analyse et à ses propres obligations.

## 6. Corriger et prévenir

- corriger la cause ;
- tester la correction ;
- faire tourner les clés si nécessaire ;
- réexaminer RLS/RPC/Edge Functions ;
- consigner les actions ;
- ajouter un test de non-régression sécurité.
