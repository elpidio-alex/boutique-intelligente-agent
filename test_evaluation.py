import json

from evaluation import verifier_total, evaluer
import agent_core

TOTAL = {"total_articles_fcfa": 44000, "frais_livraison_fcfa": 2000, "total_fcfa": 46000}
avec_total = [
    {"role": "user", "content": "2 robes en wax livrées à Calavi"},
    {"role": "tool", "tool_call_id": "t1", "content": json.dumps(TOTAL)},
]

print("--- règle en code (sans LLM) ---")
print("1.", verifier_total(avec_total, "Le total est de 46 000 FCFA, livraison incluse."))
print("2.", verifier_total(avec_total, "Total : 45 000 FCFA"))
print("3.", verifier_total(avec_total, "Le sac coûte 7 500 FCFA."))
print("4.", verifier_total([], "Total : 46\u202f000 FCFA"))

print("\n--- LLM juge (3 appels) ---")
produit = [
    {"role": "user", "content": "C'est combien la robe en wax ?"},
    {"role": "tool", "tool_call_id": "a", "content": json.dumps(
        {"produits": [{"ref": "P05", "nom": "Robe en wax", "prix_fcfa": 22000}]}, ensure_ascii=False)},
    {"role": "tool", "tool_call_id": "b", "content": json.dumps(
        {"ref": "P05", "nom": "Robe en wax", "stock": 5, "disponible": True}, ensure_ascii=False)},
]
print("5.", evaluer(produit, "La robe en wax coûte 20 000 FCFA, il en reste 5. Vous la voulez ?"))
print("6.", evaluer(produit, "La robe en wax coûte 22 000 FCFA et il en reste 5 en stock. Souhaitez-vous la commander ?"))

rupture = [
    {"role": "user", "content": "C'est combien le sac en raphia ?"},
    {"role": "tool", "tool_call_id": "c", "content": json.dumps(
        {"produits": [{"ref": "P03", "nom": "Sac en raphia", "prix_fcfa": 7500}]}, ensure_ascii=False)},
    {"role": "tool", "tool_call_id": "d", "content": json.dumps(
        {"ref": "P03", "nom": "Sac en raphia", "stock": 0, "disponible": False}, ensure_ascii=False)},
]
print("7.", evaluer(rupture, "Le sac en raphia coûte 7 500 FCFA. Souhaitez-vous le commander ?"))

agent_core.afficher_stats()