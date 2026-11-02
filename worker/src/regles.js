const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Parcourt tous les résultats d'outils et rassemble les montants autorisés.
export function collecterMontants(resultats) {
  const fcfa = new Set();
  const devises = [];
  const parcourir = (x, cle = "") => {
    if (Array.isArray(x)) return x.forEach((v) => parcourir(v, cle));
    if (x && typeof x === "object") return Object.entries(x).forEach(([k, v]) => parcourir(v, k));
    if (typeof x === "number") {
      if (/fcfa$/.test(cle)) fcfa.add(Math.round(x));
      if (cle === "montant_converti") devises.push(x);
    }
  };
  resultats.forEach((r) => parcourir(r));
  return { fcfa, devises };
}

const RE_FCFA = /(\d{1,3}(?:[\s\u00a0\u202f.]\d{3})+|\d+)\s*(?:FCFA|F\s?CFA|francs?\s+CFA|CFA)/gi;
const RE_DEV = /(\d+(?:[\s\u00a0\u202f]\d{3})*(?:[.,]\d+)?)\s*(?:€|EUR\b|euros?\b|USD\b|\$|dollars?\b|NGN\b|₦|nairas?\b|GBP\b|£|livres?\b|CAD\b|GHS\b|cedis?\b)/gi;
const INTERDITS = new Set(["ravi", "ravie", "desole", "desolee", "enchante", "enchantee", "heureux", "heureuse"]);

export function verifierRegles(texte, { montants, totalAttendu, premierMessage }) {
  const erreurs = [];

  // 1. Aucun montant en FCFA qui ne vienne pas d'un outil.
  const montantsTexte = [...texte.matchAll(RE_FCFA)].map((m) => parseInt(m[1].replace(/\D/g, ""), 10));
  for (const m of montantsTexte) {
    if (!montants.fcfa.has(m)) erreurs.push(`le montant ${m} FCFA ne vient d'aucun outil`);
  }

  // 2. Montants en devise étrangère : ils doivent venir de convertir_devise (tolérance 1 %).
  for (const m of texte.matchAll(RE_DEV)) {
    const v = parseFloat(m[1].replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
    const ok = montants.devises.some((d) => Math.abs(d - v) <= Math.max(1, d * 0.01));
    if (!ok) erreurs.push(`le montant ${v} en devise ne vient pas de convertir_devise`);
  }

  // 3. Si un total a été calculé, la réponse doit l'annoncer.
  if (totalAttendu != null && !montantsTexte.includes(totalAttendu)) {
    erreurs.push(`la réponse doit annoncer le total exact de ${totalAttendu} FCFA`);
  }

  // 4. Longueur : mots comptés par le code.
  const nb = texte.trim().split(/\s+/).filter(Boolean).length;
  if (nb > 80) erreurs.push(`réponse trop longue (${nb} mots, maximum 80)`);

  // 5. Pas de markdown, pas de taux de change cité.
  if (/\*\*|__|^#{1,6}\s|```/m.test(texte)) erreurs.push("pas de markdown : un seul astérisque pour le gras");
  if (/\btaux\b/.test(norm(texte))) erreurs.push("ne pas citer le taux de change");

  // 6. « Bonjour » seulement au premier message ; formulations neutres.
  if (!premierMessage && norm(texte).trim().startsWith("bonjour")) erreurs.push("« Bonjour » uniquement au premier message");
  const mots = norm(texte).split(/[^a-z]+/);
  const trouves = mots.filter((m) => INTERDITS.has(m));
  if (trouves.length) erreurs.push(`mots à éviter : ${[...new Set(trouves)].join(", ")}`);

  return erreurs;
}