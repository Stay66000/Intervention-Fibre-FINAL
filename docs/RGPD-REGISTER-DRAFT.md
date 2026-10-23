# FIBRE OPS — registre RGPD préparatoire

Document interne de travail. Ne pas publier comme document contractuel sans revue.

| Traitement | Données principales | Finalité | Base envisagée | Durée à finaliser |
|---|---|---|---|---|
| Comptes utilisateurs | nom, prénom, e-mail, rôle, statut, identifiants techniques | création et gestion du compte | exécution des CGU / contrat | durée du compte + délai de clôture |
| Authentification et sécurité | sessions, journaux techniques, événements de sécurité | sécurité, prévention des abus | intérêt légitime / obligation de sécurité | cible 6 à 12 mois pour logs, à confirmer |
| Interventions | références, adresses, typologies, résultat, commentaires, montants | gestion métier | exécution du service / sous-traitance pour compte société | durée définie par client + obligations applicables |
| Équipes et sociétés | appartenance, rôle, opérateurs, tarifs | collaboration et gestion société | exécution du service | durée d'appartenance + historique nécessaire |
| Facturation | émetteur, client pro, montants, échéances, documents | création et conservation des factures | exécution du service / obligation légale | jusqu'à 10 ans lorsque la conservation comptable s'applique |
| Captures OCR | fichier image temporaire | préremplissage | exécution du service | aucun stockage serveur prévu ; mémoire temporaire jusqu'à validation/abandon |
| Support | coordonnées, échanges, éléments fournis volontairement | assistance | exécution du service / intérêt légitime | durée nécessaire au traitement + archivage limité |

## Sous-traitants à documenter avant ouverture publique

- Cloudflare : hébergement/distribution.
- Supabase : authentification, base de données, fonctions serveur.
- Fournisseur d'e-mails transactionnels réellement actif en production.
- Tout autre prestataire recevant des données personnelles.

## Points à finaliser

- identité et coordonnées du responsable du traitement ;
- adresse vie privée/support ;
- durées précises de conservation ;
- procédure de suppression/export ;
- registre des accès administratifs sensibles ;
- liste finale des sous-traitants, régions et mécanismes de transfert ;
- procédure de violation de données ;
- analyse d'impact si l'échelle ou les risques futurs le justifient.
