// Envoi d'un message WhatsApp via Green API.
// Les trois valeurs viennent des secrets Cloudflare, jamais du code.
export async function envoyer(env, chatId, message) {
  const url = `${env.GREEN_API_URL}/waInstance${env.GREEN_ID_INSTANCE}/sendMessage/${env.GREEN_API_TOKEN}`;
  const rep = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  if (!rep.ok) {
    // On ne journalise jamais l'URL : elle contient le jeton de l'instance.
    console.log("sendMessage échec", rep.status, await rep.text());
  }
  return rep.ok;
}