-- CircleHQ Supabase Schema
-- This file contains the SQL required to set up the database for CircleHQ,
-- including the pgvector extension for semantic search.

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Profiles table
create table if not exists profiles (
  id uuid primary key default uuid_generate_v4(),
  telegram_id text unique not null,
  username text,
  name text,
  location text,
  working_on text,
  interests text[],
  looking_for text,
  photo_file_id text,
  bio text,
  onboarding_step text default 'name',
  semantic_summary text,
  embedding vector(768), -- Dimension for gemini-embedding-2-preview
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. Connections table (Successful matches)
create table if not exists connections (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  connection_strength float default 0,
  source text,
  created_at timestamp with time zone default now()
);

-- 4. Introductions table (Log of intros made)
create table if not exists introductions (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  intro_text text,
  feedback_score int,
  nudge_1_sent boolean default false,
  feedback_asked boolean default false,
  nudge_2_sent boolean default false,
  created_at timestamp with time zone default now()
);

-- 5. Matches table (To prevent repeated introductions)
create table if not exists matches (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  similarity_score float,
  introduced_at timestamp with time zone default now()
);

-- 6. Match Queue table (For curated one-by-one matchmaking)
create table if not exists match_queue (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  candidate_user_id uuid references profiles(id),
  rank int,
  shown boolean default false,
  accepted boolean default false,
  created_at timestamp with time zone default now()
);

-- 7. Skipped Matches table
create table if not exists skipped_matches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  candidate_user_id uuid references profiles(id),
  skipped_at timestamp with time zone default now()
);

-- 8. User Interactions table (Social Graph Memory)
create table if not exists user_interactions (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references profiles(id),
  user_b uuid references profiles(id),
  interaction_type text,
  strength float default 1.0,
  created_at timestamp with time zone default now()
);

-- 9. Vector Matching Function
-- This function performs the semantic search using cosine similarity.
drop function if exists match_profiles(vector, float, int);

create or replace function match_profiles(
  query_embedding vector(768), 
  match_threshold float, 
  match_count int
)
returns table (
  id uuid,
  name text,
  location text,
  semantic_summary text,
  interests text[],
  photo_file_id text,
  bio text,
  working_on text,
  looking_for text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    profiles.id,
    profiles.name,
    profiles.location,
    profiles.semantic_summary,
    profiles.interests,
    profiles.photo_file_id,
    profiles.bio,
    profiles.working_on,
    profiles.looking_for,
    1 - (profiles.embedding <=> query_embedding) as similarity
  from profiles
  where 1 - (profiles.embedding <=> query_embedding) > match_threshold
  order by profiles.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- 10. Agent Log table
create table if not exists agent_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references profiles(id),
  action text,
  details text,
  created_at timestamp with time zone default now()
);

-- 11. Messages table
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  telegram_id text,
  direction text, -- 'incoming' or 'outgoing'
  content text,
  created_at timestamp with time zone default now()
);

-- 7. Indexes for performance
create index on profiles using ivfflat (embedding vector_cosine_ops)
with (lists = 100);
