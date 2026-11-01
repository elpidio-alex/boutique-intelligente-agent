import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url="https://api.rodiumai.io/v1",
    api_key=os.environ["RODIUMAI_API_KEY"],
)
MODEL = os.environ.get("MODEL", "anthropic/claude-haiku-5-5")

TOOLS = {}     # nom -> fonction Python
SCHEMAS = []   # descriptions JSON envoyées au LLM

# Compteurs pour le tableau de comparaison (agent seul / multi-agents)
STATS = {"appels_llm": 0, "secondes_llm": 0.0, "tokens_entree": 0, "tokens_sortie": 0}


def reset_stats():
    for cle in STATS:
        STATS[cle] = 0.0 if cle == "secondes_llm" else 0


def afficher_stats():
    print(
        f"\n📊 Appels LLM : {STATS['appels_llm']} | "
        f"temps LLM : {STATS['secondes_llm']:.1f} s | "
        f"tokens entrée : {STATS['tokens_entree']} | sortie : {STATS['tokens_sortie']}"
    )


def tool(description, **params):
    """Déclare un outil. params : nom=(type, description[, schéma des items])"""
    def decorator(fn):
        props = {}
        for nom, spec in params.items():
            prop = {"type": spec[0], "description": spec[1]}
            if len(spec) > 2:
                prop["items"] = spec[2]
            props[nom] = prop
        SCHEMAS.append({
            "type": "function",
            "function": {
                "name": fn.__name__,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": props,
                    "required": list(params),
                },
            },
        })
        TOOLS[fn.__name__] = fn
        return fn
    return decorator


def appeler_llm(messages, outils=None):
    """Tout appel au LLM passe par ici, pour compter appels, temps et tokens."""
    kwargs = {"model": MODEL, "messages": messages}
    if outils:
        kwargs["tools"] = outils
    debut = time.time()
    reponse = client.chat.completions.create(**kwargs)
    STATS["appels_llm"] += 1
    STATS["secondes_llm"] += time.time() - debut
    if reponse.usage:
        STATS["tokens_entree"] += reponse.usage.prompt_tokens or 0
        STATS["tokens_sortie"] += reponse.usage.completion_tokens or 0
    return reponse.choices[0].message


def trace(step, nom, args, resultat, agent=""):
    etiquette = f"[{agent}] " if agent else ""
    print(f"\n{etiquette}[étape {step}] 🔧 {nom}")
    print(f"   args     : {json.dumps(args, ensure_ascii=False)}")
    print(f"   résultat : {json.dumps(resultat, ensure_ascii=False)}")


def trace_evaluation(ok, critique, agent=""):
    etiquette = f"[{agent}] " if agent else ""
    if ok:
        print(f"\n{etiquette}🔍 évaluation : ✅ OK")
    else:
        print(f"\n{etiquette}🔍 évaluation : ❌ pas encore -> {critique}")


def run(messages, max_steps=8, approuver=None, outils_sensibles=(), evaluer=None,
        max_corrections=2, schemas=None, fonctions=None, agent="", sur_outil=None):
    """Boucle agentique : penser -> agir -> observer -> évaluer.

    approuver(nom, args) -> bool   : validation humaine pour les outils de `outils_sensibles`
    evaluer(messages, reponse) -> (ok, critique) : contrôle avant de rendre la réponse finale
    """
    schemas = SCHEMAS if schemas is None else schemas
    fonctions = TOOLS if fonctions is None else fonctions
    corrections = 0

    for step in range(1, max_steps + 1):
        msg = appeler_llm(messages, schemas)               # 1. PENSER
        messages.append(msg)

        if not msg.tool_calls:                             # plus d'outil -> réponse finale
            reponse = msg.content or ""
            if evaluer is None:
                return reponse
            ok, critique = evaluer(messages, reponse)      # 4. ÉVALUER
            trace_evaluation(ok, critique, agent)
            if ok:
                return reponse
            if corrections >= max_corrections:
                print("   ⚠️ limite de corrections atteinte, réponse rendue telle quelle")
                return reponse
            corrections += 1
            messages.append({
                "role": "user",
                "content": f"[Contrôle qualité interne : pas encore] {critique}\n"
                           "Corrigez votre réponse au client en tenant compte de cette critique.",
            })
            continue

        for call in msg.tool_calls:                        # 2. AGIR : le modèle PROPOSE, le code EXÉCUTE
            nom = call.function.name
            try:
                args = json.loads(call.function.arguments)
                if nom not in fonctions:
                    resultat = {"erreur": f"outil inconnu : {nom}"}
                elif nom in outils_sensibles and approuver is not None and not approuver(nom, args):
                    resultat = {
                        "statut": "refusée",
                        "message": "La gérante a refusé cette action. Rien n'a été enregistré. "
                                   "Informez poliment le client.",
                    }
                else:
                    resultat = fonctions[nom](**args)
            except Exception as e:                         # l'erreur est renvoyée au modèle
                args, resultat = {}, {"erreur": str(e)}
            trace(step, nom, args, resultat, agent)        # 3. OBSERVER
            if sur_outil is not None:
                sur_outil(nom, args, resultat)
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": json.dumps(resultat, ensure_ascii=False),
            })

    return "Limite d'étapes atteinte, je n'ai pas pu terminer. Réessayez ou contactez Afi."