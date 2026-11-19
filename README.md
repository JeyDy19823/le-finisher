# Le Finisher

Le point du matin de ceux qui vont au bout.

PWA multi-utilisateurs : chaque sportif crée son espace, choisit son objectif, connecte ses propres comptes Strava et/ou COROS, et reçoit chaque matin son point de forme avec deux propositions de séances, plus des tableaux de bord.

## Ce que fait l'appli

- Point du jour : note de forme sur 100 (fraîcheur de charge, VFC de la nuit, sommeil, récupération COROS, FC de repos, ressenti), feu vert / à doser / récupération, alertes (surcharge, VFC basse, rythme de perte de poids trop agressif).
- Deux séances proposées : un axe endurance / triathlon (la discipline la moins travaillée de la semaine, en évitant celle d'hier) et un axe CrossFit / Hyrox si le sport est coché, adaptées à l'état de forme, au jour (sortie longue le week-end) et à la phase de préparation.
- Saisie du ressenti : poids, sommeil, fatigue, courbatures, moral, note.
- Tableaux de bord : courbe de forme 90 jours (CTL / ATL / TSB), volume par semaine et par sport, calendrier de charge, poids vs cible, VFC avec zone normale, sommeil, FC de repos, avis de charge COROS, dernières séances.
- Objectif : compte à rebours, phase (foncier, développement, spécifique, affûtage, semaine de course), conseils de la phase.
- Coach IA (facultatif) : un texte rédigé chaque matin à partir des données COROS et des saisies uniquement.
- Code de récupération pour retrouver son espace sur un autre appareil, export des données, suppression du compte.

## Accueil et démo

La page d'accueil suit ce qui marche sur les projets fitness open source de GitHub (Endurain, Lyftr, wingfit, openGym) : une promesse en une phrase, l'aperçu animé du vrai écran, une démo jouable sans compte, trois étapes pour comprendre, et un mot clair sur la confidentialité. La démo utilise un athlète fictif dont les données passent dans le vrai moteur : `public/demo.json` est régénéré à chaque déploiement par `node scripts/make-demo.mjs`.

L'inscription se fait en 4 écrans courts (prénom et sports, objectif, réglages facultatifs, connexion de la montre) au lieu d'un long formulaire.

## Gamification

- Quêtes du jour : remplir son ressenti (+20 XP), faire une des séances proposées ou respecter le feu rouge (+40), une quête bonus qui tourne (pesée, sommeil de 7 h, note) (+15), et +15 pour une journée parfaite.
- Défi de la semaine : 80 % de ses heures dispo (+100 XP).
- 8 niveaux, de « Licence en poche » à « Légende », et 20 badges (Triathlète, Centurion, Lève-tôt, Le sage, Premier kilo…), +50 XP chacun.
- Séries : jours de ressenti d'affilée, journées parfaites, semaines régulières.
- Le vestiaire : classement de la semaine entre potes, sur inscription volontaire. Pour respecter Strava, il ne compte que du déclaratif (ressenti rempli 10 pts, séance déclarée 20 pts) et n'affiche que le prénom.

## Mise en ligne sur Netlify

Le glisser-déposer Netlify ne déploie pas les fonctions serveur : il faut passer par GitHub ou par la ligne de commande.

Option GitHub : pousser ce dossier dans un dépôt, puis sur Netlify « Add new site » > « Import an existing project ». Rien à régler côté build, le fichier netlify.toml s'en charge.

Option ligne de commande :

```
npm install
npx netlify-cli login
npx netlify-cli deploy --prod
```

Le stockage (Netlify Blobs) est activé automatiquement, il n'y a pas de base de données à créer.

## Variables d'environnement (Site configuration > Environment variables)

| Variable | Obligatoire | Rôle |
|---|---|---|
| SESSION_SECRET | oui | 32 caractères aléatoires minimum. Signe les sessions et chiffre les jetons. Ne jamais le changer après coup (sinon tout le monde doit reconnecter ses applis). Générer avec `openssl rand -hex 32`. |
| STRAVA_CLIENT_ID | pour Strava | Identifiant de l'app Strava (voir plus bas). |
| STRAVA_CLIENT_SECRET | pour Strava | Secret de l'app Strava. |
| INVITE_CODE | conseillé | Code à donner à tes potes. Sans lui, n'importe qui trouvant l'URL peut créer un compte et prendre une des places Strava. |
| ANTHROPIC_API_KEY | non | Active le coach IA (clé sur console.anthropic.com). |
| ANTHROPIC_MODEL | non | Modèle utilisé, par défaut claude-sonnet-5-5. |

Redéployer après avoir ajouté les variables.

## Créer l'app Strava

1. Aller sur https://www.strava.com/settings/api et créer une application.
2. Authorization Callback Domain : le domaine du site, sans https ni chemin (ex. `le-finisher.netlify.app`).
3. Copier Client ID et Client Secret dans les variables Netlify.
4. Places : une app neuve n'accepte qu'un seul athlète (toi). Depuis le tableau de bord API on peut passer à 10 athlètes sans revue, mais depuis juin 2026 il faut un abonnement Strava pour ce palier. Au-delà de 10, il faut une revue Strava, qui prend souvent plusieurs semaines voire des mois.
5. Charte Strava : remplacer le bouton orange « Se connecter avec Strava » et la mention « Powered by Strava » par les visuels officiels du kit de marque Strava (https://developers.strava.com/guidelines/) avant d'ouvrir à d'autres personnes.

## COROS

Rien à configurer. L'appli passe par le serveur MCP officiel de COROS (https://github.com/coroslab/coros-mcp), ouvert en libre-service : OAuth 2.0 avec PKCE, enregistrement automatique du client au premier branchement, et chaque utilisateur n'accède qu'à ses propres données. Choisir la région Europe pour un compte COROS français.

## Règles respectées

- Strava : les données Strava ne sont montrées qu'à l'athlète qui les fournit, ne sont jamais stockées (lues à chaque ouverture) et ne sont jamais envoyées au coach IA. Les règles d'usage de l'API Strava (novembre 2024, durcies en juin 2026) interdisent d'utiliser ces données dans une IA, y compris en simple contexte de prompt. Le point du jour est donc calculé par un moteur de règles, sans IA, et le coach IA ne voit que COROS et les saisies manuelles.
- Jetons Strava et COROS chiffrés (AES-256-GCM) dans le stockage, session dans un cookie signé HttpOnly.
- Si COROS est synchronisé vers Strava, les doublons sont fusionnés (même sport, même créneau : on garde la séance avec FC).

## Calculs (sourcés sur GitHub)

- Charge d'une séance : TRIMP de Banister pondéré par le sexe, ramené à une échelle où 1 h au seuil vaut 100 (même logique que le hrTSS de elduty/velomate). Sans fréquence cardiaque : estimation par sport et par durée.
- Courbe de forme : CTL (constante 42 jours), ATL (7 jours), TSB = CTL - ATL de la veille, comme dans mkuf/TrainingPulse et FitOps-CLI.
- Ratio aigu / chronique ATL / CTL, alerte au-dessus de 1,5 (seulement après 6 semaines d'historique).

Les chiffres sont informatifs, ce n'est pas un avis médical.

## Tests

```
npm test
```

Teste les lecteurs de réponses COROS sur de vraies réponses, le moteur de calcul, et tout le parcours API (inscription avec code d'invitation, OAuth Strava et COROS, chiffrement des jetons, point du jour, absence de données Strava dans le prompt IA, reconnexion par code, cookie falsifié, suppression du compte) avec Strava, COROS et Anthropic simulés.

## Structure

```
public/                 interface (HTML, CSS, JS sans framework, graphiques SVG faits main, service worker)
netlify/functions/api.mjs          API unique sur /api/*
netlify/functions/_lib/engine.mjs  moteur : charge, forme, note du jour, séances, tableaux de bord
netlify/functions/_lib/coros.mjs   OAuth + client MCP COROS + lecture des réponses
netlify/functions/_lib/strava.mjs  OAuth + API Strava
netlify/functions/_lib/store.mjs   stockage, sessions, chiffrement
tests/                  tests automatiques
```

## Pistes pour la suite

- Rappel du matin par notification push.
- Écriture des séances proposées directement dans le calendrier COROS (l'outil createScheduledWorkout existe dans le MCP).
- Plan d'entraînement complet jusqu'à la date d'objectif.
