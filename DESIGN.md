# DESIGN.md — Sabi (IUT FV Bandjoun)

Ce fichier décrit ce qui existe déjà dans `index.html` et les décisions prises pour que l'appli
ne ressemble pas à un site généré par une IA. Toute modification de style respecte ce fichier.
Ce qui reste à trancher est marqué **[À DÉCIDER]**.

## Direction
Appli d'étude pour les étudiants de l'IUT FV : fond sombre, or pour le savoir et l'accent, vert
pour la réussite. Sobre, lisible sur un petit écran, sans décor inutile.
Références : **[À DÉCIDER]** (2 ou 3 sites ou applis aimés, à donner pour affiner le style).

## Couleurs (variables CSS, déjà en place dans `:root`)
| Rôle | Variable | Code |
|---|---|---|
| Principale (accent) | `--gold` | `#f2ca50` |
| Texte sur fond doré | `--gold-ink` | `#3c2f00` |
| Succès, validation | `--forest` | `#77dd6a` |
| Erreur, alerte | `--terra` | `#ffb4ab` |
| Fond | `--bg` | `#131313` |
| Surfaces | `--surface` / `--surface-2` | `#1c1b1b` / `#201f1f` |
| Bordures | `--border` / `--border-strong` | `#4d4635` / `#99907c` |
| Texte | `--text` / `--text-muted` / `--text-faint` | `#e5e2e1` / `#d0c5af` / `#99907c` |

Règle : aucune couleur écrite en dur dans un nouveau composant, on utilise `COLORS` / les variables. Ajout : `COLORS.alerte` (`#f97316`) pour les alertes et la série. Restent en dur volontairement : les métaux des paliers de badges (argent, bronze), les teintes de la carte et le violet de certains badges.
État actuel : les dégradés (24) sont des halos or/vert très légers et des barres de progression,
ils servent l'identité, on les garde. **À vérifier** : quelques couleurs en dur restantes
(`#4ade80`, `#a1a1aa`) à ramener sur `--forest` et `--text-faint`.

## Typographie
- **Inter** pour les textes et titres, **JetBrains Mono** pour les chiffres, libellés et étiquettes.
- Tailles en usage : `text-[10px]`/`text-[11px]` (légendes), `text-xs`, `text-sm` (texte), `text-base`, `text-2xl` (scores).
- Titres en `font-bold`, texte en `font-normal`, étiquettes en JetBrains Mono. Échelle à figer si tu veux aller plus loin.

## Formes
- **Un seul rayon : `rounded-lg`** (cartes, champs, images, boutons carrés). `rounded-full` est réservé aux pilules, pastilles et avatars. Appliqué partout (`rounded-xl`, `rounded-2xl`, `rounded-md` et `rounded` ont disparu).
- Espacements : grille de 4 px (classes Tailwind `1, 2, 3, 4, 6, 8`).

## Icônes
- **Un seul jeu : le composant `Icon` de `index.html`** (tracés en trait 24 × 24, `currentColor`,
  épaisseur 2). Toute nouvelle icône s'ajoute dans `ICON_PATHS`, dans le même style.
- **Plus aucun emoji dans l'appli** (décision prise). La mascotte Sabi est l'icône `lion`,
  avec une pastille d'humeur (`moon`, `sparkles`, `headphones`).
- Dans les phrases, on décrit le symbole par un mot ("le cœur", "le menu") plutôt que de le coller.

## Mouvement
- Animations autorisées : apparition douce, retour visuel au clic et au survol, barre de progression, flamme de série, roue du jour (fonction du jeu).
- Supprimées : la lueur de fond qui dérive, la pulsation du logo et la brillance qui balaie les boutons (purement décoratives).
- Le réglage système « réduire les animations » est déjà respecté (`prefers-reduced-motion`).

## Ton des textes
- Tutoiement, phrases courtes, on dit concrètement ce que l'étudiant gagne.
- Pas d'emoji, pas de formule creuse (« Boostez… », « Libérez votre potentiel… », « tout-en-un »).
- **Zéro tiret long (—) dans les textes affichés** : remplacé par une virgule (suite de phrase) ou un point (nouvelle phrase). Un champ vide s'écrit avec un tiret simple « - ».
- Aucun faux avis, chiffre ou logo : on n'affiche que des preuves confirmées.
