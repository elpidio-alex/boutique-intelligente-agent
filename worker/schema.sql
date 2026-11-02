CREATE TABLE IF NOT EXISTS produits (
  ref TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  prix INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  categorie TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  nom TEXT PRIMARY KEY,
  frais INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commandes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  nom_client TEXT,
  lignes TEXT NOT NULL,
  zone TEXT NOT NULL,
  total INTEGER NOT NULL,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  cree_le INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_une_commande_en_attente
  ON commandes (client) WHERE statut = 'en_attente';

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client TEXT NOT NULL,
  role TEXT NOT NULL,
  contenu TEXT NOT NULL,
  cree_le INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_client ON messages (client, id);

CREATE TABLE IF NOT EXISTS traites (
  id_message TEXT PRIMARY KEY,
  cree_le INTEGER NOT NULL
);