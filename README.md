# Helper — Job search center

Application web pour suivre ses candidatures (emploi, stage, alternance). Chaque utilisateur se connecte (Firebase Authentication) et ne voit que ses propres candidatures et fichiers. Interface en anglais ou en français (choix de la langue dans Profile).

## Fonctionnalités

| Page | Ce que ça fait |
|---|---|
| **Box** | Liste des candidatures, par date du dernier changement de statut ou regroupées par entreprise (bandeaux repliables), filtrable par statut (Not sent, Sent, Positive response, Refused) et par recherche sur l'entreprise ou le poste. **Import / export** : CSV (champs de base, colonnes `company, jobTitle, type, status, offerUrl, contactName, contactPosition, contactEmail, contactPhone`, séparateur `,` ou `;`) ou JSON (tout sauf les PDF, sert de sauvegarde). |
| **Candidature** | Page de lecture pensée pour répondre à un recruteur : points clés de l'offre d'abord (ou les échanges pour une candidature spontanée), puis l'offre, le CV, le contact, les échanges, la lettre. Chaque carte s'agrandit par-dessus la page (icône en haut à droite). |
| **Création / modification** | Deux types : à une offre ou spontanée. Seules les bases sont obligatoires ; les sections (lien de l'offre, points clés, CV, lettre, échange, contact, section libre) s'ajoutent, se retirent et se réordonnent. Un **échange** (nom, coordonnée et plateforme obligatoires) contient une suite de messages datés, chacun marqué comme envoyé par l'interlocuteur ou par moi ; on peut en ajouter plusieurs. Le **CV** se dépose ou se choisit parmi ceux du profil ; à une offre, un CV du profil porte la mention « pas personnalisé pour cette offre » ; en spontanée, le CV est marqué « envoyé au recruteur » ou « contexte pour l'IA ». **« Fetch and summarize »** lit la page de l'offre et l'IA (**Groq**) remplit les points clés ; un champ inconnu reste vide. |
| **Offer search** | Recherche d'offres sur le web et via l'API France Travail ; « Track » crée une candidature à partir d'une offre. |
| **Find companies** | Candidatures spontanées, là où il y a moins de concurrence : l'utilisateur indique ce qu'il cherche, un lieu et un rayon (jusqu'à 50 km). L'IA choisit les secteurs d'activité (codes NAF, vérifiés dans la nomenclature officielle de l'INSEE) et l'**API publique « Recherche d'entreprises »** liste les entreprises actives du périmètre, triées par pertinence du secteur puis distance, filtrables par taille. Pour une entreprise : « Find website » cherche son site, « Find contact info » les **adresses e-mail publiées** sur ce site (recrutement@, contact@…, jamais devinées) ; « Create spontaneous application » ouvre le formulaire de candidature spontanée prérempli (entreprise, contact). |
| **Suggestion de lettre** | Dans la section Lettre du formulaire, « Suggérer avec l'IA » rédige la lettre à partir de l'offre ; pour une candidature spontanée, l'e-mail de candidature à partir de la section Entreprise, avec le CV de la section CV comme contexte. |
| **Préparation d'entretien** | Sur la page d'une candidature, sous les points clés, dans un encadré repliable : recherches web sur l'entreprise, puis fiche avec la situation, l'entreprise (sourcée), une **analyse détaillée de chaque compétence demandée** face au CV envoyé, un pitch, les questions probables et à poser, une checklist. |
| **AI agent** | Lien MCP personnel à ajouter comme connecteur personnalisé dans Claude, ChatGPT ou Le Chat : l'agent consulte, crée et modifie les candidatures (pas de suppression ni de fichier PDF). |
| **Review** | Commentaire libre (pop-up d'invitation après la connexion), visible par les administrateurs dans Statistics. |
| **Profile** | Plusieurs CV en PDF, chacun avec un titre, à choisir dans la section CV d'une candidature (copié dans la candidature) ; langue (EN / FR) et déconnexion. |
| **Statistics** | Réservée aux administrateurs (`ADMIN_EMAILS`) : comptes et candidatures créés par jour et par semaine depuis le début, utilisateurs actifs par jour, entonnoir d'utilisation, usage et durée des fonctions IA, pages vues, dernières erreurs. |

## Installation

Prérequis : Python 3.10+.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # puis remplis les clés
uvicorn app.main:app --reload
```

Ouvre ensuite http://localhost:8000.

### Essayer sans Firebase (mode démo)

Pour tester l'appli sur ton ordinateur sans configurer Firebase : seule `GROQ_API_KEY` est nécessaire dans `.env` (et `TAVILY_API_KEY`, conseillée, pour la recherche web).

```bash
python scripts/demo.py
```

Ouvre http://localhost:8000 : tu es connecté automatiquement avec un compte de démonstration, administrateur (page Statistics visible). Les données restent en mémoire et sont **effacées à l'arrêt** (Ctrl + C). Ce mode ne sert qu'aux essais locaux, jamais au déploiement.

### Firestore (gratuit, plan Spark)

Les candidatures et les PDF sont stockés dans Firestore. Les PDF sont découpés en morceaux de 900 Ko (un document par morceau) : pas besoin de Cloud Storage, qui exige le plan payant.

1. Crée un projet dédié sur https://console.firebase.google.com (chaque projet a son propre quota gratuit) et mets son identifiant dans `.firebaserc`.
2. Crée la base, ses règles (seul le serveur y accède) et active la connexion par e-mail : `firebase deploy --only firestore,auth`.
3. *Paramètres du projet → Comptes de service → Générer une nouvelle clé privée* : garde le fichier JSON hors du dépôt.
4. Dans `.env` : `FIREBASE_PROJECT_ID=<id du projet>` et `GOOGLE_APPLICATION_CREDENTIALS=<chemin du JSON>`.

### Connexion (Firebase Authentication)

La configuration web du projet est dans `static/auth.js`. La connexion par e-mail est activée ; pour « Continue with Google », active le fournisseur Google dans la console : *Authentication → Sign-in method*.

### Clé Groq (gratuite)

1. Crée une clé sur https://console.groq.com/keys.
2. Mets-la dans `.env` : `GROQ_API_KEY=...` (modèle modifiable via `GROQ_MODEL`).

### Trouver des entreprises : services utilisés

Aucune clé nécessaire : géolocalisation par la Géoplateforme (`data.geopf.fr`) et annuaire officiel des entreprises (`recherche-entreprises.api.gouv.fr`, limité à 7 requêtes par seconde). La nomenclature NAF est embarquée dans `app/data/naf.json` (liste INSEE via le paquet `@socialgouv/codes-naf`). La recherche du contact passe par la recherche web : une clé Tavily est fortement conseillée.

### Recherche web : clé Tavily (recommandée, gratuite)

La recherche d'offres, l'assistant et la préparation d'entretien cherchent sur le web. Sans clé, l'appli utilise DuckDuckGo, qui **bloque souvent les requêtes automatiques** (« DuckDuckGo bloque les recherches… »). Pour une recherche fiable :

1. Crée un compte sur https://app.tavily.com (gratuit jusqu'à 1 000 recherches par mois, sans carte bancaire).
2. Copie la clé (elle commence par `tvly-`) dans `.env` : `TAVILY_API_KEY=...`, puis redémarre l'appli.

Si Tavily échoue (quota atteint…), DuckDuckGo prend le relais. En production : `printf %s "<clé>" | gcloud secrets create tavily-api-key --data-file=-`, puis ajoute `TAVILY_API_KEY=tavily-api-key:latest` à `--set-secrets`.
### Agents IA (MCP)

Le lien de chaque utilisateur est son identifiant signé avec `MCP_SECRET` : il sert de mot de passe. Génère une valeur avec `python -c "import secrets; print(secrets.token_hex(32))"` et mets-la dans `.env` : `MCP_SECRET=...`. Changer ce secret invalide tous les liens.

### API France Travail (optionnelle, gratuite)

Sans elle, Offer search cherche quand même sur le web. Crée une application sur https://francetravail.io, abonne-la à l'API **« Offres d'emploi v2 »** et copie ses identifiants dans `.env`.

### Statistiques d'usage (style PostHog)

L'appli enregistre des événements (pages vues, candidature créée, offre résumée, réponse analysée, préparation générée, erreurs, durées des appels IA) dans la collection Firestore `events`, sans jamais de contenu (CV, offres, messages) ni information personnelle.

- **Page Statistics** : mets l'adresse e-mail de ton compte dans `ADMIN_EMAILS` (plusieurs adresses séparées par des virgules) ; le lien n'apparaît que pour ces comptes et le serveur refuse les autres.
- **PostHog (optionnel)** : crée un projet sur https://posthog.com (hébergement UE conseillé), puis renseigne `POSTHOG_API_KEY` (et `POSTHOG_HOST` si besoin). Les mêmes événements y sont envoyés par le serveur ; tu profites alors de ses tableaux de bord, entonnoirs et cohortes.

## Déploiement (Cloud Run + Firebase Hosting)

Prérequis : plan **Blaze** (Cloud Run l'exige) ; pense à une alerte de budget. Le serveur tourne sur Cloud Run, Firebase Hosting le sert sur https://helper-job-search-center.web.app. Sur Cloud Run, pas de fichier de clé : le serveur accède à Firestore avec le compte de service par défaut.

```bash
gcloud auth login
gcloud config set project helper-job-search-center
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Clé Groq en secret (une seule fois)
printf %s "<clé Groq>" | gcloud secrets create groq-api-key --data-file=-
gcloud secrets add-iam-policy-binding groq-api-key --role=roles/secretmanager.secretAccessor \
  --member=serviceAccount:263454823776-compute@developer.gserviceaccount.com

# Secret des liens MCP (une seule fois)
python -c "import secrets; print(secrets.token_hex(32), end='')" | gcloud secrets create mcp-secret --data-file=-
gcloud secrets add-iam-policy-binding mcp-secret --role=roles/secretmanager.secretAccessor \
  --member=serviceAccount:263454823776-compute@developer.gserviceaccount.com

# À chaque mise à jour
gcloud run deploy job-search-center --source . --region europe-west1 --allow-unauthenticated \
  --set-env-vars "^;^FIREBASE_PROJECT_ID=helper-job-search-center;ADMIN_EMAILS=nathan.celerier@aivancity.education,astreonoobie@gmail.com,aminadll26@outlook.com" \
  --set-secrets GROQ_API_KEY=groq-api-key:latest,MCP_SECRET=mcp-secret:latest
firebase deploy --only hosting
```

Pour France Travail, ajoute `FRANCE_TRAVAIL_CLIENT_ID` et `FRANCE_TRAVAIL_CLIENT_SECRET` de la même façon. Pour PostHog, ajoute sa clé en secret si tu l'utilises (`--set-secrets POSTHOG_API_KEY=posthog-api-key:latest`).

Garde `ADMIN_EMAILS` dans `--set-env-vars`, qui remplace toutes les variables du service à chaque déploiement : sans lui, plus personne n'accède à la page Statistics. Le préfixe `^;^` sépare les variables par `;`, car les e-mails sont séparés par des virgules.

## Tests

```bash
pytest
```

## Structure

```
app/
  main.py      # routes FastAPI (vérifie le jeton Firebase du cookie __session)
  mcp_server.py # serveur MCP pour les agents IA, monté sur /mcp/<clé>/
  store.py     # Firestore : candidatures, fichiers, profils, événements
  offer.py     # lecture d'une offre + résumé en points clés par l'IA
  replies.py   # réponses de recruteurs → mise à jour de la candidature ; préparation d'entretien
  companies.py # entreprises à démarcher : secteurs NAF, annuaire officiel, contact publié, candidature spontanée
  data/naf.json # nomenclature officielle NAF rév. 2 (code → libellé)
  prompts.py   # prompts (lettre, e-mails, réponses, préparation)
  analytics.py # statistiques d'usage : événements, PostHog, agrégats
  stats.py     # comptes et candidatures créés par jour et par semaine (historique complet)
  llm.py       # client Groq
  websearch.py # recherche web (DuckDuckGo) et lecture de pages
  jobs.py      # offres France Travail + liens externes
static/        # interface web sans build : app.js (Box, candidatures, offres), ai.js (pages IA),
               # stats.js (Statistics), companies.js (Find companies), track.js (envoi des événements), i18n.js (textes EN/FR), auth.js
tests/
```

## Confidentialité

Les candidatures et fichiers sont dans ton projet Firebase, rattachés au compte qui les a créés. Les textes (offre, message de recruteur, profil, CV) sont envoyés à Groq uniquement quand tu utilises une fonction IA. Les statistiques d'usage ne contiennent aucun contenu ni information personnelle.
