-- Newborn Screening Malaysia — Tendering Cost Estimator
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).

create extension if not exists pgcrypto;

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists discussion_messages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  author text not null default 'Team',
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_discussion_site on discussion_messages(site_id, created_at);

-- Keep updated_at current on every edit
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_sites_updated_at on sites;
create trigger trg_sites_updated_at
  before update on sites
  for each row execute function set_updated_at();

-- Row Level Security: locked down. The app's backend talks to this database
-- using the SERVICE ROLE key only (never exposed to the browser), so RLS
-- can stay restrictive — no anon/public access is required or granted.
alter table sites enable row level security;
alter table discussion_messages enable row level security;
-- (No policies are added on purpose: only the service role, which bypasses
-- RLS, can read/write. The browser never talks to Supabase directly.)

-- Seed the first site so the app has something to open on first load.
-- Feel free to rename or delete this row from within the app itself.
insert into sites (name, data)
values (
  'Site 1',
  '{
    "batchSetup": {"batches": 5, "samplesPerBatch": 40, "calLevels": 8, "calReps": 1, "qcLevels": 2, "qcReps": 1, "blanksPerBatch": 0},
    "lcGradient": [
      {"no":1,"time":0.00,"flow":0.600,"a":90,"b":10,"shape":"Initial"},
      {"no":2,"time":1.00,"flow":0.600,"a":80,"b":20,"shape":"Linear"},
      {"no":3,"time":3.00,"flow":0.600,"a":75,"b":25,"shape":"Linear"},
      {"no":4,"time":5.00,"flow":0.600,"a":65,"b":35,"shape":"Linear"},
      {"no":5,"time":6.00,"flow":0.600,"a":55,"b":45,"shape":"Linear"},
      {"no":6,"time":7.00,"flow":0.600,"a":30,"b":70,"shape":"Linear"},
      {"no":7,"time":7.10,"flow":0.600,"a":5,"b":95,"shape":"Linear"},
      {"no":8,"time":8.00,"flow":0.600,"a":5,"b":95,"shape":"Linear"},
      {"no":9,"time":8.01,"flow":0.600,"a":90,"b":10,"shape":"Linear"},
      {"no":10,"time":10.00,"flow":0.600,"a":90,"b":10,"shape":"Linear"}
    ],
    "calibratorPrep": {
      "stockDilution": [
        {"level":"S1 (neat stock)","conc":500,"vol":null,"meoh":null},
        {"level":"S2","conc":400,"vol":160,"meoh":40},
        {"level":"S3","conc":200,"vol":100,"meoh":100},
        {"level":"S4","conc":100,"vol":100,"meoh":100},
        {"level":"S5","conc":50,"vol":100,"meoh":100},
        {"level":"S6","conc":25,"vol":100,"meoh":100},
        {"level":"S7","conc":12.5,"vol":100,"meoh":100},
        {"level":"S8","conc":6.25,"vol":100,"meoh":100}
      ],
      "workingPrep": [
        {"level":"P1","source":"S1 (neat stock)","vol":15,"isVol":100},
        {"level":"P2","source":"S2","vol":15,"isVol":100},
        {"level":"P3","source":"S3","vol":15,"isVol":100},
        {"level":"P4","source":"S4","vol":15,"isVol":100},
        {"level":"P5","source":"S5","vol":15,"isVol":100},
        {"level":"P6","source":"S6","vol":15,"isVol":100},
        {"level":"P7","source":"S7","vol":15,"isVol":100},
        {"level":"P8","source":"S8","vol":15,"isVol":100}
      ],
      "qcPrep": [
        {"level":"QC1","vol":15,"isVol":100},
        {"level":"QC2","vol":15,"isVol":100}
      ],
      "standard": {"vialSize":1000,"dead":50,"costPerVial":400},
      "methanol": {"bottleSize":4000,"dead":30,"costPerBottle":45}
    },
    "reagents": {
      "is": {"volPerUse":100,"vialSize":1500,"dead":100,"costPerVial":350},
      "qc": {"volPerUse":15,"vialSize":500,"dead":50,"costPerVial":220}
    },
    "column": {
      "analytical": {"label":"Analytical column","cost":650,"lifetime":500},
      "guard": {"label":"Guard column","cost":120,"lifetime":100}
    },
    "solvents": {
      "pfheptaConc": 0.001,
      "water": {"bottleSize":4000,"dead":30,"costPerBottle":10},
      "acn": {"bottleSize":4000,"dead":30,"costPerBottle":55},
      "pfhepta": {"bottleSize":100,"dead":3,"costPerBottle":180}
    }
  }'::jsonb
)
on conflict do nothing;
