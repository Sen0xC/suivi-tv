# Suivi TV

Suivi TV est une webapp personnelle pour suivre ses series et films, savoir quoi regarder ensuite, garder sa progression episode par episode, organiser ses listes et recevoir des suggestions basees sur ses goûts.

L'app fonctionne comme une PWA : elle peut etre ouverte sur mobile, ajoutee a l'ecran d'accueil iOS, et utilise un cache local pour charger l'interface plus rapidement.

## Fonctionnalites

- Recherche de series et films via TMDB.
- Ajout de titres dans une bibliotheque personnelle.
- Suivi de progression par saison et episode.
- Validation ou retrait d'un episode vu.
- Validation d'une saison complete.
- Marquage `Coup de coeur` pour mieux guider les suggestions.
- Suggestions personnalisees basees sur la bibliotheque, avec plus de poids sur les coups de coeur.
- Calendrier des sorties a venir avec dates francaises et episode diffuse.
- Affichage des plateformes de visionnage quand TMDB / JustWatch les fournit.
- Creation de listes personnelles de series et films.
- Ajout d'amis par code ami avec relation reciproque automatique.
- Profil avec statistiques, repartition, activite recente, amis et listes.
- Sauvegarde utilisateur via Supabase.
- Fallback local dans `data/database.json` si Supabase n'est pas configure.

## Stack

- Frontend : HTML, CSS, JavaScript vanilla.
- Backend : Node.js natif avec serveur HTTP.
- Base de donnees : Supabase REST API.
- Donnees catalogue : TMDB API.
- PWA : `manifest.webmanifest` + service worker.

## Prerequis

- Node.js 20 ou plus recent.
- Un compte TMDB avec une cle API ou un token Bearer.
- Un projet Supabase si tu veux sauvegarder les donnees en ligne.

## Installation

```bash
npm install
```

Copie ensuite `.env.example` vers `.env`, puis remplis les variables utiles.

```env
PORT=4173
APP_USER_ID=local-user
APP_USER_NAME=Cyril

TMDB_READ_ACCESS_TOKEN=ton_token_tmdb
TMDB_API_KEY=ta_cle_tmdb_optionnelle

SUPABASE_URL=https://ton-projet.supabase.co
SUPABASE_SECRET_KEY=ta_cle_service_role_ou_secret_key
```

## Lancer en local

```bash
npm start
```

Puis ouvrir :

```text
http://localhost:4173
```

Pour verifier rapidement que le serveur repond :

```bash
npm run health
```

Pour verifier la syntaxe du code :

```bash
npm run check
```

## Configuration TMDB

TMDB sert a recuperer :

- les resultats de recherche ;
- les affiches et images ;
- les saisons et episodes ;
- les titres d'episodes ;
- les dates de sortie connues ;
- les plateformes de visionnage quand disponibles.

Variable recommandee :

```env
TMDB_READ_ACCESS_TOKEN=...
```

Fallback accepte :

```env
TMDB_API_KEY=...
```

Sans TMDB, l'app reste lancee, mais elle utilise seulement un petit catalogue local de secours.

## Configuration Supabase

1. Cree un projet Supabase.
2. Ouvre le SQL Editor.
3. Execute tout le fichier :

```text
supabase/schema.sql
```

4. Ajoute tes variables Supabase dans `.env`.

Le schema cree les tables suivantes :

- `suivi_users`
- `suivi_media`
- `suivi_library`
- `suivi_friendships`
- `suivi_lists`
- `suivi_list_items`

Important : `SUPABASE_SECRET_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` doit rester uniquement dans `.env`. Ne jamais l'exposer dans du code frontend ou dans GitHub.

## Structure du projet

```text
SuiviTV/
  app.js                  # Interface et logique navigateur
  server.js               # Serveur Node, API locale, TMDB, Supabase
  styles.css              # Design responsive / PWA
  index.html              # Shell HTML
  manifest.webmanifest    # Installation PWA
  sw.js                   # Service worker et cache
  supabase/schema.sql     # Schema Supabase complet
  api/index.js            # Entrypoint Vercel pour les routes API
  vercel.json             # Rewrites Vercel pour /api/*
  scripts/smoke-test.js   # Test de parcours complet
  data/database.json      # Fallback local, ignore par Git
  icons/                  # Icones PWA
```

## Donnees utilisateur

Avec Supabase configure, les donnees sont sauvegardees en ligne.

Sans Supabase, l'app utilise :

```text
data/database.json
```

Ce fichier est ignore par Git pour eviter de publier tes donnees personnelles.

## Suggestions

Le systeme de suggestions utilise les titres deja suivis comme base.

Les titres marques en `Coup de coeur` sont volontairement plus importants : ils sont pris en compte avec un poids plus fort. Les autres titres restent quand meme utilises, mais avec moins d'influence.

Objectif : eviter que l'app recommande uniquement selon un seul titre, tout en comprenant mieux ce que tu as vraiment aime.

## Calendrier

Le calendrier affiche les sorties connues par TMDB pour les series suivies.

Quand TMDB fournit l'episode a venir, l'app affiche :

- la date au format francais ;
- la saison ;
- le numero d'episode ;
- le titre de l'episode si disponible ;
- une vignette d'episode ou, a defaut, une image de la serie.

TMDB ne donne pas toujours une vraie heure francaise de disponibilite par plateforme. Dans ce cas, l'app affiche la date sans inventer une fausse heure.

## PWA iOS

Sur iPhone :

1. Ouvre l'app dans Safari.
2. Appuie sur le bouton de partage.
3. Choisis `Sur l'ecran d'accueil`.

La webapp utilisera le manifest et le service worker pour se comporter davantage comme une app mobile.

## Amis

Chaque utilisateur possede un code ami visible dans son profil.

Fonctionnement :

- copie ton code ami depuis la page Profil ;
- partage-le a un autre utilisateur ;
- l'autre utilisateur colle ce code dans le champ `Coller le code ami` ;
- si le code existe, la relation est creee automatiquement dans les deux sens.

Un ami peut ensuite voir un resume simple de ton activite partagee : titres en cours, titres termines et dernier titre pertinent.

Le systeme refuse :

- un code vide ;
- son propre code ;
- un code qui ne correspond a aucun utilisateur.

## Tests

Verification syntaxique :

```bash
npm run check
```

Test smoke complet contre le serveur local :

```bash
npm start
npm run test:smoke
```

Le test smoke cree des comptes temporaires et valide :

- creation de compte ;
- session utilisateur ;
- recherche ;
- ajout bibliotheque ;
- favori ;
- episode vu ;
- creation de liste ;
- ajout a une liste ;
- ajout ami ;
- edition du profil.

Pour tester une URL de preview Vercel :

```bash
$env:SMOKE_BASE_URL="https://ton-url-vercel.vercel.app"
npm run test:smoke
```

## Deploiement

Pour un usage personnel gratuit, Vercel est une option simple.

Le projet contient deja :

- `api/index.js` pour exposer le backend comme fonction Vercel ;
- `vercel.json` pour router `/api/*` vers cette fonction ;
- les fichiers statiques a la racine pour servir la PWA.

Variables a ajouter dans Vercel > Project Settings > Environment Variables :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SECRET_KEY`
- `TMDB_READ_ACCESS_TOKEN`
- `TMDB_API_KEY` si tu utilises la cle API classique

Etapes recommandees :

1. Pousse le code sur GitHub.
2. Va sur Vercel et choisis `Add New Project`.
3. Importe `Sen0xC/suivi-tv`.
4. Framework preset : `Other`.
5. Build command : laisse vide ou `npm run check`.
6. Output directory : laisse vide.
7. Ajoute les variables d'environnement ci-dessus.
8. Lance le deploy.
9. Teste l'URL Vercel avec `SMOKE_BASE_URL`.

Important :

- ne jamais publier `.env` ;
- executer `supabase/schema.sql` dans Supabase avant le premier deploy ;
- redeployer apres chaque changement de variable d'environnement.

Si l'app affiche `Unexpected token 'A', "A server e"... is not valid JSON`, cela veut dire que Vercel renvoie une page d'erreur texte au lieu d'une reponse API JSON. A verifier en priorite :

- les variables `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont bien presentes dans Vercel ;
- `supabase/schema.sql` a bien ete execute ;
- le projet a bien ete redeploye apres ajout des variables ;
- l'URL `/api/health` repond en JSON.

## Publier sur GitHub

Le projet contient deja un `.gitignore` qui exclut :

- `.env`
- `data/database.json`
- fichiers temporaires de donnees

Commandes pour creer le depot local :

```bash
git init
git add .
git commit -m "Initial commit"
```

Ensuite, cree un nouveau depot vide sur GitHub, puis relie-le :

```bash
git remote add origin https://github.com/Sen0xC/suivi-tv.git
git branch -M main
git push -u origin main
```

Si tu utilises SSH :

```bash
git remote add origin git@github.com:TON-PSEUDO/suivi-tv.git
git branch -M main
git push -u origin main
```

## Roadmap possible

- Authentification multi-utilisateur complete.
- Invitations d'amis avec acceptation/refus.
- Listes publiques partageables.
- Avis/commentaires entre amis.
- Notifications de sorties.
- Meilleur filtrage par plateforme disponible en France.
- Deploiement Vercel propre avec configuration production.

## Licence

Projet personnel. A definir avant publication publique.
