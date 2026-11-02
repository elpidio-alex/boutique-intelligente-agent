import { envoyer } from "./greenapi.js";

const DELAI = "24 à 48 h";
const MOTS_VIDES = new Set(["des", "les", "une", "pour", "vous", "avez", "dans", "avec", "que", "qui"]);

function norm(s) {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function singulier(m) {
  return m.length > 3 ? m.replace(/[sx]$/, "") : m;
}
export function fcfa(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " FCFA";
}

// ---------- Schémas (ce que le modèle voit) ----------
const fn = (name, description, properties, required) => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required } },
});
const LIGNES = {
  type: "array",
  description: "Articles du panier",
  items: {
    type: "object",
    properties: { ref: { type: "string" }, quantite: { type: "integer" } },
    required: ["ref", "quantite"],
  },
};

export const SCHEMAS = [
  fn(
    "chercher_produits",
    "Cherche des produits du catalogue par mot-clé ou catégorie (vêtements, accessoires, soins). À utiliser dès que le client parle d'un article ou demande ce qui existe. Renvoie référence, nom, prix en FCFA et stock.",
    {
      mot_cle: { type: "string", description: "Mot du produit, ex. 'pagne', 'robe'" },
      categorie: { type: "string", description: "vêtements, accessoires ou soins" },
    },
    []
  ),
  fn(
    "verifier_stock",
    "Vérifie le stock d'une référence avant de promettre un produit. À utiliser pour chaque produit demandé.",
    {
      ref: { type: "string", description: "Référence, ex. P01" },
      quantite: { type: "integer", description: "Quantité souhaitée" },
    },
    ["ref"]
  ),
  fn(
    "frais_livraison",
    "Donne les frais de livraison en FCFA et le délai pour une zone. Si la zone n'est pas desservie, renvoie les zones desservies. Ne jamais deviner la zone : la demander au client.",
    { zone: { type: "string", description: "Zone de livraison, ex. Calavi" } },
    ["zone"]
  ),
  fn(
    "convertir_devise",
    "Convertit un montant en FCFA vers une autre devise (EUR, USD, NGN...) au taux du jour. À utiliser dès que le client veut un prix dans une autre devise.",
    {
      montant_fcfa: { type: "number" },
      devise: { type: "string", description: "Code ISO, ex. EUR" },
    },
    ["montant_fcfa", "devise"]
  ),
  fn(
    "calculer_total",
    "Calcule le total exact d'un panier : articles + livraison. À utiliser pour tout total annoncé, ne jamais calculer à la main. Échoue si une quantité dépasse le stock.",
    { lignes: LIGNES, zone: { type: "string" } },
    ["lignes", "zone"]
  ),
  fn(
    "creer_commande",
    "Enregistre une commande en attente de validation d'Afi. À utiliser UNIQUEMENT après l'accord explicite du client sur le total annoncé. Action sensible : jamais sans cet accord.",
    {
      nom_client: { type: "string" },
      lignes: LIGNES,
      zone: { type: "string" },
      total_fcfa: { type: "integer", description: "Total renvoyé par calculer_total" },
    },
    ["nom_client", "lignes", "zone", "total_fcfa"]
  ),
];

// ---------- Aides ----------
async function tousProduits(env) {
  const { results } = await env.DB.prepare("SELECT ref, nom, prix, stock, categorie FROM produits ORDER BY ref").all();
  return results;
}
async function trouverZone(env, zone) {
  const { results } = await env.DB.prepare("SELECT nom, frais FROM zones").all();
  return { z: results.find((r) => norm(r.nom) === norm(zone)), liste: results.map((r) => r.nom) };
}
async function validerPanier(env, lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) return { erreur: "panier vide" };
  const cumul = new Map(); // quantités cumulées par référence
  for (const l of lignes) {
    const q = Number(l.quantite);
    if (!Number.isInteger(q) || q < 1) return { erreur: `quantité invalide pour ${l.ref}` };
    const ref = String(l.ref).toUpperCase();
    cumul.set(ref, (cumul.get(ref) || 0) + q);
  }
  const catalogue = new Map((await tousProduits(env)).map((p) => [p.ref, p]));
  const detail = [];
  for (const [ref, q] of cumul) {
    const p = catalogue.get(ref);
    if (!p) return { erreur: `référence inconnue : ${ref}` };
    if (p.stock < q) {
      return { erreur: `stock insuffisant pour ${p.nom} (${p.ref}) : ${p.stock} disponible(s), ${q} demandé(s)` };
    }
    detail.push({ ref: p.ref, nom: p.nom, quantite: q, prix_unitaire_fcfa: p.prix, total_ligne_fcfa: p.prix * q });
  }
  return { detail };
}

// ---------- Les 6 outils ----------
async function chercher_produits({ mot_cle, categorie }, { env }) {
  let sel = await tousProduits(env);
  if (categorie) {
    const c = singulier(norm(categorie));
    sel = sel.filter((p) => norm(p.categorie).includes(c));
  }
  if (mot_cle) {
    const mots = norm(mot_cle)
      .split(/[^a-z0-9]+/)
      .filter((m) => m.length >= 3 && !MOTS_VIDES.has(m))
      .map(singulier);
    if (mots.length) {
      sel = sel.filter((p) => {
        const txt = norm(`${p.nom} ${p.categorie}`);
        return mots.some((m) => txt.includes(m));
      });
    }
  }
  if (!sel.length) return { erreur: `aucun produit pour '${mot_cle || categorie || ""}'` };
  return {
    produits: sel.map((p) => ({ ref: p.ref, nom: p.nom, prix_fcfa: p.prix, stock: p.stock, categorie: p.categorie })),
  };
}

async function verifier_stock({ ref, quantite = 1 }, { env }) {
  const p = (await tousProduits(env)).find((x) => x.ref === String(ref).toUpperCase());
  if (!p) return { erreur: `référence inconnue : ${ref}` };
  return { ref: p.ref, nom: p.nom, stock: p.stock, quantite_demandee: quantite, suffisant: p.stock >= quantite };
}

async function frais_livraison({ zone }, { env }) {
  const { z, liste } = await trouverZone(env, zone);
  if (!z) return { erreur: `zone non desservie : ${zone}`, zones_desservies: liste };
  return { zone: z.nom, frais_fcfa: z.frais, delai: DELAI };
}

async function convertir_devise({ montant_fcfa, devise }) {
  const montant = Number(montant_fcfa);
  if (!Number.isFinite(montant) || montant <= 0) return { erreur: "montant invalide : un nombre positif est attendu" };
  const code = String(devise || "").toUpperCase().trim();
  let data;
  try {
    data = await (await fetch("https://open.er-api.com/v6/latest/XOF")).json();
  } catch {
    return { erreur: "service de taux indisponible, réessayer plus tard" };
  }
  const taux = data?.result === "success" ? data.rates?.[code] : undefined;
  if (!taux) return { erreur: `devise non prise en charge : ${devise}` };
  return {
    montant_fcfa,
    devise: code,
    taux,
    montant_converti: Math.round(Number(montant_fcfa) * taux * 100) / 100,
  };
}

async function calculer_total({ lignes, zone }, { env }) {
  const v = await validerPanier(env, lignes);
  if (v.erreur) return v;
  const { z, liste } = await trouverZone(env, zone);
  if (!z) return { erreur: `zone non desservie : ${zone}`, zones_desservies: liste };
  const sous_total = v.detail.reduce((s, l) => s + l.total_ligne_fcfa, 0);
  return {
    lignes: v.detail,
    sous_total_fcfa: sous_total,
    frais_livraison_fcfa: z.frais,
    total_fcfa: sous_total + z.frais,
    zone: z.nom,
  };
}

async function creer_commande({ nom_client, lignes, zone, total_fcfa }, { env, chatId, annonces }) {
  const attente = await env.DB
    .prepare("SELECT id FROM commandes WHERE client = ? AND statut = 'en_attente'")
    .bind(chatId)
    .first();
  if (attente) return { erreur: `la commande #${attente.id} de ce client attend déjà la validation d'Afi` };

  const calc = await calculer_total({ lignes, zone }, { env });
  if (calc.erreur) return calc;
  if (calc.total_fcfa !== Number(total_fcfa)) {
    return { erreur: `total incorrect : le total exact est ${calc.total_fcfa} FCFA` };
  }

    // Garde-fou : le client doit avoir vu ce total dans un message précédent.
  if (!annonces || !annonces.has(calc.total_fcfa)) {
    return {
      erreur: `le total de ${calc.total_fcfa} FCFA n'a pas encore été annoncé au client : annonce-le, demande confirmation et attends son accord avant de créer la commande`,
    };
  }

  const nom = nom_client || "client";
  let id;
  try {
    const r = await env.DB
      .prepare("INSERT INTO commandes (client, nom_client, lignes, zone, total, statut, cree_le) VALUES (?, ?, ?, ?, ?, 'en_attente', ?)")
      .bind(chatId, nom, JSON.stringify(calc.lignes), calc.zone, calc.total_fcfa, Date.now())
      .run();
    id = r.meta.last_row_id;
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return { erreur: "une commande de ce client attend déjà la validation de la responsable de la boutique" };
    }
    console.log("erreur insertion commande", e.message);
    return { erreur: "erreur interne, réessayer dans quelques instants" };
  }
  const resume = calc.lignes.map((l) => `${l.quantite} × ${l.nom}`).join(", ");
  let envoye = false;
  try {
    envoye = await envoyer(env, env.AFI_CHAT_ID, `Commande #${id} (${nom}) : ${resume}, livraison ${calc.zone}, ${fcfa(calc.total_fcfa)}. Répondez OUI ${id} ou NON ${id}.`);
  } catch {}
  if (!envoye) {
    await env.DB.prepare("DELETE FROM commandes WHERE id = ?").bind(id).run();
    return { erreur: "la demande de validation n'a pas pu être transmise ; demander au client de réessayer dans quelques minutes" };
  }

  return {
    commande_id: id,
    statut: "en_attente_de_validation",
    total_fcfa: calc.total_fcfa,
    message: "Demande transmise à la responsable de la boutique. Annonce au client, en le vouvoyant, que sa commande est transmise pour validation et qu'il sera prévenu du résultat.",
  };
}

const TABLE = { chercher_produits, verifier_stock, frais_livraison, convertir_devise, calculer_total, creer_commande };
export const OUTILS_SENSIBLES = new Set(["creer_commande"]);

// Exécute un outil ; une erreur est renvoyée au modèle comme observation.
export async function executer(nom, args, ctx) {
  const f = TABLE[nom];
  if (!f) return { erreur: `outil inconnu : ${nom}` };
  try {
    return await f(args || {}, ctx);
  } catch (e) {
    console.log("erreur outil", nom, e.message);
    return { erreur: "erreur interne de l'outil, réessayer" };
  }
}