-- Phase 8.3: film tenuti per il cinema/prossimamente.
-- Additiva e idempotente: i film esistenti restano eleggibili come prima.
alter table public.movies
  add column if not exists cinema_watchlist boolean not null default false;
