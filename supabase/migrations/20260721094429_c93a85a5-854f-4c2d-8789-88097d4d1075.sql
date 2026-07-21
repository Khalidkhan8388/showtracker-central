ALTER TABLE public.voice_notes ALTER COLUMN audio_path DROP NOT NULL;
ALTER TABLE public.voice_notes ADD COLUMN IF NOT EXISTS image_paths jsonb NOT NULL DEFAULT '[]'::jsonb;