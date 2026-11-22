# Tests frontend : CI et intégration locale

## CI reproductible sans modèles

Depuis `frontend`, avec Node >=22.12 (CI et Docker : Node 22.23.5) et Bun 1.4.4 :

```sh
bun install --frozen-lockfile
bun run test:ci
bun run lint
NITRO_PRESET=node_server bun run build
```

`test:ci` exécute TypeScript et Vitest/jsdom. Aucun téléchargement DVC, checkpoint, API, fichier `reports/audits`, navigateur ou authentification n'est nécessaire. Les tests de composants utilisent des réponses synthétiques explicites ; ils ne prouvent pas la qualité des modèles. Sous PowerShell, utiliser `$env:NITRO_PRESET = "node_server"` puis `bun run build` pour la dernière commande.

Le Dockerfile frontend a pour contexte ce dossier. Il installe avec le même lockfile et les mêmes versions majeures Node/Bun, et ne copie que `.output` dans l'image finale. Les fichiers locaux E2E sont exclus du contexte Docker. Aucun nouveau paquet ni second lockfile n'est requis.

## E2E avec les trois modèles réels, hors CI standard

`bun run test:e2e:models` (alias conservé : `test:e2e`) est une suite locale distincte : 12 scénarios séquentiels, arrêt au premier échec, sans retry automatique. Elle ajoute normalement 4 prédictions dans la base principale jetable ; le contrôle complémentaire peut ajouter une image de seed s'il est exécuté seul sur une base vide. Elle importe explicitement un enregistrement uniquement dans la fixture legacy sur le port 18803. Elle ne démarre ni service ni modèle automatiquement et ne supprime aucune base.

Les régressions historiques des audits restent dans leurs dossiers de preuves. La suite courante ne dépend plus de ces dossiers. Les cas exécutés dans les audits précédents ne constituent pas une nouvelle validation de cette version du harness.

### Prérequis locaux

- Dépendances Python du backend et trois checkpoints compatibles disponibles localement, suivant le README principal. La CI standard n'en a pas besoin.
- Deux JPEG réels : un panneau avec au moins une détection, et un défaut avec au moins une détection. Un TIFF thermique du groupe de vérité `test/0` est requis pour l'assertion ResNet18 « 0 / Bottom Dirt » ; choisir une autre classe exige d'adapter cette assertion.
- Chromium Playwright : `bunx playwright install chromium` (Linux peut nécessiter `bunx playwright install --with-deps chromium`). Sur Windows, Edge installé à son emplacement standard est utilisé s'il existe ; sinon Chromium. `SOLARVISION_E2E_EXECUTABLE_PATH` permet un navigateur local explicite.

Depuis `frontend`, préparer les fichiers techniques sans aucune donnée privée :

```sh
bun run test:e2e:prepare
```

Cela crée `.e2e-local/fixtures/panel-3000.png` (motif RGB synthétique de 3000 × 2400), `panel.tiff` (TIFF en niveaux de gris de 32 × 32) et `over20MB.png` (PNG valide suivi de padding, 20 MiB + 1 octet). Le test haute résolution vérifie les dimensions, la conservation de l'original et l'export ; cette image synthétique ne fournit aucune vérité de détection. Ces fixtures, bases et captures sont ignorées par Git et Docker. `SOLARVISION_E2E_FIXTURE_DIR` peut désigner un autre dossier temporaire, en gardant ces noms.

Les images réelles ne sont pas copiées par le générateur. Les chemins locaux historiques sous `data/` restent les valeurs par défaut ; sur un autre poste, fournir :

```powershell
$env:SOLARVISION_E2E_PANEL_IMAGE = "C:\local-data\panel.jpg"
$env:SOLARVISION_E2E_DEFECT_IMAGE = "C:\local-data\defect.jpg"
$env:SOLARVISION_E2E_CLASSIFY_IMAGE = "C:\local-data\test\0\thermal.tif"
```

### Services isolés

Exemple PowerShell, avec des terminaux distincts, tous depuis `frontend`. Utiliser de nouveaux noms de bases pour chaque campagne ; conserver les bases précédentes pour les examiner. Ne pas réutiliser les bases de l'application.

API principale avec les modèles réels :

```powershell
$localDir = Join-Path (Get-Location) ".e2e-local"
$env:SOLARVISION_HISTORY_DB = Join-Path $localDir "main-new.sqlite3"
if (Test-Path -LiteralPath $env:SOLARVISION_HISTORY_DB) { throw "Choisir une nouvelle base jetable" }
$env:SOLARVISION_CORS_ORIGINS = "http://127.0.0.1:8181,http://127.0.0.1:8182"
python -m uvicorn src.api.main:app --app-dir .. --host 127.0.0.1 --port 18800
```

Les deux fixtures ci-dessous utilisent les routes et contrats du backend mais remplacent son lifespan pour ne charger aucun modèle ; `/ready` et la prédiction renvoient 503. Elles refusent toute base existante et n'effacent rien :

```powershell
python e2e/history-api.py --port 18801 --database .e2e-local/b-new.sqlite3
```

```powershell
python e2e/history-api.py --port 18803 --database .e2e-local/legacy-new.sqlite3
```

Frontend construit, dans un autre terminal :

```powershell
$env:NITRO_PRESET = "node_server"
bun run build
$env:SOLARVISION_PUBLIC_API_BASE_URL = "http://127.0.0.1:18800"
$env:HOST = "127.0.0.1"
$env:PORT = "8181"
node .output/server/index.mjs
```

### Préflight et exécution

Dans le terminal des tests :

```powershell
$env:SOLARVISION_E2E_ALLOW_MODEL_WRITES = "1"
bun run test:e2e:models
```

Le préflight ne fait que des lectures : présence des six images ; `/ready` 200 pour l'API principale et 503 pour B/legacy ; historiques B/legacy vides ; configuration publique du frontend pointant vers l'API principale. Un prérequis manquant échoue avant toute prédiction avec un message explicite. Il faut toujours vérifier que l'API principale utilise sa nouvelle base jetable ; un port ne suffit pas à identifier sa destination SQLite.

Par défaut : frontend sur le port 8181 → API sur le port 18800, B sur le port 18801, legacy sur le port 18803. Pour un candidat Docker isolé, définir `SOLARVISION_E2E_BASE_URL=http://127.0.0.1:8182` et `SOLARVISION_E2E_API_URL=http://127.0.0.1:18802`, en adaptant la configuration runtime du frontend. Les rôles B et legacy restent 18801/18803 ; `SOLARVISION_E2E_OTHER_API_URL` et `SOLARVISION_E2E_LEGACY_API_URL` sont aussi validés.

La configuration refuse les URLs hors `http://127.0.0.1`, les identifiants, chemins/query/fragments et tous les ports hors de cette liste. Elle refuse notamment 8000/18000 et 8081/8082. Sans `SOLARVISION_E2E_ALLOW_MODEL_WRITES=1`, même la collecte Playwright échoue ; la commande ne devient pas implicitement autorisée par la présence des données.

Les résultats, JSON, PNG, événements et traces sont écrits dans `.e2e-local/artifacts` ou `SOLARVISION_E2E_ARTIFACT_DIR`. Chaque contexte navigateur est temporaire. Après la suite, arrêter uniquement les processus démarrés pour elle et conserver les bases/captures. Aucun upload, import, effacement ou redéploiement n'est nécessaire sur l'application utilisateur.
