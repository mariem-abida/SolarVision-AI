# SolarVision AI

Plateforme d’inspection solaire : React/TypeScript avec TanStack Start et le design Lovable existant, API FastAPI, détection YOLO11n et classification thermique ResNet18. ViT-Tiny reste un modèle de comparaison scientifique ; il n’est pas déployé pour l’inférence.

## Démarrage local sous Windows

Utiliser deux terminaux PowerShell depuis `C:\SolarVision`. Conserver l’environnement CUDA existant s’il fonctionne ; l’image Docker décrite plus bas utilise PyTorch CPU.

Backend :

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
```

Les trois checkpoints doivent déjà être présents :

```text
runs/detect/runs/solarvision/panel_detection_full/weights/best.pt
runs/solarvision/defect_detection_full-2/weights/best.pt
models/classification/resnet18_best.pth
```

Aucun téléchargement de poids, entraînement ou `dvc push` n’est lancé par le dashboard. L’API charge les modèles au démarrage et choisit CUDA lorsque PyTorch le permet. Vérifier `http://127.0.0.1:8000/health` et la documentation interactive `http://127.0.0.1:8000/docs`.

Frontend, avec Node.js 22 et Bun :

```powershell
Set-Location C:\SolarVision\frontend
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 8081
```

Ouvrir `http://localhost:8081`. Dans **Settings**, enregistrer `http://127.0.0.1:8000` et tester la connexion. L’URL est sauvegardée dans le navigateur ; `VITE_API_BASE_URL` définit seulement la valeur initiale. Les origines HTTP `localhost` et `127.0.0.1` aux ports 8080 et 8081 sont explicitement autorisées par l’API. Des origines supplémentaires peuvent être ajoutées via `SOLARVISION_CORS_ORIGINS` (liste séparée par des virgules) avant le démarrage du backend.

L’adresse API désigne la machine vue par le navigateur. Pour un navigateur sur une autre machine, utiliser l’adresse réseau du serveur et autoriser son origine frontend. Une page HTTPS doit accéder à une API HTTPS. Aucun secret ne doit être mis dans une variable `VITE_*`, car ces valeurs font partie du JavaScript public.

## Inspection et données

**AI Inspection** accepte JPG, JPEG, PNG, TIFF et TIF jusqu’à 20 Mio. Choisir le modèle puis lancer l’analyse ; le navigateur envoie réellement l’image à FastAPI. Les détections affichent leurs classes, confiances et coordonnées ; la classification affiche les probabilités renvoyées par le checkpoint. Les rapports JSON et les images annotées peuvent être téléchargés.

ResNet18 attend des images thermiques de modules compatibles avec PVF-10. Une photographie RGB ordinaire n’est pas une entrée équivalente. La confirmation explicite de compatibilité thermique est nécessaire ; le serveur ne peut pas prouver la modalité ou la provenance d’une image à partir de ses seuls canaux RGB. Le redimensionnement, la conversion de canaux et la normalisation suivent le prétraitement du modèle entraîné, sans convertir une photographie visible en mesure thermique.

L’historique conserve les enregistrements locaux existants et les importe sans écraser les identifiants déjà présents côté serveur. Une base SQLite backend fournit une persistance complémentaire ; sa destination locale par défaut est `data/inspections.sqlite3`, configurable avec `SOLARVISION_HISTORY_DB`. Sauvegarder ce fichier avec les procédures habituelles de sauvegarde. Les préférences restent propres au navigateur. Le dashboard n’ajoute ni authentification ni gestion multi-utilisateur : réserver l’API à un environnement de confiance ou la placer derrière un proxy authentifié avant toute exposition publique.

Contrats principaux :

| Endpoint | Données |
| --- | --- |
| `GET /health` | Disponibilité API, modèles chargés et environnement d’inférence. |
| `POST /predict/panels`, `POST /predict/defects` | Formulaire multipart `file`, détections, classes, confiances et `inference_ms`. |
| `POST /predict/classify` | Multipart `file` et `thermal_confirmed=true`, classe et probabilités réelles. Les images thermiques brutes 16 bits nécessitent une conversion scientifique appropriée en entrée 8 bits compatible. |
| `GET /inspections?limit=500&offset=0` | Historique paginé `{records, total}`. |
| `POST /inspections/import` | `{records: [...]}`, au plus 100 par lot, insertion des identifiants manquants uniquement. |
| `GET /inspections/{id}/image` | Aperçu PNG de l’inspection enregistrée, dimension maximale de 1600 pixels. |
| `GET /dashboard`, `GET /monitoring` | Métadonnées autorisées en lecture seule et télémétrie réelle. |

Une prédiction expose aussi `image_width`, `image_height`, `inspection_id`, `created_at` et, si l’enregistrement a échoué, `persistence_error`. Le temps `inference_ms` est celui du modèle côté serveur ; le temps de bout en bout comprend transfert, décodage, enregistrement et réponse.

Les huit pages utilisent les informations disponibles :

- **Overview** : connexion réelle, disponibilité des modèles et inspections enregistrées.
- **AI Inspection** : inférences indépendantes YOLO panneaux, YOLO défauts et ResNet18 thermique.
- **Inspection History** : recherche, filtres, consultation et export des inspections.
- **Model Performance** : évaluations historiques présentes dans `reports/**/test_metrics.json`, distinctes de la production.
- **Dataset Explorer** : sept fichiers DVC sous `data/raw/`, leur empreinte/version de contenu, tailles et statistiques accessibles. L’existence d’un pointeur `.dvc` ne prouve pas que les données sont téléchargées ou synchronisées avec un remote.
- **MLOps Center** : checkpoints, historiques CSV d’entraînement et expériences/métriques de `mlflow.db`, en lecture seule. Aucun endpoint ne lance de commande arbitraire.
- **System Monitoring** : mesures réelles de requêtes, erreurs, latence et ressources disponibles. Les compteurs en mémoire repartent au redémarrage de l’API ; l’absence de métriques GPU ou système est indiquée.
- **Settings** : configuration API, test de connexion, préférences d’analyse et de thème.

Une source absente est indiquée **Unavailable** ou **Not configured**, sans métriques ni runs artificiels. Les métadonnées d’un entraînement passé ne constituent pas une mesure temps réel de la qualité des prédictions.

## Docker Compose (CPU)

Docker Desktop doit être démarré en mode conteneurs Linux. Les datasets et checkpoints restent sur l’hôte et sont montés en lecture seule. L’historique utilise le volume nommé `solarvision-history` ; ne pas utiliser `docker compose down -v` si cet historique doit être conservé.

```powershell
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail 100 solarvision-api
```

Le frontend est disponible sur `http://localhost:8081`, l’API sur `http://127.0.0.1:8000`. Le frontend attend que le healthcheck confirme une réponse API valide ; un échec de chargement des modèles est ensuite visible dans le dashboard. Son conteneur exécute la sortie Node de TanStack Start, construite avec `NITRO_PRESET=node_server` ; la configuration Lovable est conservée.

Choisir normalement un seul backend sur le port 8000 : local CUDA ou Docker CPU. Sous Windows, un processus Python lié à `127.0.0.1` et Docker Desktop peuvent parfois répondre sur des interfaces différentes du même port. Dans l’environnement vérifié ici, `http://127.0.0.1:8000` rejoint le backend natif CUDA et `http://[::1]:8000` le conteneur CPU ; `localhost` dépend de la résolution IPv4/IPv6 du client. Le champ `device` de `/health` permet de vérifier le backend effectivement utilisé. Pour exécuter les deux durablement, attribuer un port hôte distinct au service Docker et configurer cette URL dans Settings.

Le fichier MLflow SQLite local n’est pas suivi par Git et peut être absent d’un clone. Pour intégrer un `mlflow.db` déjà présent, activer le montage facultatif :

```powershell
docker compose -f compose.yaml -f compose.mlflow.yaml config --quiet
docker compose -f compose.yaml -f compose.mlflow.yaml up -d
```

Ce montage est en lecture seule et refuse de créer un répertoire si le fichier manque. Sans cet override, MLflow est signalé indisponible dans le conteneur. La configuration du remote DVC n’est pas montée ; les empreintes des sept datasets restent consultables, et le remote peut être indiqué non configuré.

La première construction de l’API installe PyTorch CPU et peut être longue. Son installation possède une couche distincte, avant les dépendances du projet et la copie du code, pour conserver le cache lors d’un changement de `requirements.txt`. Le Compose local monte aussi `src/` en lecture seule : un changement Python demande seulement un redémarrage. Ne reconstruire que le service concerné :

```powershell
docker compose build solarvision-frontend
docker compose up -d --no-deps solarvision-frontend
# Après un changement de code Python uniquement :
docker compose restart solarvision-api
# Après une modification des dépendances Python ou du Dockerfile :
docker compose build solarvision-api
docker compose up -d --no-deps solarvision-api
```

Les checkpoints modifiés sur l’hôte ne demandent aucune reconstruction ; redémarrer l’API pour les recharger. Ce Compose n’active pas le GPU. Le lancement local dans l’environnement CUDA reste le chemin GPU. Aucune commande de nettoyage des données, de téléchargement DVC ou d’entraînement n’est nécessaire au démarrage.

Pour changer l’adresse API intégrée à l’image frontend, définir `VITE_API_BASE_URL` avant `docker compose build solarvision-frontend`, ou changer la connexion depuis Settings. Les préférences déjà enregistrées dans le navigateur gardent la priorité.

## Vérification

Tests API et métadonnées, sans entraînement :

```powershell
.\.venv\Scripts\python.exe -m pip install pytest httpx
.\.venv\Scripts\python.exe -m pytest -v
.\.venv\Scripts\python.exe -m compileall -q src
```

`pytest.ini` limite la découverte à `tests/`. Les fichiers `src/**/test_*.py` sont des scripts historiques d’inférence/évaluation qui nécessitent les poids et les datasets ; ils ne font pas partie de la suite unitaire automatisée.

Vérification facultative avec les vrais checkpoints et de vraies images du projet, sans entraînement :

```powershell
# Processus local indépendant, base d’historique temporaire (CUDA si disponible) :
.\.venv\Scripts\python.exe -m scripts.verify_fullstack
# API déjà lancée, par exemple le service Docker CPU :
.\.venv\Scripts\python.exe -m scripts.verify_fullstack --base-url http://127.0.0.1:8000
```

Ce contrôle vérifie les trois inférences, les aperçus enregistrés, l’historique, les quatre origines CORS locales, le dashboard et le monitoring. Il nécessite les images sous `data/interim/{panel_detection,defect_detection}/test/images` et `data/processed/pvf10_grouped/test`. Le mode `--base-url` ajoute trois inspections réelles à l’historique du serveur. Les rapports de validation sont écrits sous `outputs/integration/`.

```powershell
Set-Location C:\SolarVision\frontend
bunx tsc --noEmit
bun run test
bun run lint
bun run build
# Sortie autonome utilisée par Docker :
$env:NITRO_PRESET='node_server'
bun run build
$env:HOST='127.0.0.1'
$env:PORT='8081'
node .output/server/index.mjs
```

Le workflow GitHub Actions conserve les contrôles Python existants et ajoute TypeScript, lint, tests, build frontend et validation Compose. Les tests de contrat utilisent des doubles de modèles uniquement dans les tests ; l’application n’utilise aucune prédiction simulée. La validation d’un conteneur en fonctionnement nécessite un moteur Docker accessible ainsi que les vrais checkpoints montés.
