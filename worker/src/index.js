import { lancerAgent, MESSAGE_REPLI } from "./agent.js";
import { envoyer } from "./greenapi.js";
import { fcfa } from "./outils.js";

const MAX_HISTORIQUE = 10;
const MAX_PAR_HEURE = 20;
const RE_VALIDATION = /^\s*(OUI|NON)\s*#?\s*(\d+)\s*$/i;

const log = (o) => console.log(JSON.stringify(o));

// Comparaison à temps constant, pour ne pas révéler le jeton par le temps de réponse.
function egal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function noter(env, client, role, contenu) {
  await env.DB
    .prepare("INSERT INTO messages (client, role, contenu, cree_le) VALUES (?, ?, ?, ?)")
    .bind(client, role, contenu, Date.now())
    .run();
}

async function prevenir(env, client, message) {
  await envoyer(env, client, message);
  await noter(env, client, "assistant", message);
}

// Validation d'une commande par Afi (OUI n / NON n).
async function validerCommande(env, id, accepte) {
  const afi = env.AFI_CHAT_ID;
  const cmd = await env.DB.prepare("SELECT * FROM commandes WHERE id = ?").bind(id).first();
  if (!cmd) {
    await envoyer(env, afi, `La commande #${id} n'existe pas.`);
    return;
  }

  // On « prend » la commande d'un coup : un second OUI ou NON ne fait rien.
  const prise = await env.DB
    .prepare("UPDATE commandes SET statut = ? WHERE id = ? AND statut = 'en_attente'")
    .bind(accepte ? "validee" : "refusee", id)
    .run();
  if (prise.meta.changes === 0) {
    await envoyer(env, afi, `La commande #${id} a déjà été traitée (${cmd.statut}).`);
    return;
  }

  if (!accepte) {
    await prevenir(env, cmd.client, `Votre commande #${id} n'a pas pu être validée par la boutique. Rien n'a été enregistré. Écrivez-nous si vous souhaitez une alternative.`);
    await envoyer(env, afi, `Commande #${id} refusée. Le client est prévenu.`);
    return;
  }

  // OUI : le stock est décrémenté seulement s'il en reste assez.
  const lignes = JSON.parse(cmd.lignes);
  const res = await env.DB.batch(
    lignes.map((l) =>
      env.DB.prepare("UPDATE produits SET stock = stock - ? WHERE ref = ? AND stock >= ?").bind(l.quantite, l.ref, l.quantite)
    )
  );
  if (res.some((r) => r.meta.changes === 0)) {
    const annuler = lignes
      .filter((l, i) => res[i].meta.changes === 1)
      .map((l) => env.DB.prepare("UPDATE produits SET stock = stock + ? WHERE ref = ?").bind(l.quantite, l.ref));
    if (annuler.length) await env.DB.batch(annuler);
    await env.DB.prepare("UPDATE commandes SET statut = 'refusee' WHERE id = ?").bind(id).run();
    await prevenir(env, cmd.client, `Votre commande #${id} n'a pas pu être enregistrée : le stock a changé entre-temps. Écrivez-nous pour trouver une alternative.`);
    await envoyer(env, afi, `Commande #${id} : stock insuffisant à la validation, commande annulée. Le client est prévenu.`);
    return;
  }

  await prevenir(env, cmd.client, `Bonne nouvelle : votre commande #${id} est validée. Total ${fcfa(cmd.total)}, livraison à ${cmd.zone} sous 24 à 48 h. Merci de votre confiance !`);
  await envoyer(env, afi, `Commande #${id} validée. Stock mis à jour, le client est prévenu.`);
}

async function traiter(env, chatId, texte) {
  const court = chatId.slice(0, 5) + "…";
  try {
    // Messages de la forme OUI n / NON n : seule Afi peut valider.
    const v = texte.match(RE_VALIDATION);
    if (v) {
      if (chatId === env.AFI_CHAT_ID) {
        const accepte = v[1].toUpperCase() === "OUI";
        log({ evt: "validation", commande: Number(v[2]), decision: accepte ? "OUI" : "NON" });
        await validerCommande(env, Number(v[2]), accepte);
      } else {
        log({ evt: "validation_refusee", client: court });
        await envoyer(env, chatId, "Seule la responsable de la boutique peut valider une commande. Votre demande reste en cours de traitement.");
      }
      return;
    }

    // Budget : au plus MAX_PAR_HEURE messages par client et par heure.
    await noter(env, chatId, "user", texte);
    const { n } = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE client = ? AND role = 'user' AND cree_le > ?")
      .bind(chatId, Date.now() - 3600000)
      .first();
    if (n > MAX_PAR_HEURE) {
      log({ evt: "limite_atteinte", client: court });
      await envoyer(env, chatId, "Vous avez envoyé beaucoup de messages en peu de temps. Merci de réessayer dans une heure ou de contacter Afi directement.");
      return;
    }

    // Historique borné : les derniers messages, sans le message courant.
    const { results } = await env.DB
      .prepare("SELECT role, contenu FROM messages WHERE client = ? ORDER BY id DESC LIMIT ?")
      .bind(chatId, MAX_HISTORIQUE + 1)
      .all();
    const historique = results.reverse().slice(0, -1).map((r) => ({ role: r.role, content: r.contenu }));
    while (historique.length && historique[0].role === "assistant") historique.shift();

    const { results: commandes } = await env.DB
      .prepare("SELECT id, statut, total, zone FROM commandes WHERE client = ? ORDER BY id DESC LIMIT 3")
      .bind(chatId)
      .all();

    const { reponse, repli } = await lancerAgent(env, {
      chatId,
      historique,
      texte,
      premierMessage: historique.length === 0,
      commandes,
    });
    
    
    await envoyer(env, chatId, reponse);
    if (!repli) await noter(env, chatId, "assistant", reponse);
  } catch (e) {
    log({ evt: "erreur", client: court, message: e.message });
    try { await envoyer(env, chatId, MESSAGE_REPLI); } catch {}
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("OK");

    // 1. Authentification : seul Green API connaît le jeton.
    const secret = (env.WEBHOOK_TOKEN || "").trim();
    if (!secret) return new Response("Configuration manquante", { status: 500 });
    const auth = (request.headers.get("Authorization") || "").trim();
    if (!egal(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });

    let evt;
    try {
      evt = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // 2. Filtres : messages texte entrants de contacts (pas de groupes, pas de médias).
    if (evt.typeWebhook !== "incomingMessageReceived") return new Response("ignoré");
    const chatId = evt.senderData?.chatId;
    if (!chatId || !chatId.endsWith("@c.us")) return new Response("ignoré");
    const md = evt.messageData || {};
    const texte = md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text;
    if (!texte) return new Response("ignoré");
    if (!evt.idMessage) return new Response("ignoré");

    // 3. Dédoublonnage : un idMessage déjà vu ne déclenche jamais deux réponses.
    const r = await env.DB
      .prepare("INSERT OR IGNORE INTO traites (id_message, cree_le) VALUES (?, ?)")
      .bind(evt.idMessage, Date.now())
      .run();
    if (r.meta.changes === 0) {
      log({ evt: "doublon", idMessage: evt.idMessage });
      return new Response("doublon");
    }

    // 4. 200 tout de suite, agent en arrière-plan.
    log({ evt: "message_recu", client: chatId.slice(0, 5) + "…", longueur: texte.length });
    ctx.waitUntil(traiter(env, chatId, texte));
    return new Response("OK");
  },
};