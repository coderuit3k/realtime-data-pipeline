-- Run this once in your Supabase project's SQL editor (Dashboard -> SQL
-- Editor -> New query). Not applied automatically by this project's CI --
-- Supabase is a separate service from the AWS/Terraform infrastructure.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_session_id_idx on conversations (session_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  question text not null,
  answer text not null,
  grounded boolean not null,
  tool_calls jsonb not null default '[]',
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index messages_conversation_id_idx on messages (conversation_id, created_at);
