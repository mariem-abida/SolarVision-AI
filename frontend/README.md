# SolarVision AI frontend

Dashboard React/TypeScript et TanStack Start, construit avec [Lovable](https://lovable.dev). Le guide complet de démarrage FastAPI, d’inférence, de persistance, de Docker Compose et de validation se trouve dans [le README du projet](../README.md).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/235e64d5-f19b-44ad-9638-3e6dba7c22f0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Utiliser Node.js >=22.12 et Bun 1.4.4. La CI et les images Docker épinglées utilisent exactement Node.js 22.23.5 et Bun 1.4.4. Depuis ce répertoire :

```sh
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 8081
```

Configurer l’API dans Settings, par défaut `http://127.0.0.1:8000`. Le serveur construit utilise `SOLARVISION_PUBLIC_API_BASE_URL` via `/solarvision-config.js` ; `VITE_API_BASE_URL` fournit le fallback compilé. Les préférences du navigateur existantes restent prioritaires. Ces valeurs sont publiques et ne doivent contenir aucun secret.

```sh
bun run test:ci
bun run lint
NITRO_PRESET=node_server bun run build
```

`test:ci` lance TypeScript puis les tests unitaires Vitest/jsdom. Ils fonctionnent sur un checkout propre, sans API en cours, navigateur Playwright, données DVC, modèles ou fichiers d'audit. `test` et `test:unit` lancent uniquement Vitest ; `typecheck` lance uniquement TypeScript. Le lockfile Bun est commité et l'installation CI doit rester gelée (`--frozen-lockfile`).

Sous PowerShell, définir `$env:NITRO_PRESET = "node_server"` avant `bun run build`. Le Dockerfile applique déjà ce preset pour produire un serveur Node autonome sans remplacer les plugins de configuration Lovable.

Les [E2E avec modèles locaux](E2E.md) sont séparés de cette CI. Ils exigent un opt-in explicite, des bases jetables et des images d'essai locales ; ils refusent les ports de l'application déployée. Leurs petites fixtures techniques sont générées sans datasets privés. Ne pas ajouter les données, checkpoints, bases ou captures au dépôt pour les exécuter.
