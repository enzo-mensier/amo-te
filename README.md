# Amo-te

Une petite page web romantique, personnalisable, créée comme cadeau d'anniversaire. Elle rassemble un musée de souvenirs, des lettres « Ouvre quand… », un compteur de temps passé ensemble et une musique d'ambiance.

L'interface est disponible en français et en portugais.

## Utilisation

Aucune installation ni compilation n'est nécessaire. Ouvrez `amo-te.html` dans un navigateur. Vous pouvez aussi servir le dossier avec un serveur web local, par exemple :

```bash
python -m http.server 8000
```

Puis ouvrez <http://localhost:8000/amo-te.html>.

## Personnalisation

- **Date du compteur** : modifiez `START_DATE` au début de `script.js` (format `AAAA-MM-JJTHH:mm:ss`).
- **Textes, lettres et souvenirs** : modifiez les données dans `lang/fr.js` et `lang/pt.js`. Gardez les deux fichiers synchronisés si vous souhaitez proposer les mêmes contenus dans les deux langues.
- **Photos** : changez la propriété `photoUrl` des souvenirs dans ces fichiers. Les photos fournies se trouvent dans `pictures/museum/`; utilisez leur chemin relatif, par exemple `pictures/museum/14oct.jpg`.
- **Musique et polices** : la musique de fond et les polices sont chargées depuis des services externes dans `amo-te.html`. Une connexion Internet est nécessaire pour ces ressources ainsi que pour les photos Unsplash utilisées par défaut.

## Structure

- `amo-te.html` : page principale
- `styles.css` : styles et mise en page
- `script.js` : interactions et compteur
- `lang/` : textes en français et en portugais
- `pictures/museum/` : photos fournies pour personnaliser le musée

## Licence

Ce projet est distribué sous licence MIT. Consultez le fichier [LICENSE](LICENSE).
