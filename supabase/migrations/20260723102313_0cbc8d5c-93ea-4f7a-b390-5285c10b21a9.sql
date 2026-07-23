ALTER TABLE public.voice_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS voice_notes_deleted_at_idx ON public.voice_notes (user_id, deleted_at);