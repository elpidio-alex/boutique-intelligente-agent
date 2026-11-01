import json
import unicodedata
from pathlib import Path

import requests

from agent_core import tool

DATA_PATH = Path(__file__).parent / "data.json"

ARTICLES_SCHEMA = {
    "type": "object",
    "properties": {
        "ref": {"type": "string", "description": "référence produit, ex : P05"},
        "quantite": {"type": "integer", "description": "quantité, au moins 1"},
    },
    "required": ["ref", "quantite"],
}


# ---------- utilitaires (le stock et les commandes vivent dans data.json) ----------

def charger():
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)


def sauvegarder(data):
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def norm(texte):
    """minuscules + sans accents, pour comparer 'Fidjrossè' et 'fidjrosse'"""
    texte = unicodedata.normalize("NFD", str(texte).lower())
    return "".join(c for c in texte if unicodedata.category(c) != "Mn").strip()


def racine(mot):
    """'pagnes' -> 'pagne' (pluriel simple)"""
    return mot[:-1] if len(mot) > 3 and mot[-1] in "sx" else mot


def trouver_zone(data, zone):
    for nom, frais in data["zones"].items():
        if norm(nom) == norm(zone):
            return nom, frais
    return None, None


def valider_panier(data, zone, articles):
    """Valide zone, références, quantités et stock (quantités cumulées par référence).
    Retourne (panier, None) si tout est bon, sinon (None, erreur)."""
    nom_zone, frais = trouver_zone(data, zone)
    if nom_zone is None:
        return None, {"erreur": "zone non desservie",
                      "zones_desservies": list(data["zones"].keys())}
    if not articles:
        return None, {"erreur": "aucun article dans la commande"}

    lignes = []
    cumul = {}
    for art in articles:
        ref = str(art.get("ref", "")).strip().upper()
        qte = art.get("quantite")
        produit = next((p for p in data["produits"] if p["ref"] == ref), None)
        if produit is None:
            return None, {"erreur": "référence inconnue", "ref": ref}
        if not isinstance(qte, int) or qte < 1:
            return None, {"erreur": f"quantité invalide pour {produit['nom']}"}
        cumul[ref] = cumul.get(ref, 0) + qte
        if produit["stock"] < cumul[ref]:
            return None, {"erreur": f"stock insuffisant pour {produit['nom']}"}
        lignes.append((produit, qte))
    return {"zone": nom_zone, "frais": frais, "lignes": lignes}, None


def detailler(lignes):
    detail = []
    total_articles = 0
    for produit, qte in lignes:
        sous_total = produit["prix"] * qte
        total_articles += sous_total
        detail.append({
            "ref": produit["ref"],
            "nom": produit["nom"],
            "quantite": qte,
            "prix_unitaire_fcfa": produit["prix"],
            "sous_total_fcfa": sous_total,
        })
    return detail, total_articles


# ---------- outils ----------

@tool(
    "Cherche des produits du catalogue par mot-clé (ex : 'pagne', 'sac', 'sandales') ou par "
    "catégorie (ex : 'accessoires'). À utiliser dès que le client parle d'un produit ou demande "
    "un prix, et aussi pour trouver une alternative de la même catégorie quand un produit est en "
    "rupture. Passer 'tout' pour lister le catalogue complet. Chaque produit renvoyé a une "
    "catégorie. Ne renvoie PAS le stock : utiliser verifier_stock pour ça.",
    mot_cle=("string", "mot-clé ou catégorie recherchée, ou 'tout' pour tout lister"),
)
def chercher_produits(mot_cle):
    data = charger()
    if norm(mot_cle) in ("tout", "catalogue"):
        trouves = data["produits"]
    else:
        mots = [racine(m) for m in norm(mot_cle).split() if len(m) >= 3]
        trouves = [
            p for p in data["produits"]
            if any(m in norm(p["nom"]) or m in norm(p.get("categorie", "")) for m in mots)
        ]
    if not trouves:
        return {"erreur": f"aucun produit pour {mot_cle}"}
    return {
        "produits": [
            {"ref": p["ref"], "nom": p["nom"], "categorie": p.get("categorie", ""),
             "prix_fcfa": p["prix"]}
            for p in trouves
        ]
    }


@tool(
    "Donne le stock disponible d'une référence produit (ex : 'P03'). À utiliser AVANT de "
    "promettre un produit au client et avant de proposer une commande. Si le stock est à 0, "
    "le produit est en rupture : il faut le dire et proposer une alternative.",
    ref=("string", "référence du produit, par exemple P01"),
)
def verifier_stock(ref):
    data = charger()
    for p in data["produits"]:
        if p["ref"] == ref.strip().upper():
            return {
                "ref": p["ref"],
                "nom": p["nom"],
                "stock": p["stock"],
                "disponible": p["stock"] > 0,
            }
    return {"erreur": "référence inconnue"}


@tool(
    "Donne les frais de livraison (en FCFA) et le délai pour une zone. À utiliser dès que le "
    "client donne une ville ou un quartier de livraison, avant d'annoncer un total. Si la zone "
    "n'est pas desservie, l'outil renvoie la liste des zones possibles.",
    zone=("string", "ville ou quartier de livraison, par exemple Calavi"),
)
def frais_livraison(zone):
    data = charger()
    nom, frais = trouver_zone(data, zone)
    if nom is None:
        return {
            "erreur": "zone non desservie",
            "zones_desservies": list(data["zones"].keys()),
        }
    return {"zone": nom, "frais_fcfa": frais, "delai": data["delai_livraison"]}


@tool(
    "Convertit un montant en FCFA vers une autre devise (EUR, USD, NGN, GBP...) avec le taux "
    "réel du jour. À utiliser dès que le client veut un prix dans une autre devise. Ne jamais "
    "calculer une conversion toi-même.",
    montant_fcfa=("number", "montant en FCFA à convertir"),
    devise=("string", "code ISO de la devise cible, par exemple EUR, USD ou NGN"),
)
def convertir_devise(montant_fcfa, devise):
    code = devise.strip().upper()
    try:
        r = requests.get("https://open.er-api.com/v6/latest/XOF", timeout=10)
        r.raise_for_status()
        taux = r.json()["rates"]
    except Exception:
        return {"erreur": "service de taux de change indisponible, réessayer plus tard"}
    if code not in taux:
        return {"erreur": "devise non prise en charge"}
    return {
        "montant_fcfa": montant_fcfa,
        "devise": code,
        "taux": taux[code],
        "montant_converti": round(montant_fcfa * taux[code], 2),
    }


@tool(
    "Calcule le total officiel d'une commande : somme des articles + frais de livraison. "
    "À utiliser dès que vous annoncez un total au client, une fois la zone connue et le stock "
    "vérifié. Ne faites JAMAIS l'addition vous-même : recopiez le total_fcfa renvoyé. "
    "N'enregistre rien (ce n'est pas une commande).",
    zone=("string", "zone de livraison, par exemple Calavi"),
    articles=("array", "articles à totaliser (uniquement ceux disponibles)", ARTICLES_SCHEMA),
)
def calculer_total(zone, articles):
    data = charger()
    panier, erreur = valider_panier(data, zone, articles)
    if erreur:
        return erreur
    detail, total_articles = detailler(panier["lignes"])
    return {
        "zone": panier["zone"],
        "articles": detail,
        "total_articles_fcfa": total_articles,
        "frais_livraison_fcfa": panier["frais"],
        "total_fcfa": total_articles + panier["frais"],
        "delai": data["delai_livraison"],
    }


@tool(
    "Enregistre une commande. Action IRRÉVERSIBLE : n'appeler qu'après avoir vérifié le stock, "
    "annoncé le total (articles + livraison) et obtenu l'accord explicite du client. Ne jamais "
    "l'appeler pour un simple renseignement.",
    client=("string", "nom du client"),
    zone=("string", "zone de livraison"),
    articles=("array", "liste des articles commandés", ARTICLES_SCHEMA),
)
def creer_commande(client, zone, articles):
    data = charger()
    panier, erreur = valider_panier(data, zone, articles)   # 1) tout valider d'abord
    if erreur:
        return erreur

    for produit, qte in panier["lignes"]:                    # 2) puis décrémenter le stock
        produit["stock"] -= qte
    detail, total_articles = detailler(panier["lignes"])

    commande = {
        "id": len(data["commandes"]) + 1,
        "client": client,
        "zone": panier["zone"],
        "articles": detail,
        "total_articles_fcfa": total_articles,
        "frais_livraison_fcfa": panier["frais"],
        "total_fcfa": total_articles + panier["frais"],
    }
    data["commandes"].append(commande)
    sauvegarder(data)
    return {"statut": "enregistrée", **commande}