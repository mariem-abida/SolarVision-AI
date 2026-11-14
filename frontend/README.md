# SolarVision AI frontend

Dashboard React/TypeScript et TanStack Start, construit avec [Lovable](https://lovable.dev). Le guide complet de démarrage FastAPI, d’inférence, de persistance, de Docker Compose et de validation se trouve dans [le README du projet](../README.md).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/235e64d5-f19b-44ad-9638-3e6dba7c22f0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Utiliser Node.js 22 et Bun. Depuis ce répertoire :

```sh
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 8081
```

Configurer l’API dans Settings, par défaut `http://127.0.0.1:8000`. `VITE_API_BASE_URL` change la valeur initiale au démarrage/build ; les préférences du navigateur existantes restent prioritaires.

```sh
bunx tsc --noEmit
bun run test
bun run lint
bun run build
```

Le Dockerfile frontend utilise `NITRO_PRESET=node_server` pour produire un serveur Node autonome sans remplacer les plugins de configuration Lovable.
