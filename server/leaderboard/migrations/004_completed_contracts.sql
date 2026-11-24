-- One casual, client-reported board; no player or score rows are seeded.
-- Score is the integer count of contracts actually completed in the current
-- play session, reset on reload and not imported from previous local saves.
-- Issue a fresh ticket at each contract start, submit only on completion, and
-- report the session count and this contract's duration. Higher is better.
-- The service retains each player's best reported session count; it does not
-- sum separate submissions. Bounds: 1..1000 contracts and 1000..1800000 ms.
-- Tickets expire after 30 minutes and must be submitted before expiry.
-- v1 rules are immutable; change scoring with a new board ID and migration.
INSERT INTO game_lb_boards
  (namespace, id, rules_version, direction, min_score, max_score,
   min_duration_ms, max_duration_ms, `open`)
VALUES
  ('production', 'completed-contracts-v1', 'v1', 'desc', 1, 1000,
   1000, 1800000, TRUE);
