# Amo-te — Notre capsule

Une capsule privée pour garder des photos et des mots doux, puis les découvrir ensemble au fil des mois. L’application est conçue pour deux comptes, Enzo (administrateur) et Ana, avec une interface chaleureuse inspirée d’un carnet de souvenirs.

> **Important :** ce dépôt contient le code de l’application, pas les données du couple. Les comptes, souvenirs, photos, clés et abonnements push sont hébergés dans Supabase. Ne publie jamais de données personnelles ou de secrets dans le dépôt.

## Sommaire

- [Fonctionnement](#fonctionnement)
- [Technologies](#technologies)
- [Démarrage local](#démarrage-local)
- [Configuration de Supabase](#configuration-de-supabase)
- [Déploiement sur Netlify](#déploiement-sur-netlify)
- [Notifications push](#notifications-push)
- [Sécurité et confidentialité](#sécurité-et-confidentialité)
- [Tests et qualité](#tests-et-qualité)
- [Structure du projet](#structure-du-projet)
- [Licence](#licence)

## Fonctionnement

- Pendant le mois, Ana et Enzo peuvent déposer des notes, des photos prises avec l’appareil ou des images de la galerie. Les capsules du mois s’ouvrent le **25 à minuit dans le fuseau du couple**.
- Avant l’ouverture, les souvenirs restent cachés. Le 25, le compte à rebours laisse place à une grande lettre à ouvrir. Le serveur refuse une ouverture anticipée et ne révèle les notes et photos qu’après l’ouverture explicite.
- Après l’ouverture, les souvenirs apparaissent dans l’ordre chronologique. Un récapitulatif HTML téléchargeable comprend les notes, les photos intégrées et le nombre de souvenirs de chaque personne.
- Le bouton **Relancer la capsule** n’apparaît qu’après l’ouverture. Il démarre le cycle suivant ; la capsule ouverte rejoint alors **Nos archives**, consultables et téléchargeables comme la capsule actuelle.
- Le compte Enzo dispose du panneau d’administration, des compteurs de dépôts et de l’envoi manuel de notifications push personnalisées.
- L’application est responsive et installable comme PWA. La connexion Internet reste nécessaire pour s’authentifier et accéder aux données.

Les images acceptées sont JPEG, PNG et WebP, jusqu’à 10 Mo. L’interface propose séparément une entrée appareil photo et une entrée galerie ; l’ouverture de l’appareil photo dépend du navigateur et de l’appareil.

## Technologies

- **Interface :** HTML, CSS et JavaScript natif, compilés avec Vite.
- **Données et authentification :** Supabase Auth, PostgreSQL, fonctions Edge et règles RLS.
- **Photos :** bucket Supabase Storage privé avec URL signées.
- **Notifications :** Web Push, clés VAPID, service worker et fonction Edge Supabase.
- **Hébergement prévu :** Netlify avec déploiement depuis la branche `main`.

## Démarrage local

Prérequis : Node.js 20.19+ ou 22.12+.

```powershell
npm ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Renseigne `.env.local` avec les valeurs publiques de ton projet Supabase :

```dotenv
VITE_SUPABASE_URL=https://TON_PROJET.supabase.co
VITE_SUPABASE_ANON_KEY=TA_CLE_PUBLISHABLE_OU_ANON
VITE_COUPLE_ID=UUID_DU_COUPLE
VITE_VAPID_PUBLIC_KEY=
```

`VITE_VAPID_PUBLIC_KEY` est facultative dans cette version : une clé publique par défaut est incluse dans l’application. Les variables `VITE_` sont intégrées au code livré au navigateur ; n’y mets jamais un mot de passe, un code de connexion, une clé `service_role` ou une clé VAPID privée.

Lance le serveur de développement :

```powershell
npm run dev
```

Vite affiche l’adresse locale, généralement `http://localhost:5173`. Le site local se connecte au projet Supabase configuré ; une photo ou un souvenir ajouté localement écrit donc dans cette base.

## Configuration de Supabase

### Base de données et stockage

Pour un nouveau projet Supabase, exécute les migrations dans l’ordre chronologique depuis **SQL Editor** :

1. `supabase/migrations/20261030000000_create_capsule.sql`
2. `supabase/migrations/20261030100000_fix_storage_object_name_policy.sql`
3. `supabase/migrations/20261031100000_login_code_rate_limits.sql`
4. `supabase/migrations/20261102110000_capsule_opening_cycle.sql`
5. `supabase/migrations/20261108100000_login_pins.sql`
6. `supabase/migrations/20261127100000_fix_automatic_capsule_opening.sql`

Elles créent les tables, les fonctions SQL, les règles RLS et Storage, le bucket privé `capsule-photos`, le limiteur d’essais de connexion, le cycle d’ouverture/redémarrage des capsules et le stockage privé des PIN hashés. Sur un projet déjà initialisé, n’exécute pas de nouveau la migration initiale : vérifie quelles migrations ont déjà été appliquées et applique seulement les migrations manquantes, dans l’ordre.

Pour un nouveau couple :

1. Crée deux utilisateurs dans **Authentication → Users**.
2. Fais une copie de `supabase/seed.example.sql`, remplace les deux adresses de démonstration et exécute le script une seule fois.
3. Note l’UUID du couple retourné par le script et utilise-le comme `VITE_COUPLE_ID`.

Le script de seed crée un **nouveau couple**. Ne le relance pas pour un couple existant. Les identifiants des comptes Auth restent côté serveur ; l’écran public demande uniquement le profil et son code.

### Connexion par code

La fonction `login-with-code` vérifie le PIN côté serveur, applique une limite de cinq tentatives par profil et adresse IP sur quinze minutes, puis crée une session Supabase Auth. Au premier login réussi après la migration, le PIN legacy est converti en HMAC avec un secret serveur et son hash est enregistré dans `login_pins`. Les PIN ne doivent être stockés ni dans le frontend, ni dans `.env.local`, ni dans GitHub.

Un utilisateur connecté peut modifier son PIN depuis **Changer mon PIN**. Le serveur vérifie la session, l’appartenance au couple et le PIN actuel; les tentatives sont limitées avec le même quota de cinq essais sur quinze minutes.

Configure les secrets suivants dans **Supabase → Edge Functions → Secrets** :

- `COUPLE_ID` : UUID du couple ;
- `ADMIN_USER_ID` et `PARTNER_USER_ID` : UUID des utilisateurs Supabase Auth ;
- `ADMIN_LOGIN_CODE` et `PARTNER_LOGIN_CODE` : codes distincts de quatre chiffres ;
- `PIN_HASH_SECRET` : secret aléatoire d’au moins 32 octets utilisé pour protéger les hash HMAC des PIN ;
- `ALLOWED_ORIGINS` : origines autorisées séparées par des virgules, par exemple `https://TON_SITE.netlify.app,http://localhost:5173`.

Les variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournies à la fonction par Supabase. Ne les recopie jamais dans le frontend ; la clé `service_role` doit rester secrète.

Déploie la fonction avec la vérification JWT désactivée, car l’utilisateur n’a pas encore de session lorsqu’il soumet son code :

```powershell
supabase login
supabase link --project-ref ID_DU_PROJET
supabase functions deploy login-with-code --no-verify-jwt
supabase functions deploy change-pin
```

Applique d’abord la migration `20261108100000_login_pins.sql`, configure `PIN_HASH_SECRET`, puis redéploie `login-with-code` et déploie `change-pin`. Les PIN existants continuent de fonctionner via les anciens secrets jusqu’au premier login réussi de chaque membre; après leur migration, ces secrets peuvent être retirés.

## Déploiement sur Netlify

1. Connecte le dépôt GitHub à un site Netlify et sélectionne la branche `main`.
2. Configure les paramètres de build à la racine du dépôt :
   - **Build command :** `npm run build`
   - **Publish directory :** `dist`
   - **Base directory :** laisse vide.
3. Dans les variables d’environnement Netlify, ajoute :
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_COUPLE_ID`
   - facultatif : `VITE_VAPID_PUBLIC_KEY`
4. Ajoute l’origine HTTPS de Netlify à `ALLOWED_ORIGINS` dans les secrets Supabase.
5. Déclenche un déploiement. Chaque modification de variable d’environnement nécessite un nouveau build.

Le fichier `vercel.json` ne configure que quelques en-têtes statiques pour Vercel ; il n’est pas requis par Netlify.

## Notifications push

L’envoi est manuel depuis **Enzo → Administration → Personnaliser une notification**. Il n’existe pas de rappel automatique programmé.

### Inscrire un appareil

Chaque destinataire doit faire cette étape pour **chaque navigateur ou appareil** :

1. Ouvrir le site en HTTPS et se connecter au compte concerné.
2. Appuyer sur **Activer les rappels sur cet appareil**.
3. Autoriser les notifications dans le navigateur.
4. Vérifier la confirmation d’activation.

Sur iPhone/iPad, le site doit être ajouté à l’écran d’accueil et ouvert depuis son icône ; les notifications Web nécessitent iOS/iPadOS 16.4 ou ultérieur. Si les notifications ont déjà été refusées, il faut d’abord rétablir l’autorisation dans les réglages du navigateur.

### Configuration et envoi

Une paire de clés VAPID est requise. La clé publique sert au navigateur à créer l’abonnement ; la clé privée ne doit exister que dans les secrets Supabase. Configure dans ces secrets :

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (par exemple une adresse `mailto:` de contact)
- `COUPLE_ID`
- `ALLOWED_ORIGINS`

La fonction utilise également les secrets Supabase intégrés à son environnement. Déploie `send-reminder` en laissant la vérification JWT activée :

```powershell
supabase functions deploy send-reminder
```

Dans le panneau admin, Enzo choisit Ana, Enzo ou les deux, puis indique le titre (60 caractères maximum), le message (240 caractères maximum) et un chemin interne tel que `/`. La fonction vérifie la session, confirme le rôle admin, valide le contenu et envoie aux abonnements des seuls destinataires sélectionnés.

Le compte rendu affiche les appareils inscrits, les envois acceptés par les services push et les échecs. « Aucun appareil inscrit » signifie que le destinataire n’a pas terminé l’inscription sur un appareil. Un envoi accepté ne garantit pas que l’appareil a affiché la notification : il doit être joignable et l’autorisation doit rester active. Les abonnements expirés sont supprimés après une réponse du fournisseur indiquant qu’ils ne sont plus valides.

Le service worker affiche la notification et ouvre le chemin interne demandé lorsque l’utilisateur appuie dessus. Il ne contient pas les clés privées.

## Sécurité et confidentialité

- Les notes et photos avant ouverture sont protégées par les règles RLS et Storage côté Supabase.
- Les images résident dans un bucket privé ; l’application crée des URL signées temporaires après autorisation.
- Le panneau d’administration est réservé à un membre dont le rôle Supabase vaut `admin`. La fonction d’envoi vérifie elle aussi ce rôle côté serveur.
- Les codes d’accès, secrets VAPID et clés `service_role` ne doivent pas être committés.
- Les codes à quatre chiffres sont une facilité d’usage, pas un remplacement d’un mot de passe robuste. Le limiteur réduit les essais répétés ; choisissez des codes différents et non évidents.
- Le dépôt peut contenir des photos d’exemple historiques dans `pictures/museum/`. Elles ne sont pas importées automatiquement dans les capsules.

## Tests et qualité

```powershell
npm test
npm run build
```

Les tests couvrent les calculs de date/fuseau horaire et la validation des notifications personnalisées. Le build vérifie la compilation Vite. Les tests automatisés ne remplacent pas un essai sur de vrais appareils pour les notifications push, ni la vérification des permissions du navigateur.

Avant de tester un dépôt photo, vérifie que l’environnement pointe vers le bon projet Supabase : le téléversement ajoute réellement un fichier à son bucket.

## Structure du projet

```text
index.html                         Écrans et formulaires
script.js                          Auth, capsules, photos, archives et push
date-utils.js                      Calcul des dates et fuseaux horaires
push-utils.js                      Normalisation et validation des messages push
styles.css                         Styles responsive
tests/                             Tests Node.js
public/                            Icônes, manifeste PWA et service worker
supabase/migrations/               Schéma, RLS, Storage et limiteur
supabase/functions/login-with-code/ Authentification par code
supabase/functions/change-pin/      Changement de PIN authentifié
supabase/functions/send-reminder/  Envoi Web Push réservé à l’admin
supabase/seed.example.sql          Exemple de création d’un couple et de ses membres
```

## Licence

Distribué sous licence MIT. Voir [LICENSE](./LICENSE).
