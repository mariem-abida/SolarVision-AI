# Politique de publication

Le dépôt public contient le code, les tests autonomes, les configurations, les évaluations numériques, les pointeurs DVC revus, les dépendances verrouillées pour la CI CPU et le snapshot public de métadonnées.

Les éléments suivants restent locaux et sont exclus de Git et des contextes Docker concernés : datasets, checkpoints/exports de modèles, bases SQLite et journaux, identifiants OAuth, clés, fichiers d'environnement privés, archives de sauvegarde, historiques et preuves brutes sous `reports/audits/`.

Le snapshot `configs/dashboard-snapshot.json` est une exception explicite : il ne contient que des métadonnées publiques allowlistées, avec provenance et empreintes. Il n'embarque ni `mlflow.db`, ni dataset, ni poids, ni URL privée de remote ou credential. Ses valeurs doivent provenir des sources réelles ; la CI vérifie leur structure/intégrité et ne les régénère pas à partir de valeurs artificielles.

Les captures sous `docs/assets/` montrent uniquement des pages de métadonnées. Elles ne contiennent aucune image d'inspection, aucune ligne d'historique et aucun secret. Les mosaïques `val_batch*.jpg` d'évaluation, qui contiennent des pixels de datasets et étaient déjà suivies, sont destinées à être retirées du suivi lors du prochain commit approuvé ; leurs fichiers locaux sont préservés. Leur retrait ne supprime pas leurs anciennes versions de l'historique Git. Aucune réécriture d'historique n'est proposée.

Les pointeurs `.dvc` sont des descripteurs de contenu, pas les artefacts qu'ils référencent. Les anciens pointeurs de sauvegarde n'autorisent pas la publication des archives correspondantes. Aucune opération DVC distante n'est nécessaire à la CI et aucune synchronisation n'est annoncée sans vérification.

## Préparation avant commit

Utiliser une liste explicite de chemins revus. Vérifier les contenus réellement destinés au commit avec `scripts/check_publication_safety.py`, y compris les blobs de l'index après staging. Un `.gitignore` seul ne protège pas un fichier déjà suivi ; l'audit de l'arbre complet et des retraits prévus est donc distinct de la liste des nouveaux fichiers.

Les bases, datasets et sauvegardes ne sont jamais supprimés pour obtenir un arbre de publication propre. L'export de validation est une copie du code autorisé, sans ces données. Un retrait prévu de fichier sensible ou de mosaïque utilise uniquement un retrait de l'index Git après autorisation, en conservant le fichier de travail.

La préparation ne réalise aucun commit, push ou création de PR. Une exécution distante GitHub Actions ne pourra valider le nouveau code qu'après sa publication explicitement autorisée ; le succès d'un ancien commit n'est pas une preuve pour de nouveaux changements.

Le scanner réduit le risque de publication accidentelle avec des règles de chemins, types et signatures de secrets. Il ne remplace pas la revue humaine et n'affirme pas une absence universelle de secrets dans tout l'historique Git. Les valeurs détectées sont toujours masquées dans ses rapports.
