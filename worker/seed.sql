DELETE FROM commandes;
DELETE FROM messages;
DELETE FROM traites;
DELETE FROM produits;
DELETE FROM zones;
DELETE FROM sqlite_sequence WHERE name IN ('commandes', 'messages');

INSERT INTO produits (ref, nom, prix, stock, categorie) VALUES
  ('P01', 'Pagne wax 6 yards', 12000, 14, 'vêtements'),
  ('P02', 'Chemise bazin homme', 18500, 3, 'vêtements'),
  ('P03', 'Sac en raphia', 7500, 0, 'accessoires'),
  ('P04', 'Sandales en cuir', 9000, 8, 'accessoires'),
  ('P05', 'Robe en wax', 22000, 5, 'vêtements'),
  ('P06', 'Beurre de karité 500 g', 3500, 40, 'soins');

INSERT INTO zones (nom, frais) VALUES
  ('Cotonou', 1000),
  ('Akpakpa', 1000),
  ('Fidjrossè', 1500),
  ('Calavi', 2000),
  ('Porto-Novo', 3000),
  ('Ouidah', 3500);