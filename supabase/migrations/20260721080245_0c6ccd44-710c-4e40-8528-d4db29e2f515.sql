
CREATE TYPE public.note_status AS ENUM ('recording','uploaded','transcribing','processing','ready','failed');

CREATE TABLE public.voice_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  audio_path TEXT NOT NULL,
  duration_seconds INTEGER,
  status public.note_status NOT NULL DEFAULT 'uploaded',
  transcript TEXT,
  heading TEXT,
  summary TEXT,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_notes TO authenticated;
GRANT ALL ON public.voice_notes TO service_role;

ALTER TABLE public.voice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own voice notes"
  ON public.voice_notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX voice_notes_user_created_idx ON public.voice_notes (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER voice_notes_set_updated_at
  BEFORE UPDATE ON public.voice_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
