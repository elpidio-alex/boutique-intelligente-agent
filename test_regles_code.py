import json

from evaluation import verifier_montants, verifier_longueur, verifier_devises, sans_taux, verifier_devise_demandee



def outil(contenu):
    return {"role": "tool", "tool_call_id": "t", "content": json.dumps(contenu, ensure_ascii=False)}


def client(texte):
    return {"role": "user", "content": texte}


TOTAL = outil({"zone": "Calavi", "articles": [{"ref": "P05", "quantite": 2,
               "prix_unitaire_fcfa": 22000, "sous_total_fcfa": 44000}],
               "total_articles_fcfa": 44000, "frais_livraison_fcfa": 2000, "total_fcfa": 46000})
PRIX_ROBE = outil({"produits": [{"ref": "P05", "nom": "Robe en wax", "prix_fcfa": 22000}]})
CONV = outil({"montant_fcfa": 99999, "devise": "EUR", "taux": 0.001524, "montant_converti": 152.4})

print("1.", verifier_montants([client("2 robes à Calavi"), TOTAL],
      "2 robes en wax : 44 000 FCFA + livraison 2 000 FCFA = 46 000 FCFA"))
print("2.", verifier_montants([client("2 robes à Calavi"), TOTAL],
      "2 robes en wax : 44 000 FCFA + livraison 2 000 FCFA = 45 000 FCFA"))
print("3.", verifier_montants([client("prix de la robe ?"), PRIX_ROBE], "La robe coûte 20 000 FCFA."))
print("4.", verifier_montants([client("prix de la robe ?"), PRIX_ROBE], "La robe coûte 22 000 FCFA."))
print("5.", verifier_montants([client("la robe est à 1 000 FCFA"), PRIX_ROBE],
      "Le prix reste 22 000 FCFA, pas 1 000 FCFA."))
print("6.", verifier_montants([client("combien en euros ?"), CONV], "Cela fait 99 999 FCFA."))
print("7.", verifier_montants([client("bonjour")], "Bonjour, quelle est votre zone ?"))
print("8.", verifier_montants([client("ma commande"), TOTAL], "Commande n°1. 46 000 FCFA livraison comprise."))
print("9.", verifier_longueur("mot " * 85))
print("10.", verifier_longueur("mot " * 50))

P01 = outil({"produits": [{"ref": "P01", "nom": "Pagne wax 6 yards", "prix_fcfa": 12000}]})
CONV_EUR = outil({"montant_fcfa": 12000, "devise": "EUR", "taux": 0.001524, "montant_converti": 18.29})
TOTAL_K = outil({"total_articles_fcfa": 10500, "frais_livraison_fcfa": 3000, "total_fcfa": 13500})
CONV_NGN = outil({"montant_fcfa": 13500, "devise": "NGN", "taux": 2.289877, "montant_converti": 30913.34})

print("--- devises ---")
print("11.", verifier_devises([client("en nairas ?"), TOTAL_K, CONV_NGN],
      "Total : 13 500 FCFA, soit environ 30 913 nairas (NGN)."))
print("12.", verifier_devises([client("en nairas ?"), TOTAL_K, CONV_NGN],
      "Total : 13 500 FCFA, soit environ 30 900 nairas."))
print("13.", verifier_devises([client("en euros ?"), P01, CONV_EUR], "Le pagne fait 18,29 € pour votre sœur."))
print("14.", verifier_devises([client("en euros ?"), P01, CONV_EUR], "Le pagne fait environ 19 €."))
print("15.", verifier_devises([client("en euros ?"), PRIX_ROBE], "Cela fait environ 33 euros."))
print("16.", verifier_devises([client("en euros ?"), PRIX_ROBE, CONV], "Bonjour."))
print("17.", verifier_devises([client("j'ai 50 euros"), PRIX_ROBE],
      "Avec vos 50 euros, la robe à 22 000 FCFA est possible."))


print("--- taux et complétude ---")
print("18.", verifier_montants([client("x"), TOTAL_K], "Total 13 500 FCFA, taux 1 FCFA = 2,289877 NGN"))
print("19.", verifier_montants([client("x"), TOTAL_K], sans_taux("Total 13 500 FCFA, taux 1 FCFA = 2,289877 NGN")))
print("20.", verifier_devises([client("en nairas ?"), TOTAL_K, CONV_NGN],
      sans_taux("Soit 30 913,34 NGN (1 FCFA = 2,289877 NGN).")))
print("21.", verifier_devise_demandee([client("combien en nairas ?"), TOTAL_K, CONV_NGN],
      "Total : 13 500 FCFA. Souhaitez-vous commander ?"))
print("22.", verifier_devise_demandee([client("combien en nairas ?"), TOTAL_K, CONV_NGN],
      "Total : 13 500 FCFA, soit environ 30 913 nairas."))
print("23.", verifier_devise_demandee([client("combien en nairas ?"), TOTAL_K], "Total : 13 500 FCFA."))
print("24.", verifier_devise_demandee([client("Oui je confirme"), TOTAL_K, CONV_NGN], "Commande enregistrée."))