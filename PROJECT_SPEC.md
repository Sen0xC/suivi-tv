# Suivi TV - Specification V1

## Objectif

Créer une PWA installable sur iPhone pour suivre les séries TV de façon plus directe qu'un catalogue de streaming. L'écran principal doit répondre à une question : quel épisode regarder ensuite ?

## Périmètre V1

- Bibliothèque sauvegardée en base locale.
- Recherche TMDB dans les séries et films.
- Ajout d'une série ou d'un film à la bibliothèque.
- Suivi par saison et épisode.
- Bouton principal `Marquer l'episode vu`.
- Progression automatique.
- Statuts : en cours, à regarder, en pause, terminée.
- Calendrier simple pour les sorties connues.
- Profil avec statistiques de base.

## Hors périmètre V1

- Assistant IA.
- Notifications iPhone.
- Import TV Time ou Trakt.
- Social, commentaires, listes publiques.
- Synchronisation multi-appareil.
- Recommandations personnalisées avancées.

## Décisions

- Le bouton central sert à ajouter rapidement une série.
- La V1 utilise Supabase si configuré, avec fallback local pour développer sans dépendance externe.
- TMDB est l'intégration prioritaire pour rechercher les séries et films.
- La clé TMDB reste côté serveur pour ne pas l'exposer dans le navigateur.
- La clé Supabase service role reste côté serveur dans `.env`.
- Le design reste sombre, avec accents vert, jaune et violet, mais l'ergonomie prime sur l'effet vitrine.

## Critère de réussite

L'utilisateur ouvre l'app, voit immédiatement son prochain épisode, le marque comme vu en un geste, et retrouve une bibliothèque correctement mise à jour.
