# CI et vérification depuis une source propre

Le workflow `.github/workflows/ci.yml` prépare quatre contrôles : qualité Python, tests API/métadonnées, qualité/build frontend et construction/smoke des images Docker. Il ne publie pas d'image, ne déploie pas Kubernetes, ne lance aucun entraînement et n'exécute aucun transfert DVC. Ses permissions sont limitées à la lecture du dépôt ; le checkout ne conserve pas de credentials Git.

Cette préparation et les essais locaux ne constituent pas une nouvelle exécution GitHub Actions. La CI distante des changements ne pourra être constatée qu'après une publication autorisée de la révision concernée. Les résultats historiques des phases 2 et 3 ne sont pas présentés comme les résultats de cette future CI.

## Profil reproductible Linux CPU

| Élément | Version prévue dans la CI |
|---|---|
| Runner | Ubuntu 24.04 |
| Python |3.11.18 |
| Node.js |22.23.5 |
| Bun |1.4.4 ; installation `--frozen-lockfile` |
| PyTorch CPU |2.15.0+cpu |
| Torchvision CPU |0.29.2+cpu |
| Outils Python |pytest 9.2.0, httpx 0.28.1, Ruff 0.17.5, PyYAML 6.0.3 |

`constraints-cpu.txt` fixe 66 versions de distributions observées dans l'image API CPU validée en phase 2. `requirements.txt` reste la liste universelle des dépendances applicatives ; `requirements-ci.txt` ajoute les outils de test. Le profil CPU est distinct de la venv CUDA Windows existante, qui n'est ni convertie ni mise à jour par ces commandes.

Une contrainte limite les versions sélectionnées sans installer elle-même tous les packages. Ce mécanisme est décrit dans la [documentation pip](https://pip.pypa.io/en/stable/user_guide/#constraints-files). Les versions `+cpu` sont sélectionnées via l'[index CPU officiel PyTorch](https://download.pytorch.org/whl/cpu), selon les plateformes d'installation [documentées par PyTorch](https://pytorch.org/get-started/locally/).

Les images de base Python, Node et Bun sont épinglées par digest dans leurs Dockerfiles. Les paquets système installés par `apt-get` ne sont cependant pas figés sur un snapshot de dépôt Debian. Les versions Python ne comportent pas de hashes d'artefacts pip et les index doivent rester disponibles : il ne s'agit pas d'une garantie de reconstruction bit à bit de toute l'image.

## Tests Python dans un environnement neuf

Depuis la racine d'un clone publié ou de l'export propre revu, sur Linux avec Python 3.11.18 disponible, créer une venv temporaire dédiée, en dehors du dépôt. Ne pas utiliser la venv CUDA de travail pour installer ce profil :

```bash
solarvision_ci_env="$(mktemp -d /tmp/solarvision-ci.XXXXXX)"
python3.11 -m venv "$solarvision_ci_env"
"$solarvision_ci_env/bin/python" -m pip install pip==26.3 setuptools==79.0.1 wheel==0.46.3
"$solarvision_ci_env/bin/python" -m pip install --constraint constraints-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt -r requirements-ci.txt
"$solarvision_ci_env/bin/python" -m pip check
"$solarvision_ci_env/bin/python" -m ruff check src tests scripts --select E4,E7,E9,F63,F7,F82
"$solarvision_ci_env/bin/python" scripts/build_dashboard_snapshot.py --check
"$solarvision_ci_env/bin/python" scripts/check_public_snapshot.py --require-clean-source
YOLO_OFFLINE=true HF_HUB_OFFLINE=1 "$solarvision_ci_env/bin/python" -m pytest tests -q -p no:cacheprovider
```

Les tests `tests/` utilisent des modèles synthétiques et des bases SQLite temporaires. Ils ne nécessitent ni checkpoint, ni dataset, ni `mlflow.db`, ni accès à Google Drive. Les scripts historiques de `src/inference/test_*.py` et les E2E avec modèles réels ne font pas partie de cette suite de CI sans données privées.

Dans un clone Git, le contrôle de publication porte sur les fichiers suivis :

```bash
"$solarvision_ci_env/bin/python" scripts/check_publication_safety.py --tracked
```

Dans un export sans `.git`, employer le mode arbre avec sa liste complète de fichiers autorisés, selon [la procédure de publication](publication.md) :

```bash
"$solarvision_ci_env/bin/python" scripts/check_publication_safety.py --tree /chemin/export --allowlist /chemin/publication-tree-files.txt
```

Le scanner ne remplace pas une revue humaine des données publiées. Un scan incomplet ou un fichier refusé empêche la validation ; aucun secret, poids ou magasin SQLite ne doit être ajouté pour faire passer les tests.

## Frontend sans services de modèles

Avec Node 22.23.5 et Bun 1.4.4, depuis `frontend/` :

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:unit
NITRO_PRESET=node_server bun run build
```

`test:ci` regroupe types et tests unitaires. Les E2E avec modèles réels sont explicitement séparés et soumis au préflight local prévu ; ils ne sont pas lancés automatiquement sur un runner dépourvu de données. Un build frontend réussi ne prouve pas qu'un modèle est disponible.

## Images construites et testées localement

La construction utilise uniquement les sources autorisées par les `.dockerignore`. Le snapshot public est embarqué ; les modèles, datasets, bases SQLite, `mlruns`, configuration OAuth et rapports d'audit privés sont exclus du contexte API.

```bash
docker compose config --quiet
docker build --pull=false -t solarvision-api:publication-20261122 .
docker build --pull=false -t solarvision-frontend:publication-20261122 frontend
python3 scripts/ci_smoke_images.py --api-image solarvision-api:publication-20261122 --frontend-image solarvision-frontend:publication-20261122
```

Le smoke crée et retire seulement ses propres conteneurs jetables, sans réseau externe, ports publiés ni montage hôte, avec système de fichiers en lecture seule et espaces temporaires en RAM. L'API doit répondre `/health=200` mais `/ready=503` puisque les poids sont volontairement absents. Les métadonnées enregistrées restent disponibles via le snapshot. Le frontend doit fournir l'URL publique runtime 18000 et empêcher la mise en cache de sa configuration. Aucune inférence réelle n'est revendiquée par ce contrôle.

Les tags locaux `publication-20261122` sont distincts des images `postfix-20261121` déjà validées et déployées. Aucune commande de ce document ne charge ces nouvelles images dans Kind et aucune authentification à un registre n'est nécessaire.

## Snapshot et source propre

`scripts/check_public_snapshot.py` valide l'intégrité et la complétude des métadonnées publiques attendues : quatre évaluations, sept descripteurs DVC, quatre modèles enregistrés, cinq résumés CSV et la configuration du workflow. Le mode source propre refuse les magasins privés, poids et données locales. Les sources non montées restent identifiées comme absentes ; elles ne sont pas remplacées par des données fictives.

Modifier le workflow change une empreinte du manifeste de provenance. La capture publique doit alors être régénérée localement, avec les sources scientifiques et le registre existants accessibles en lecture seule, puis revue. Le runner propre ne régénère pas ce snapshot et ne télécharge pas les sources manquantes. Une empreinte vérifie l'intégrité déclarée, pas l'authenticité d'un éditeur, un succès CI courant, l'accès MLflow distant ou la synchronisation DVC.

Les SHA256 de provenance sont calculés sur les octets des sources. `.gitattributes` conserve donc les octets des descripteurs et rapports publics concernés, sans conversion CRLF/LF, tandis que le code utilise LF. Cela évite qu'un checkout Linux transforme silencieusement une source capturée sous Windows. Les valeurs scientifiques et les fichiers locaux ne sont pas réécrits pour adapter une empreinte.

## Actions GitHub épinglées

Les SHA ont été vérifiés dans les dépôts officiels. L'épinglage suit les [recommandations de sécurité GitHub](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions). Les versions de runtime téléchargées sont configurées explicitement, conformément aux documentations [setup-python](https://github.com/actions/setup-python/blob/v7.1.0/README.md) et [setup-node](https://github.com/actions/setup-node/blob/v7.1.0/README.md).

| Action | Release vérifiée | SHA utilisé |
|---|---|---|
| actions/checkout |[v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)|`3d3c42e5aac5ba805825da76410c181273ba90b1`|
| actions/setup-python |[v7.1.0](https://github.com/actions/setup-python/releases/tag/v7.1.0)|`6d4fd22b20465ccc0f7354476588e8df7c9ca0e0`|
| actions/setup-node |[v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)|`949feb2413d6458794dcd2491c4babbbce0c15c1`|
| oven-sh/setup-bun |[v2.2.0](https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0)|`0c5077e51419868618aeaa5fe8019c62421857d6`|

Le workflow se déclenche sur les pushes `main`/`codex/**`, les PR vers `main` et les lancements manuels autorisés. Il n'utilise ni `pull_request_target`, ni droit `packages:write`, ni étape de publication, ni déploiement automatique. Aucune nouvelle exécution distante n'a été déclenchée pendant la préparation locale.
