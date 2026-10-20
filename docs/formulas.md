# Formules et calculs (ce fork)

Ce fork ajoute à Pulse un moteur de formules **audité, nommé et versionné** : chaque méthode a une fiche dans le
registre (`src/core/formulas/registry.ts`), chaque résultat porte l'id et la version de sa méthode, ses entrées avec
leurs unités (et la valeur imprimée quand une conversion a été faite), ce qui manque, et ses remarques. Les écrans
sont en français ; cette page aussi. Les tests vérifient la transcription des coefficients et l'algèbre, **pas la
validité clinique** : une équation reproduite correctement reste une prédiction, jamais une mesure.

Sources : les trois dossiers et l'addendum d'audit du 20 octobre 2026 (coefficients, unités, corrections), et le code
de Pulse pour ses propres scores.

## Ce que l'on choisit, et où

Réglages › **Calculs** (`calc_settings`, `src/server/calc.ts`) :

| Choix | Options | Effet |
|---|---|---|
| Modèle de charge (Strain) | Edwards 1993 (défaut) · Banister 1991 · noyau Cardio Load (variante Pulse) | Recalcule Strain et les activités sur tout l'historique (stage 1 est clé dessus). |
| Métabolisme de repos | Mifflin-St Jeor 1990 (défaut) · Harris-Benedict 1919 · Roza-Shizgal 1984 · Cunningham 1980 · Cunningham 1991 · Owen 1987 · Schofield 1985 · Henry-Oxford 2005 · ten Haaf 2014 (anthropométrique ou masse maigre) | L'écran Énergie. |
| Niveau d'activité | inactif · peu actif (défaut) · actif · très actif | Le multiplicateur PAL et l'équation EER 2023 de l'écran Énergie. |
| Âge sanguin | PhenoAge original 0,090165 (défaut) · erratum 2019 0,09165 | L'écran Âge sanguin. |
| Référence HRV | lissage de Pulse (défaut) · moyenne et écart-type · médiane et MAD ; fenêtre 28 à 60 nuits | Le panneau HRV. Recovery n'en dépend pas. |

**Recovery, Sommeil, Pulse Age, charge chronique/aiguë et SRI** gardent une seule méthode, celle de Pulse ; leurs
fiches sont dans le registre et sur `/more/formulas` pour la traçabilité.

## Ce que Pulse faisait déjà juste (vérifié contre l'audit)

| Point | Code | Verdict |
|---|---|---|
| EWMA de charge : α = 1 − e^(−1/τ), τ = 42 et 7 jours (0,023528 / 0,133122), pas `ewm(span)` | `src/core/scoring/trainingLoad.ts` | Conforme ; test numérique ajouté. |
| TRIMP de Banister à 0,64 pour les deux sexes, exposant 1,92 / 1,67 | `src/core/scoring/strain.ts` | Conforme au noyau publié par Google ; la variante féminine usuelle à 0,86 n'est pas proposée, et le registre le dit. |
| SRI = 200p − 100 sur −100..100 ; Consistance = max(0, SRI) | `src/core/algorithms/sleepRegularity.ts` | Conforme ; le recadrage est maintenant nommé dans « How Pulse works ». |
| ACWR descriptif | `src/core/scoring/readiness.ts` | Conforme ; la copie « sweet spot » a été retirée des écrans. |
| Baseline personnelle : EWMA winsorisée demi-vie 14/21 nuits (noop) | `src/core/scoring/baselines.ts` | Gardée pour Recovery ; les autres références s'affichent sans la remplacer. |

## Les méthodes

### Charge (Strain), `src/core/scoring/strain.ts`

Toutes passent par le même log : Effort = 100 × ln(TRIMP + 1) / ln(D), D étant le plafond de la méthode (24 h au
maximum, + 1), puis × 21/100 à l'affichage.

- **Edwards 1993** : minutes pondérées 1 à 5 dans les zones 50-60 … 90-100 % de réserve cardiaque ; D = 7 201.
- **Banister 1991** : par lecture, x = %HRR/100, taux 0,64 · x · e^(k·x), k = 1,92 (homme) / 1,67 (femme), sous un
  plancher de 10 % de réserve ; D = plafond − plancher + 1. Sources : Banister 1991 ; Morton, Fitz-Clarke & Banister
  1990.
- **Noyau Cardio Load (variante Pulse)** : même noyau ; 0 sous 30 % de réserve ; poids 0,5 (**paramètre de Pulse**,
  l'ampleur réelle n'est pas publiée) entre 30 et 40 % ; une lecture compte seulement si la minute bouge (pas > 0
  dans la minute, ou pendant une activité enregistrée). Source : Phillips, Roggen, Speed & Harle 2025 (arXiv
  2508.11613). Ce n'est pas Cardio Load : les filtres complets de Google ne sont pas publiés, et l'écran le dit.

Contrôle numérique (`strain.test.ts`) : 30 min à x = 0,60 → 36,455 (0,64/1,92), 42,163 (0,86/1,67), 31,377 (0,64/1,67).

### Charge ressentie, `src/core/formulas/sessionLoad.ts`

- **Session-RPE** (Foster 2001) = durée (min) × effort perçu CR-10, saisi sur chaque activité (« Effort ressenti »,
  table `activity_feedback`, hors des tables synchronisées).
- Sur 7 jours, repos compris (0) : **monotonie** = moyenne / écart-type (échantillon, n − 1), indéfinie si σ = 0 ;
  **strain de Foster** = charge hebdomadaire × monotonie (Foster 1998). Homonyme du Strain de Pulse, unités
  différentes, jamais additionnées. Une séance non notée rend la charge « au minimum », et c'est dit.

### Métabolisme, `src/core/formulas/metabolism.ts`

P en kg, T en cm (ten Haaf : mètres), A en années, FFM = masse maigre = P × (1 − %gras/100), calculée seulement si la
mesure de masse grasse a moins de 90 jours.

| Équation | Formule | Domaine |
|---|---|---|
| Mifflin-St Jeor 1990 | 10P + 6,25T − 5A + 5 (H) / − 161 (F) | 498 adultes nord-américains ; point de départ par défaut |
| Harris-Benedict 1919 | H 66,4730 + 13,7516P + 5,0033T − **6,7550**A ; F **655,0955** + 9,5634P + 1,8496T − 4,6756A | Adultes minces de 1919 ; surestime de 10 à 15 % |
| Roza-Shizgal 1984 | H 88,362 + 13,397P + 4,799T − 5,677A ; F 447,593 + 9,247P + 3,098T − 4,330A | Révision, robuste après 65 ans |
| Cunningham 1980 | 500 + 22 FFM | Réanalyse Harris-Benedict |
| Cunningham 1991 (« Katch-McArdle ») | 370 + 21,6 FFM | Revue synthétique, sportifs exclus ; le nom Katch-McArdle vient d'un manuel |
| Owen 1987 | H 879 + 10,2P ; F 795 + 7,18P | Sédentaires, petits échantillons |
| Schofield 1985 | tranches 18-30 / 30-60 / 60+ (poids seul) | Base italienne, surestime |
| Henry-Oxford 2005 | tranches, MJ/j × 239,006 | Base Oxford, Europe |
| ten Haaf 2014 | 11,936P + 587,728 T_m − 8,129A + 191,027 S + 29,279 (S = 1 homme) ; FFM : 22,771 FFM + 484,264 | 90 sportifs de 18 à 35 ans |

Convention d'anniversaire des tranches : la tranche change le jour des 30 et 60 ans. Une équation hors domaine calcule
quand même, avec une remarque.

- **Dépense totale** : par **PAL** (1,2 / 1,375 / 1,55 / 1,725 : conventions, pas une propriété de la personne) et par
  **EER 2023** (DRI, 4 niveaux × sexe, besoin total de maintien, pas un repos). Les calories de la montre sont
  affichées **à part**, comme estimation du fabricant.
- **MET** : brut MET × 3,5 × P / 200 × min ; net avec MET − 1.
- **Âge métabolique** : inversion de Mifflin, étiqueté « comparaison, pas une horloge ».

Contrôle numérique (`metabolism.test.ts`) : homme 40 ans / 80 kg / 180 cm / FFM 60 → Mifflin 1 730, Roza-Shizgal
1 797, Cunningham 1980 1 820, Cunningham 1991 1 666 ; à 30 ans, ten Haaf 1 989 et 1 851.

### Âge sanguin : PhenoAge, `src/core/formulas/phenoage.ts`

La branche originale de BioAge (`phenoage_calc.R`, orig = TRUE), coefficients complets :

```
x = −19,90667 − 0,03359355·albumine(g/L) + 0,009506491·créatinine(µmol/L) + 0,1953192·glucose(mmol/L)
    + 0,09536762·ln(CRP mg/dL) − 0,01199984·lymphocytes(%) + 0,02676401·VGM(fL) + 0,3306156·RDW-CV(%)
    + 0,001868778·PAL(U/L) + 0,05542406·leucocytes(10⁹/L) + 0,08035356·âge
m = 1 − exp(−1,51714·eˣ / 0,007692696)
PhenoAge = 141,50225 + ln(−0,0055305·ln(1 − m)) / d
```

d = **0,090165** (original, défaut) ou **0,09165** (erratum PLoS Medicine 2019), deux versions publiées, offertes
comme variante nommée. Le calcul utilise la forme algébriquement équivalente et stable
141,50225 + [ln(0,0055305 × 1,51714 / 0,007692696) + x] / d (la forme publiée perd ses chiffres quand m → 1).

Règles (`src/server/medical/analytes.ts`) :
- les analyses sont reconnues par leur clé ou leur libellé (FR/EN), puis **converties** : CRP mg/L ÷ 10 ; créatinine
  mg/dL × 88,4 ; glucose mg/dL ÷ 18,018 ou g/L × 5,551 ; albumine g/dL × 10 ; leucocytes /µL ÷ 1000 ; lymphocytes en
  nombre absolu → % des leucocytes du même jour ;
- une unité inconnue, ou une RDW-SD (fL) à la place de la RDW-CV (%), rend le marqueur **manquant** avec une note,
  jamais converti par devinette ;
- un résultat « < x » est pris à **x / 2** (règle `loq_half`, affichée) ; une CRP nulle est refusée (ln) ;
- dernier résultat par marqueur ; un marqueur de plus de 180 jours rend le résultat **provisoire** ;
- l'écart affiché est PhenoAge − âge réel (« écart simple »), pas le « PhenoAgeAccel » (résidu) des publications.

Contrôle numérique (`phenoage.test.ts`) : CRP × 10 → +2,4355 ans ; 0,090165 → 0,09165 : +1,81 an à P = 30, +1,48 à
50, +1,16 à 70 ; forme stable = forme directe.

Pulse Age (Santé › Healthspan) reste séparé : un indice de comportements, pas un âge sanguin ; les deux ne sont
jamais moyennés. Bortz (cystatine C), KDM et les horloges ADN sont **hors périmètre** : leurs coefficients ou leurs
populations de référence n'ont pas été vérifiés.

### Calculs cliniques, `src/core/formulas/clinical.ts`

Affichés sur Analyses quand les entrées existent : **DFGe CKD-EPI 2021** (créatinine mg/dL, κ 0,7/0,9, α −0,241/−0,302,
142 · min^α · max^−1,2 · 0,9938^âge · 1,012 si femme), **non-HDL** (même unité imprimée), **TyG** = ln(TG × glucose / 2)
en mg/dL (convention nommée), **HOMA1-IR** = glucose(mmol/L) × insuline(µU/mL) / 22,5.

### Référence HRV, `src/core/formulas/hrvReference.ts`

Sur le lnRMSSD des nuits : tendance = moyenne des 7 dernières nuits (≥ 4 valides) ; référence = les N nuits **avant**
la nuit évaluée (N = 28 à 60, réglage) par la méthode choisie (EWMA de Pulse sur le ln, moyenne/écart-type, ou
médiane/1,4826 × MAD), σ plancher 0,08 ; bande ±0,5 σ (le « smallest worthwhile change » de Plews & Buchheit) ; z de
la dernière nuit ; CV7 = 100 × σ/μ du lnRMSSD sur 7 nuits. Chaque point du graphique porte la bande des nuits qui le
précèdent, jamais des suivantes. Les fenêtres et le seuil sont des paramètres de conception, dits tels quels.

## Traçabilité

`FormulaResult` (`src/core/formulas/types.ts`) : `id`, `version`, `value`, `unit`, `window`, `inputs` (valeur,
unité, jour, `from` = valeur imprimée, `rule`), `missing`, `coverage`, `notes`. Les requêtes l'enveloppent dans un
`Metric` (`reason: "no_data"` quand incomplet) ; les écrans montrent la valeur, la méthode, les entrées converties,
les manquants et les remarques. `/more/formulas` liste chaque fiche avec la méthode en cours, sa version, son domaine
et ses sources ; Réglages › Calculs renvoie dessus.

## Tables

- `calc_settings` : une ligne par personne (méthode de Strain, équation de repos, niveau d'activité, variante PhenoAge,
  méthode et fenêtre de référence HRV). Hors `SYNCED_TABLES`.
- `activity_feedback` : `(user_id, exercise_id)`, `rpe` (CR-10 par demi-point), `note`. Hors `SYNCED_TABLES` ; perdue
  si l'exercice est réémis sous un autre id.

Changer le modèle de Strain marque tous les jours à recalculer (comme un changement de profil) ; `SCORING_VERSION` 11
a ajouté la méthode et le sexe à la clé de stage 1 et la méthode à la clé du point de reprise de stage 2, et les
empreintes `golden.test.ts` de la version 11 sont identiques à celles de la version 10 sur toutes les colonnes de
scores : le défaut n'a rien déplacé.
