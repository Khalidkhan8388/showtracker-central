alter table public.voice_notes add column if not exists tags text[] not null default '{}';
create index if not exists voice_notes_tags_idx on public.voice_notes using gin(tags);