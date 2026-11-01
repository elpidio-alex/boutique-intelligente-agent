import json

import agent_core

for m in agent_core.client.models.list().data:
    if m.id == agent_core.MODEL:
        print(json.dumps(m.model_dump(), ensure_ascii=False, indent=2))
        break
else:
    print(f"Modèle {agent_core.MODEL} introuvable dans le catalogue")