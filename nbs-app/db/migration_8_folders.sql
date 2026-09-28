-- Migration 8: Folder support for uploaded files
-- Run this once in Supabase (Database > SQL Editor > New query) against your
-- LIVE project. Safe to run more than once (every step is idempotent) and
-- does not touch or delete any existing sites, files, or versions.

-- Folders are scoped per site AND per category, so "Tender Spec Documents"
-- and Supporting Info's "Pictures" / "Quotation" / "Other Documents" each
-- keep their own, independent folder list.
create table if not exists file_folders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  category text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_file_folders_site_category on file_folders(site_id, category);

-- A file can belong to at most one folder. Deleting a folder does NOT delete
-- its files — they fall back to "no folder" (top level) automatically.
alter table supporting_files
  add column if not exists folder_id uuid references file_folders(id) on delete set null;

create index if not exists idx_supporting_files_folder on supporting_files(folder_id);

-- Same access model as every other table in this app: RLS is on, but with no
-- policies, so only the backend's SERVICE ROLE key (which bypasses RLS) can
-- read or write. The browser never talks to Supabase directly.
alter table file_folders enable row level security;
grant all privileges on file_folders to service_role;
grant usage, select on all sequences in schema public to service_role;
