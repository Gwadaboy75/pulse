// The formula registry: one entry per method Pulse computes or exposes, with its version, sources and domain
// (docs/formulas.md). The screens read it to show where a number comes from; the calculations stamp its id and
// version on every result. Entries for Pulse's own scorers (src/core/scoring, src/core/algorithms) cite the code's
// constants; the method itself lives there.
import type { FormulaId, FormulaRef } from "./types";

const TASK_FORCE = { label: "Task Force ESC/NASPE 1996, Circulation 93:1043", url: "https://doi.org/10.1161/01.CIR.93.5.1043" };
const BANISTER = { label: "Banister 1991, in Physiological Testing of the High-Performance Athlete (Human Kinetics)" };
const MORTON = { label: "Morton, Fitz-Clarke & Banister 1990, J Appl Physiol 69:1171", url: "https://doi.org/10.1152/jappl.1990.69.3.1171" };
const GOOGLE_CL = { label: "Phillips, Roggen, Speed & Harle 2025, Adaptive Cardio Load Targets, arXiv 2508.11613", url: "https://arxiv.org/abs/2508.11613" };
const NOOP = { label: "noop analytics (ryanbr/noop, PolyForm Noncommercial 1.0.0)", url: "https://github.com/ryanbr/noop" };

export const FORMULAS: Record<FormulaId, FormulaRef> = {
  // ── Resting metabolism ──────────────────────────────────────────────────────
  "rmr.mifflin1990": {
    id: "rmr.mifflin1990",
    name: "Mifflin-St Jeor (1990)",
    version: "1",
    sources: [{ label: "Mifflin et al. 1990, Am J Clin Nutr 51:241", url: "https://pubmed.ncbi.nlm.nih.gov/2305711/" }],
    domain: "498 adultes nord-américains de 19 à 78 ans, poids normal à obèse ; forme simplifiée publiée (10P + 6,25T − 5A + 5 / − 161).",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "heightCm", unit: "cm" },
      { key: "ageYears", unit: "ans" },
    ],
    notes: ["Point de départ documenté pour un adulte sans mesure ; sous-estime les profils très musclés."],
  },
  "rmr.harrisBenedict1919": {
    id: "rmr.harrisBenedict1919",
    name: "Harris-Benedict (1919)",
    version: "1",
    sources: [
      { label: "Harris & Benedict 1918, PNAS 4:370", url: "https://doi.org/10.1073/pnas.4.12.370" },
      { label: "Coefficients vérifiés : PMC6935811 (2019), tableau des comparateurs", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6935811/" },
    ],
    domain: "239 adultes minces (Carnegie, Boston) ; coefficients H 66,4730 / 13,7516 / 5,0033 / −6,7550 ; F 655,0955 / 9,5634 / 1,8496 / −4,6756.",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "heightCm", unit: "cm" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "rmr.rozaShizgal1984": {
    id: "rmr.rozaShizgal1984",
    name: "Harris-Benedict révisée (Roza & Shizgal 1984)",
    version: "1",
    sources: [{ label: "Roza & Shizgal 1984, Am J Clin Nutr 40:168", url: "https://doi.org/10.1093/ajcn/40.1.168" }],
    domain: "337 sujets ; révision des coefficients de 1919, robuste après 65 ans.",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "heightCm", unit: "cm" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "rmr.cunningham1980": {
    id: "rmr.cunningham1980",
    name: "Cunningham (1980)",
    version: "1",
    sources: [{ label: "Cunningham 1980, Am J Clin Nutr 33:2372", url: "https://doi.org/10.1093/ajcn/33.11.2372" }],
    domain: "Réanalyse de la cohorte Harris-Benedict avec une masse maigre estimée : 500 + 22 × FFM.",
    inputs: [{ key: "ffmKg", unit: "kg" }],
  },
  "rmr.cunningham1991": {
    id: "rmr.cunningham1991",
    name: "Cunningham (1991), dite « Katch-McArdle »",
    version: "1",
    sources: [{ label: "Cunningham 1991, Am J Clin Nutr 54:963", url: "https://pubmed.ncbi.nlm.nih.gov/1957828/" }],
    domain: "Revue synthétique, 223 à 239 adultes, sportifs exclus : 370 + 21,6 × FFM. Le nom Katch-McArdle vient d’un manuel, sans article propre.",
    inputs: [{ key: "ffmKg", unit: "kg" }],
  },
  "rmr.owen1987": {
    id: "rmr.owen1987",
    name: "Owen (1986-1987)",
    version: "1",
    sources: [{ label: "Owen et al. 1987, Am J Clin Nutr 46:875", url: "https://doi.org/10.1093/ajcn/46.6.875" }],
    domain: "Poids seul, petits échantillons de sédentaires américains.",
    inputs: [{ key: "weightKg", unit: "kg" }],
  },
  "rmr.schofield1985": {
    id: "rmr.schofield1985",
    name: "Schofield / FAO-OMS-UNU (1985)",
    version: "1",
    sources: [{ label: "Schofield 1985, Hum Nutr Clin Nutr 39 Suppl 1:5", url: "https://pubmed.ncbi.nlm.nih.gov/4044297/" }],
    domain: "7 173 sujets de 114 études, dont près de la moitié d’Italiens ; tranches 18-30 / 30-60 / 60 ans et plus (bascule à l’anniversaire).",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "rmr.henryOxford2005": {
    id: "rmr.henryOxford2005",
    name: "Henry / Oxford (2005)",
    version: "1",
    sources: [{ label: "Henry 2005, Public Health Nutr 8:1133 (tableau 12, poids seul)", url: "https://doi.org/10.1079/PHN2005801" }],
    domain: "10 552 sujets, Italiens de Schofield exclus, sujets tropicaux ajoutés ; MJ/j convertis à 239,006 kcal/MJ ; tranches à l’anniversaire.",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "rmr.tenHaaf2014": {
    id: "rmr.tenHaaf2014",
    name: "ten Haaf & Weijs (2014), anthropométrique",
    version: "1",
    sources: [
      { label: "ten Haaf & Weijs 2014, PLoS ONE 9:e108460", url: "https://doi.org/10.1371/journal.pone.0108460" },
      { label: "Méta-analyse 2023, Sports Med : 80,2 % des estimations à ±10 %", url: "https://doi.org/10.1007/s40279-023-01896-z" },
    ],
    domain: "90 sportifs récréatifs néerlandais de 18 à 35 ans ; taille en mètres.",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "heightCm", unit: "cm" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "rmr.tenHaaf2014Ffm": {
    id: "rmr.tenHaaf2014Ffm",
    name: "ten Haaf & Weijs (2014), masse maigre",
    version: "1",
    sources: [{ label: "ten Haaf & Weijs 2014, PLoS ONE 9:e108460", url: "https://doi.org/10.1371/journal.pone.0108460" }],
    domain: "Mêmes 90 sportifs ; masse maigre mesurée par BodPod : 22,771 × FFM + 484,264.",
    inputs: [{ key: "ffmKg", unit: "kg" }],
  },
  "tdee.pal": {
    id: "tdee.pal",
    name: "Dépense totale par multiplicateur d’activité (PAL)",
    version: "1",
    sources: [{ label: "FAO/OMS/UNU 2004, Human energy requirements (niveaux d’activité)" }],
    domain: "Convention : 1,2 inactif, 1,375 peu actif, 1,55 actif, 1,725 très actif, appliquée au repos estimé.",
    inputs: [{ key: "rmr", unit: "kcal/j" }],
  },
  "tdee.eer2023": {
    id: "tdee.eer2023",
    name: "Besoin énergétique estimé, DRI 2023",
    version: "1",
    sources: [{ label: "NASEM 2023, Dietary Reference Intakes for Energy", url: "https://doi.org/10.17226/26818" }],
    domain: "Adultes de 19 ans et plus, eau doublement marquée ; un besoin total de maintien, pas un métabolisme de repos.",
    inputs: [
      { key: "weightKg", unit: "kg" },
      { key: "heightCm", unit: "cm" },
      { key: "ageYears", unit: "ans" },
    ],
  },
  "energy.met": {
    id: "energy.met",
    name: "Dépense par MET",
    version: "1",
    sources: [{ label: "Compendium of Physical Activities 2024 (Herrmann et al.)", url: "https://pacompendium.com/" }],
    domain: "1 MET = 3,5 mL O₂/kg/min ≈ 5 kcal par litre d’O₂ ; le repos réel n’est pas toujours exactement 1 MET.",
    inputs: [
      { key: "met", unit: "MET" },
      { key: "weightKg", unit: "kg" },
      { key: "minutes", unit: "min" },
    ],
  },
  "age.metabolic": {
    id: "age.metabolic",
    name: "Âge métabolique (inversion de Mifflin)",
    version: "1",
    sources: [{ label: "Mifflin et al. 1990, Am J Clin Nutr 51:241", url: "https://pubmed.ncbi.nlm.nih.gov/2305711/" }],
    domain: "Comparaison facultative à la table : A = (10P + 6,25T + c − RMR) / 5. Circulaire par construction, pas une horloge.",
    inputs: [{ key: "rmr", unit: "kcal/j" }],
  },

  // ── Blood age and clinical calculators ────────────────────────────────────
  "bioage.phenoage2018": {
    id: "bioage.phenoage2018",
    name: "PhenoAge clinique (Levine 2018)",
    version: "1",
    sources: [
      { label: "Levine et al. 2018, Aging 10:573", url: "https://doi.org/10.18632/aging.101414" },
      { label: "Liu et al. 2019, erratum PLoS Med e1002760 (imprime 0,09165)", url: "https://doi.org/10.1371/journal.pmed.1002760" },
      { label: "BioAge, phenoage_calc.R, branche originale (0,090165)", url: "https://github.com/dayoonkwon/BioAge/blob/master/R/phenoage_calc.R" },
    ],
    domain: "NHANES III (20-84 ans), validé sur NHANES IV ; neuf analyses + âge, modèle de Gompertz. Deux dénominateurs publiés : 0,090165 (original, défaut) et 0,09165 (erratum 2019).",
    inputs: [
      { key: "albumin", unit: "g/L" },
      { key: "creatinine", unit: "µmol/L" },
      { key: "glucose", unit: "mmol/L" },
      { key: "crp", unit: "mg/dL" },
      { key: "lymphocytes", unit: "%" },
      { key: "mcv", unit: "fL" },
      { key: "rdw", unit: "%" },
      { key: "alp", unit: "U/L" },
      { key: "wbc", unit: "10⁹/L" },
      { key: "age", unit: "ans" },
    ],
    notes: ["Estimation pronostique de groupe ; un écart avec l’âge réel n’est pas un diagnostic."],
  },
  "clinical.egfrCkdEpi2021": {
    id: "clinical.egfrCkdEpi2021",
    name: "DFG estimé, CKD-EPI 2021 (créatinine)",
    version: "1",
    sources: [{ label: "Inker et al. 2021, N Engl J Med 385:1737", url: "https://doi.org/10.1056/NEJMoa2102953" }],
    domain: "Adultes, créatinine seule, sans terme d’origine ; le laboratoire peut utiliser une autre version.",
    inputs: [
      { key: "creatinine", unit: "mg/dL" },
      { key: "age", unit: "ans" },
    ],
  },
  "clinical.nonHdl": {
    id: "clinical.nonHdl",
    name: "Cholestérol non-HDL",
    version: "1",
    sources: [{ label: "Cholestérol total − HDL" }],
    domain: "Même prélèvement, mêmes unités.",
    inputs: [
      { key: "totalCholesterol", unit: "" },
      { key: "hdl", unit: "" },
    ],
  },
  "clinical.tyg": {
    id: "clinical.tyg",
    name: "Index TyG",
    version: "1",
    sources: [{ label: "Guerrero-Romero et al. 2010, J Clin Endocrinol Metab 95:3347", url: "https://doi.org/10.1210/jc.2010-0288" }],
    domain: "Convention ln(TG × glucose / 2), en mg/dL ; les seuils d’une autre convention ne s’appliquent pas.",
    inputs: [
      { key: "triglycerides", unit: "mg/dL" },
      { key: "glucose", unit: "mg/dL" },
    ],
  },
  "clinical.homaIr": {
    id: "clinical.homaIr",
    name: "HOMA1-IR",
    version: "1",
    sources: [{ label: "Matthews et al. 1985, Diabetologia 28:412", url: "https://doi.org/10.1007/BF00280883" }],
    domain: "Glucose (mmol/L) × insuline à jeun (µU/mL) / 22,5 ; HOMA2 est un autre modèle.",
    inputs: [
      { key: "glucose", unit: "mmol/L" },
      { key: "insulin", unit: "µU/mL" },
    ],
  },

  // ── Load ────────────────────────────────────────────────────────────────────
  "load.sessionRpe": {
    id: "load.sessionRpe",
    name: "Charge ressentie (session-RPE)",
    version: "1",
    sources: [{ label: "Foster et al. 2001, J Strength Cond Res 15:109", url: "https://pubmed.ncbi.nlm.nih.gov/11708692/" }],
    domain: "Durée de la séance (min) × effort perçu sur l’échelle CR-10 ; unité arbitraire, à ne pas additionner au TRIMP.",
    inputs: [
      { key: "minutes", unit: "min" },
      { key: "rpe", unit: "CR-10" },
    ],
  },
  "load.monotonyFoster1998": {
    id: "load.monotonyFoster1998",
    name: "Monotonie et strain de Foster (1998)",
    version: "1",
    sources: [{ label: "Foster 1998, Med Sci Sports Exerc 30:1164", url: "https://doi.org/10.1097/00005768-199807000-00023" }],
    domain: "Sur 7 jours, repos compris : monotonie = moyenne / écart-type (échantillon) ; strain = charge hebdomadaire × monotonie. Homonyme du Strain de Pulse, sans équivalence.",
    inputs: [{ key: "dailyLoad", unit: "session-RPE" }],
  },
  "hrv.reference": {
    id: "hrv.reference",
    name: "Référence HRV (lnRMSSD)",
    version: "1",
    sources: [
      { label: "Plews, Laursen & Buchheit 2016, Int J Sports Physiol Perform (rameurs, seuil 0,5 CV)", url: "https://martin-buchheit.net/wp-content/uploads/2016/09/plews-ijspp-2016.pdf" },
      TASK_FORCE,
    ],
    domain: "Tendance sur 7 nuits contre une référence de 28 à 60 nuits antérieures, bande ±0,5 écart-type : des paramètres de conception, pas une loi physiologique.",
    inputs: [{ key: "hrvMs", unit: "ms" }],
  },

  // ── Strain methods (stage 1) ───────────────────────────────────────────────
  "strain.edwards1993": {
    id: "strain.edwards1993",
    name: "TRIMP d’Edwards (1993), zones de réserve cardiaque",
    version: "1",
    sources: [{ label: "Edwards 1993, The Heart Rate Monitor Book" }, NOOP],
    domain: "Minutes pondérées 1 à 5 dans les zones 50-60 … 90-100 % de réserve cardiaque, puis 100 × ln(TRIMP + 1) / ln(7201) ; la méthode de Pulse par défaut.",
    inputs: [{ key: "heartRate", unit: "bpm" }],
  },
  "strain.banister1991": {
    id: "strain.banister1991",
    name: "TRIMP de Banister, 0,64 · x · e^(k·x)",
    version: "1",
    sources: [BANISTER, MORTON, NOOP],
    domain: "x = fraction de réserve cardiaque ; k = 1,92 (homme) ou 1,67 (femme) ; 0,64 pour les deux, sous le plancher de 10 % de réserve. La variante féminine usuelle à 0,86 n’est pas celle-ci.",
    inputs: [{ key: "heartRate", unit: "bpm" }],
  },
  "strain.cardioLoadCore": {
    id: "strain.cardioLoadCore",
    name: "Noyau Cardio Load (variante Pulse)",
    version: "1",
    sources: [GOOGLE_CL, BANISTER],
    domain: "Même noyau 0,64 · x · e^(k·x) ; 0 sous 30 % de réserve, poids 0,5 (paramètre de Pulse) entre 30 et 40 %, une minute compte seulement si elle bouge. Les filtres complets de Google ne sont pas publiés : ce n’est pas Cardio Load.",
    inputs: [{ key: "heartRate", unit: "bpm" }],
  },

  // ── Pulse's own scorers, for the registry page ─────────────────────────────
  "baseline.ewmaWinsor": {
    id: "baseline.ewmaWinsor",
    name: "Baseline personnelle (EWMA winsorisée)",
    version: "noop",
    sources: [NOOP],
    domain: "Centre : EWMA demi-vie 14 nuits, valeurs écrêtées à ±3 écarts ; dispersion : EWMA demi-vie 21 nuits de l’écart absolu ; σ = 1,253 × dispersion ; utilisable dès 4 nuits, fiable à 14.",
    inputs: [{ key: "nightly", unit: "" }],
  },
  "recovery.pulse": {
    id: "recovery.pulse",
    name: "Recovery (Pulse, porté de noop)",
    version: "noop",
    sources: [NOOP],
    domain: "Écarts standardisés à la baseline : HRV 55 %, FC de repos 20 %, sommeil 15 %, respiration 5 %, température 5 % ; logistique de pente 1,6 centrée à −0,2 ; 7 nuits de HRV avant le premier score. Des choix de conception, documentés.",
    inputs: [{ key: "hrvMs", unit: "ms" }],
  },
  "trainingLoad.ctlAtl": {
    id: "trainingLoad.ctlAtl",
    name: "Charge chronique et aiguë (CTL / ATL)",
    version: "noop",
    sources: [{ label: "TrainingPeaks / Coggan, The Science of the Performance Manager", url: "https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/" }, NOOP],
    domain: "EWMA de l’Effort quotidien à constante de temps 42 et 7 jours : α = 1 − e^(−1/τ) = 0,023528 et 0,133122 (pas la convention span 2/(N+1)).",
    inputs: [{ key: "effort", unit: "0–100" }],
  },
  "acwr.rolling7_28": {
    id: "acwr.rolling7_28",
    name: "Rapport charge aiguë / chronique (7 j / 28 j)",
    version: "noop",
    sources: [{ label: "Impellizzeri et al. 2020, Int J Sports Physiol Perform (limites)", url: "https://pubmed.ncbi.nlm.nih.gov/32502973/" }, NOOP],
    domain: "Moyenne 7 jours / moyenne 28 jours de l’Effort ; descriptif. Les bandes affichées ne sont pas une garantie contre les blessures.",
    inputs: [{ key: "effort", unit: "0–100" }],
  },
  "sri.phillips2017": {
    id: "sri.phillips2017",
    name: "Sleep Regularity Index (Phillips 2017)",
    version: "pulse",
    sources: [{ label: "Phillips et al. 2017, Sci Rep 7:3216", url: "https://doi.org/10.1038/s41598-017-03171-4" }],
    domain: "SRI = 200 × P(même état à 24 h) − 100, de −100 à 100, sur 7 jours ; l’affichage « consistance » recadre à max(0, SRI).",
    inputs: [{ key: "sleepWake", unit: "min" }],
  },
  "sleepNeed.p75": {
    id: "sleepNeed.p75",
    name: "Besoin de sommeil (quartile supérieur)",
    version: "noop",
    sources: [NOOP],
    domain: "75ᵉ percentile des 28 dernières nuits, plancher 8 h (9 h avant 18 ans), plafond 9,5 h ; dette reportée à 55 % par nuit.",
    inputs: [{ key: "asleepHours", unit: "h" }],
  },
  "pulseAge.gompertz": {
    id: "pulseAge.gompertz",
    name: "Pulse Age (rapports de risque, loi de Gompertz)",
    version: "pulse",
    sources: [{ label: "docs/algorithms/healthspan.md (neuf entrées, courbes citées)" }, { label: "Finch 1990, Science 249:902 : doublement du risque en ~8 ans" }],
    domain: "Σ ln HR × 0,75 × 9/n ÷ (ln 2 / 8), moyenne 6 mois, borné à ±15 ans ; un indice de comportements, pas un âge sanguin ni ADN.",
    inputs: [{ key: "dailyRows", unit: "" }],
  },
};

export const FORMULA_IDS = Object.keys(FORMULAS) as FormulaId[];
