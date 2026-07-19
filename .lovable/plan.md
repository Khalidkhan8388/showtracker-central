
# Personal Film & TV Tracker (v1)

A mobile-first web app to search movies, TV shows, and people from TMDB, save them to your lists, and track episode progress. Single-user, no login — everything stored in your browser (localStorage). Clean light minimal look.

Music, Reels, and Tasks are intentionally out of scope for v1 and can be added later without rework.

## Screens

1. **Home** — quick stats (Watching, Watchlist, Up Next episodes), "Continue watching" row of shows with next unwatched episode, jump to search.
2. **Search** — single search bar that queries TMDB multi-search; results grouped as Movies / TV / People with posters.
3. **Movie detail** — poster, overview, cast, rating; buttons: Watchlist / Watched / Rate / Note.
4. **TV detail** — overview, cast, seasons list. Tap a season → episode list with a checkbox per episode; progress bar ("12 / 24 watched"); "Mark season watched" / "Mark up to here". Buttons: Watchlist / Watching / Completed.
5. **Person detail** — photo, bio, known-for filmography (tap → movie/TV detail). Follow toggle.
6. **My Library** — tabs: Movies, TV, People. Filters: Watchlist / Watching / Completed / Rated. List with poster, title, rating, progress.
7. **Settings** — TMDB API key input, theme (light only for v1), export/import JSON of your library.

## Navigation

Bottom tab bar (thumb-friendly): Home · Search · Library · Settings.

## Design

- Light minimal: white background `#FFFFFF`, surface `#F5F5F7`, ink `#111111`, accent red `#FF3B30`.
- Generous spacing, rounded-2xl cards, subtle borders, no gradients.
- Typography: one clean sans (Inter). Bold titles, muted meta.
- Poster-forward: covers do the visual work; chrome stays quiet.
- Mobile-first (390px); scales gracefully to desktop as centered column (max-w-md).

## Data & storage

- **Source:** TMDB API v3 for movies, TV, seasons, episodes, and people. User pastes their free TMDB API key in Settings on first run (stored in localStorage). Until a key is set, Search shows a friendly "Add TMDB key in Settings" state.
- **Local library (localStorage) shape:**
  - `movies`: `{ id, title, poster, year, status: 'watchlist'|'watched', rating?, note?, addedAt }`
  - `shows`: `{ id, name, poster, status: 'watchlist'|'watching'|'completed', rating?, note?, addedAt, watchedEpisodes: { [seasonNum]: number[] } }`
  - `people`: `{ id, name, photo, followedAt }`
  - `settings`: `{ tmdbApiKey }`
- **Episode tracker:** on TV detail, we fetch season data from TMDB on demand and cross-reference `watchedEpisodes[seasonNum]` to render checkboxes and progress. "Up Next" on Home = first unwatched episode of each `watching` show, computed from cached season data.
- No backend, no login. Export/import gives portability across devices.

## Route map (TanStack Start)

- `/` — Home
- `/search` — Search (query in URL search params `?q=`)
- `/movie/$id` — Movie detail
- `/tv/$id` — TV detail
- `/tv/$id/season/$season` — Season + episode tracker
- `/person/$id` — Person detail
- `/library` — Library (tab in URL search params `?tab=movies|tv|people&filter=...`)
- `/settings` — Settings

## Technical details

- Stack: TanStack Start + React + Tailwind v4 + shadcn/ui, per template.
- TMDB calls happen client-side from the browser using the user's key (no server functions needed; keeps it truly local/no-login). Base: `https://api.themoviedb.org/3`, images: `https://image.tmdb.org/t/p/w500`.
- Data fetching via TanStack Query (`useQuery` for detail pages; loaders stay light since the API key is client-side). Search is debounced.
- Library state via a small `useLibrary()` hook backed by localStorage with a React context provider and cross-tab sync via `storage` event.
- Bottom tab bar component; each route sets its own `head()` title.
- Placeholder `src/routes/index.tsx` is rewritten to be the real Home.
- Icons: lucide-react. No heavy chart libs needed for v1.

## What's NOT in v1

Music, Reels/web clips, Tasks, multi-user login, social features, notifications. Structure leaves room to add these as sibling routes and library slices later.
