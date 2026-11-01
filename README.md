# 💌 Capsule Temporelle de Couple

Un espace privé à deux, conçu comme cadeau d’anniversaire pour le **27 novembre**. Chaque mois, chacun dépose des photos, anecdotes et mots doux dans une capsule scellée. Les dépôts restent cachés à l’autre membre jusqu’au **25 du mois suivant, à minuit dans le fuseau horaire du couple**.

L’interface évoque un carnet de souvenirs : papier crème (`#fdfbf7`), lettre et sceau, compte à rebours et souvenirs présentés comme des Polaroids. L’application est utilisable sur téléphone et installable comme PWA.

## Le concept

- **La lettre centrale et le compte à rebours** indiquent quand aura lieu la prochaine ouverture.
- **Le Rituel du 25** : la capsule d’un mois s’ouvre le 25 du mois suivant. Par exemple, les souvenirs déposés en octobre deviennent visibles le 25 novembre.
- **Les dépôts restent privés** : chacun peut relire ses propres dépôts avant l’ouverture, mais l’autre membre ne peut ni lire les notes ni ouvrir les photos.
- **Les archives** rassemblent les capsules ouvertes qui contiennent des souvenirs.
- **Les rappels push** peuvent être envoyés manuellement par l’admin aux appareils ayant activé les notifications.

## Fonctionnalités

- Deux comptes privés, accessibles avec un profil et un code personnel de quatre chiffres.
- Ajout d’une note, d’une photo prise avec l’appareil mobile ou d’une photo sélectionnée dans la galerie.
- Photos JPEG, PNG ou WebP, jusqu’à 10 Mo par fichier.
- Verrouillage des données et des fichiers appliqué côté Supabase avec les politiques RLS et Storage — pas seulement masqué dans l’interface.
- Vue admin limitée au compte `admin`, avec état de remplissage par membre et bouton d’envoi de rappel.
- Archives des capsules ouvertes qui contiennent des souvenirs.
- Manifest, icônes et service worker pour l’installation PWA. La connexion à Internet reste nécessaire pour s’authentifier et charger les souvenirs.

## Stack technique

- **Frontend** : HTML5, CSS3 et JavaScript vanilla avec Vite.
- **Authentification par code, base PostgreSQL et stockage privé** : Supabase Auth et Edge Functions.
- **Push Web** : service worker et fonction Edge Supabase.
- **Hébergement** : Vercel (ou un hébergeur statique HTTPS compatible).
- **Code source** : GitHub.

## Lancement local

Prérequis : Node.js 20.19+ ou 22.12+.

```powershell
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Complète ensuite `.env.local` avec les valeurs de ton projet Supabase, puis lance :

```powershell
npm run dev
```

Ouvre l’adresse affichée par Vite, généralement `http://localhost:5173`. Pour lancer les tests du compte à rebours : `npm test`. Pour créer la version de production : `npm run build`.

> **Important :** ce dossier contient le code et la migration de la base, mais pas un serveur PostgreSQL ni un projet Supabase hébergé. La base, l’authentification et le stockage sont des services créés dans Supabase. Ils doivent être configurés une fois, puis le site local et celui de Vercel s’y connectent avec les variables d’environnement.

## Créer et connecter la base Supabase

### 1. Créer le projet Supabase

Le projet Supabase à utiliser est [amo-te (`ztdbinowgewepxajimxo`)](https://supabase.com/dashboard/project/ztdbinowgewepxajimxo). Il s’agit d’un projet **hébergé dans le cloud** ; le navigateur local de développement s’y connectera par Internet. Tu n’as pas à installer PostgreSQL sur ton ordinateur.

Dans **Project Settings → API Keys** (ou la section de connexion de l’accueil), récupère :

- l’URL du projet ;
- la clé publique **publishable** (ou la clé `anon` historique).

Ces deux valeurs sont utilisées par le navigateur. La clé `service_role` est secrète : **ne la mets jamais dans `.env.local` sous un nom `VITE_`, dans GitHub, dans Vercel comme variable publique, ni dans le code frontend**.

Le projet `amo-te` est déjà initialisé : le schéma principal, les règles de sécurité et le bucket privé sont installés ; le couple `Notre capsule` existe avec l’identifiant `2cf1992a-d5aa-4a92-b970-49cd3fd6dbe8` et son fuseau est `Europe/Paris`. Le fichier local `.env.local` est déjà relié à ce projet et ignoré par Git.

### 2. Créer les tables et les règles de confidentialité

Pour un projet neuf, dans le tableau de bord Supabase ouvre **SQL Editor**, colle le contenu de [`supabase/migrations/20261030000000_create_capsule.sql`](./supabase/migrations/20261030000000_create_capsule.sql), puis exécute-le. Cette migration crée :

- le couple, ses membres, les capsules, les souvenirs et les abonnements push ;
- les fonctions SQL qui créent les capsules du mois et donnent à l’admin le seul nombre de dépôts par personne ;
- le bucket privé `capsule-photos` ;
- les règles RLS/Storage qui contrôlent les membres, les rôles et la date d’ouverture.

Il n’est pas nécessaire d’installer PostgreSQL localement pour suivre cette méthode : l’application lancée sur `localhost:5173` utilise la base Supabase hébergée. La CLI Supabase est facultative si tu exécutes la migration dans SQL Editor. Pour lancer un serveur Supabase **entièrement sur ta machine**, la CLI et Docker Desktop sont en revanche nécessaires ; ce n’est pas le projet référencé ici.

Sur le projet amo-te déjà existant, les migrations de correction du stockage et de limitation des codes doivent aussi être exécutées une seule fois.

### 3. Comptes Auth

Deux comptes de test confirmés existent déjà dans **Authentication → Users** :

- `amo-te.admin@example.com` — rôle `admin` ;
- `amo-te.partner@example.com` — rôle `partner`.

Ce sont des adresses fictives sur le domaine réservé `example.com` : elles ne reçoivent pas de courrier. Elles restent l’identité interne des comptes Supabase, mais ne sont plus demandées dans l’écran de connexion. Avant d’offrir le site, crée deux utilisateurs avec les vraies adresses depuis **Authentication → Users**, puis remplace les adhésions de test et les UUID configurés dans les secrets de la fonction.

L’application n’a volontairement pas de formulaire d’inscription public. La création des comptes reste réservée au propriétaire du projet Supabase.

### Connexion par code personnel

L’écran de connexion demande de choisir **Enzo** ou **Ana**, puis de saisir un code personnel de quatre chiffres. Le compte Enzo conserve le rôle `admin` et ses contrôles d’administration. Le code est vérifié côté serveur par la fonction Supabase `login-with-code` et n’est jamais inclus dans le JavaScript public, le dépôt Git ou les variables publiques Netlify. Un code à quatre chiffres est moins sûr qu’un code plus long ; le limiteur bloque les essais répétés, mais choisis des codes différents et évite les codes faciles à deviner.

Pour activer cette connexion sur un projet Supabase :

1. Sur le projet amo-te existant, exécute [`supabase/migrations/20261030100000_fix_storage_object_name_policy.sql`](./supabase/migrations/20261030100000_fix_storage_object_name_policy.sql) et [`supabase/migrations/20261031100000_login_code_rate_limits.sql`](./supabase/migrations/20261031100000_login_code_rate_limits.sql) dans **SQL Editor**. La première corrige les politiques de photos ; la seconde crée le limiteur de tentatives, inaccessible aux comptes publics. Pour un projet neuf, la migration principale contient déjà la correction Storage.
2. Déploie [`supabase/functions/login-with-code/index.ts`](./supabase/functions/login-with-code/index.ts) comme fonction Edge `login-with-code`, avec la vérification JWT désactivée pour cette fonction : l’utilisateur n’a pas encore de session au moment où il entre son code. La fonction utilise ensuite les liens magiques Supabase uniquement côté serveur pour établir une session normale.
3. Dans les secrets Edge Functions du projet, configure :

   - `COUPLE_ID` : UUID du couple ;
   - `ADMIN_USER_ID` : UUID du compte admin ;
   - `PARTNER_USER_ID` : UUID du compte partenaire ;
   - `ADMIN_LOGIN_CODE` : code admin de quatre chiffres ;
   - `PARTNER_LOGIN_CODE` : code partenaire de quatre chiffres ;
   - `ALLOWED_ORIGINS` : origines séparées par une virgule, par exemple `https://amo-te-ana.netlify.app,http://localhost:5173`.

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis à la fonction par Supabase. Ne copie jamais la clé `service_role` dans le site ou dans Netlify.

La fonction limite à cinq les essais par profil et adresse IP sur une période de quinze minutes. Pour remplacer un code, modifie le secret correspondant dans Supabase ; ne le mets pas dans un fichier du dépôt. Les liens de récupération par e-mail ne sont pas utilisés par cette connexion.

### 4. Créer le couple et associer les comptes

Pour créer un nouveau couple de production ou remplacer les comptes de test, utilise le script [`supabase/seed.example.sql`](./supabase/seed.example.sql) :

1. Remplace `REMPLACE_PAR_TON_EMAIL` et `REMPLACE_PAR_EMAIL_PARTENAIRE` par les adresses utilisées dans Supabase Auth.
2. Si besoin, remplace `Europe/Paris` par le fuseau IANA du couple.
3. Colle le script dans SQL Editor du projet amo-te et exécute-le. L’UUID du couple est affiché dans le résultat `NOTICE`.

Tu peux aussi créer et associer le couple manuellement, sans le script :

```sql
insert into public.memberships (couple_id, user_id, role, display_name)
values
  ('UUID_DU_COUPLE', 'UUID_DE_TON_COMPTE', 'admin', 'Enzo'),
  ('UUID_DU_COUPLE', 'UUID_DU_COMPTE_PARTENAIRE', 'partner', 'Ana');
```

Un couple ne peut avoir qu’un membre `admin`. Les comptes doivent tous deux appartenir au même couple. Ne relance pas le script pour le couple déjà créé : il en crée un nouveau.

### 5. Renseigner les variables locales

Le fichier `.env.example` contient déjà l’URL du projet amo-te. Après l’avoir copié en `.env.local`, ajoute la clé publique et l’identifiant UUID du couple :

```dotenv
VITE_SUPABASE_URL=https://ztdbinowgewepxajimxo.supabase.co
VITE_SUPABASE_ANON_KEY=TA_CLE_PUBLISHABLE_OU_ANON
VITE_COUPLE_ID=UUID_DU_COUPLE
VITE_VAPID_PUBLIC_KEY=
```

Les trois premières valeurs suffisent pour l’application. Les codes personnels sont configurés comme secrets de la fonction Edge, pas dans `.env.local`. La clé VAPID ne sert qu’aux notifications. Après une modification de `.env.local`, redémarre Vite.

Dans le secret `ALLOWED_ORIGINS` de la fonction, autorise l’adresse locale `http://localhost:5173` et l’adresse HTTPS de production. Supabase vérifie aussi l’origine des requêtes avant d’accepter un code.

## Notifications push

Les notifications sont facultatives. Elles nécessitent HTTPS en production, un navigateur compatible et une autorisation explicite sur chaque appareil à notifier. Sur iPhone/iPad, le site doit être ajouté à l’écran d’accueil et les notifications Web sont prises en charge sur les versions compatibles d’iOS/iPadOS.

1. Génère une paire de clés VAPID, par exemple avec `npx web-push generate-vapid-keys`.
2. Mets la clé publique dans `VITE_VAPID_PUBLIC_KEY` (local et Vercel).
3. Lie la CLI Supabase au projet et déploie la fonction :

   ```powershell
   supabase login
   supabase link --project-ref ID_DU_PROJET
   supabase functions deploy send-reminder
   ```

4. Configure les secrets **sur Supabase**, jamais dans le frontend :

   ```powershell
   supabase secrets set VAPID_PUBLIC_KEY="..." VAPID_PRIVATE_KEY="..." VAPID_SUBJECT="mailto:ton-adresse@example.com" COUPLE_ID="UUID_DU_COUPLE"
   ```

   L’environnement de la fonction fournit les variables Supabase du projet. La clé privée VAPID et la clé `service_role` ne doivent jamais être exposées au navigateur. Chaque membre active les rappels sur son appareil ; l’admin peut ensuite envoyer un rappel manuel aux appareils inscrits. Il ne s’agit pas d’un envoi automatique programmé.

## Déploiement sur Vercel

1. Pousse le dépôt sur GitHub puis importe-le dans Vercel.
2. Choisis le preset **Vite**, la commande de build `npm run build` et le dossier de sortie `dist`.
3. Configure dans Vercel les variables suivantes :

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_COUPLE_ID`
   - `VITE_VAPID_PUBLIC_KEY` (si tu actives les notifications)

4. Configure l’origine de production dans le secret `ALLOWED_ORIGINS` de la fonction `login-with-code`, puis ajoute l’URL Vercel aux URL autorisées de Supabase si tu utilises des liens de récupération.
5. Redéploie la fonction Edge après son installation et redéploie le site.

La migration SQL et la fonction `send-reminder` sont déployées sur Supabase ; elles ne sont pas exécutées par le build Vercel.

## Comptes et confidentialité

| Compte | Accès |
|---|---|
| `partner` | Compte à rebours, ses propres dépôts avant l’ouverture, ajout de souvenirs et archives ouvertes |
| `admin` | Mêmes fonctions, panneau d’administration, compte des dépôts par membre et envoi de rappels push |

L’admin ne peut pas lire les souvenirs de l’autre membre avant l’ouverture. Les photos sont stockées dans un bucket privé et leurs URL temporaires sont délivrées après vérification des règles Storage. Les clés secrètes et les mots de passe ne doivent pas être ajoutés au dépôt.

## Roadmap

Les étapes cochées sont présentes dans le code. La création du projet hébergé, la configuration des comptes et le déploiement restent à faire dans les tableaux de bord associés.

### Étape 1 — Socle visuel et frontend

- [x] Design papier crème, typographie manuscrite, enveloppe et Polaroids responsive.
- [x] Compte à rebours basé sur le fuseau horaire du couple.
- [x] Formulaire d’ajout de texte, photo appareil ou galerie.

### Étape 2 — Supabase et authentification

- [x] Migration des tables, bucket privé, fonctions et politiques RLS.
- [ ] Connexion par code personnel (fonction Edge et secrets à déployer sur Supabase).
- [x] Enregistrement des souvenirs dans PostgreSQL et Supabase Storage.
- [x] Créer le projet Supabase, exécuter la migration et associer deux comptes de test.
- [ ] Remplacer les comptes de test par les deux adresses réelles avant d’offrir le site.

### Étape 3 — Dates et historique

- [x] Chaque capsule s’ouvre le 25 du mois suivant, à minuit dans le fuseau du couple.
- [x] L’accès aux notes et photos est verrouillé côté serveur jusqu’à l’ouverture.
- [x] Historique des capsules ouvertes contenant des souvenirs.

### Étape 4 — PWA et notifications

- [x] Manifest, icônes et service worker.
- [x] Abonnement push par appareil et bouton de rappel réservé à l’admin.
- [ ] Ajouter les clés VAPID, déployer la fonction Supabase et tester les appareils.
- [ ] Déployer le frontend HTTPS sur Vercel.

## Idées de contenu

- **Photos du quotidien** : un selfie, un petit moment drôle ou une capture à garder.
- **Cartes postales inversées** : « J’ai repensé à ce moment précis où… »
- **Défis et coupons** : « Bon pour un massage » ou un défi à réaliser à deux.
- **Compteurs mignons** : « Nombre de fois où tu m’as volé ma veste ce mois-ci ».

## Structure du dépôt

- `index.html`, `styles.css`, `script.js` : interface et interactions.
- `date-utils.js` : calculs de dates et fuseaux horaires.
- `tests/` : tests du compte à rebours.
- `public/` : manifeste, icônes et service worker PWA.
- `supabase/migrations/` : schéma PostgreSQL, fonctions, stockage et politiques.
- `supabase/seed.example.sql` : création du couple et rattachement des deux utilisateurs après création des comptes Auth.
- `supabase/functions/send-reminder/` : Edge Function d’envoi push.
- `pictures/museum/` : anciennes images conservées dans le dépôt ; elles ne sont pas importées automatiquement dans les capsules.

## Licence

Ce projet est distribué sous licence MIT. Voir [`LICENSE`](./LICENSE).
