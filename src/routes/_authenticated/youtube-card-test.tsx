import { createFileRoute } from "@tanstack/react-router";
import { YouTubeCard } from "@/components/YouTubeCard";

export const Route = createFileRoute("/_authenticated/youtube-card-test")({
  component: TestPage,
});

function TestPage() {
  const note = {
    id: "test-yt",
    heading: "The Future of AI: A Deep Dive into Machine Learning",
    summary: "An overview of how AI is reshaping industries and what comes next.",
    created_at: new Date().toISOString(),
    pinned: false,
    tasks: [
      { id: "1", text: "Watch full video", done: false },
    ],
    youtube: {
      video_id: "dQw4w9WgXcQ",
      title: "The Future of AI: A Deep Dive into Machine Learning",
      channel_name: "Tech Vision",
      thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      duration_seconds: 754,
      captions_available: true,
    },
  };
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">Grid/hero horizontal</h2>
      <YouTubeCard note={note as any} variant="grid" />
      <YouTubeCard note={note as any} variant="hero" />
      <h2 className="text-sm font-semibold text-muted-foreground">Row</h2>
      <YouTubeCard note={note as any} variant="row" />
      <h2 className="text-sm font-semibold text-muted-foreground">Compact</h2>
      <div className="w-40">
        <YouTubeCard note={note as any} variant="compact" />
      </div>
    </div>
  );
}
