# CLAUDE.md — skalej.dev

## Project Overview

Personal portfolio and blog website for Saeid Kaleji, a software engineer based in Germany. Built with Astro 5, styled with Tailwind CSS v4, and deployed on Cloudflare Pages.

**Live URL:** https://kaleji.dev/
**Package manager:** pnpm

## Key Commands

```bash
pnpm dev          # Start dev server
pnpm build        # Type-check, build site, generate Pagefind search index
pnpm preview      # Preview production build
pnpm format       # Format code with Prettier
pnpm format:check # Check formatting
pnpm lint         # Run ESLint
```

## Architecture

### Tech Stack

- **Framework:** Astro 5 (static site generation)
- **Styling:** Tailwind CSS v4 (via Vite plugin, not PostCSS)
- **Language:** TypeScript (strict mode)
- **Search:** Pagefind (static search, index built at build time)
- **OG Images:** Satori + resvg-js (dynamic generation)
- **Date handling:** dayjs (timezone: Europe/Berlin)
- **Deployment:** Cloudflare Pages
- **CI:** GitHub Actions (lint, format check, build on PRs)

### Project Structure

```
src/
├── assets/images/          # Images referenced in content
├── components/             # Reusable Astro components
├── data/
│   ├── blog/               # Blog posts (Markdown, content collection)
│   └── projects/           # Projects (Markdown, content collection)
├── layouts/                # Page layouts (Layout, Main, PostDetails, ProjectDetails, AboutLayout)
├── pages/                  # File-based routing
├── scripts/                # Client-side scripts (theme toggle, etc.)
├── styles/
│   ├── global.css          # Theme variables, custom utilities
│   └── typography.css      # Prose/typography styles
├── utils/                  # Helpers (sorting, filtering, slugify, OG generation)
├── config.ts               # Site-wide configuration (SITE object)
├── constants.ts            # Social links
└── content.config.ts       # Content collection schemas (blog + projects)
```

### Content Collections

**Blog** (`src/data/blog/*.md`): Posts with frontmatter — author, pubDatetime, title, tags, description, featured, draft, ogImage, canonicalURL, hideEditPost, timezone.

**Projects** (`src/data/projects/*.md`): Projects with frontmatter — title, description, pubDatetime, techStack[], liveUrl, githubUrl, image, featured, draft, keywords[].

Draft posts and future-dated posts are filtered out in production via `src/utils/postFilter.ts`.

### Routing

| Route | Description |
|-------|-------------|
| `/` | Homepage (featured projects + posts, recent posts) |
| `/posts/[...page]` | Paginated blog listing |
| `/posts/[slug]` | Individual blog post |
| `/projects` | Projects listing |
| `/projects/[slug]` | Individual project |
| `/tags` | All tags |
| `/tags/[tag]/[...page]` | Posts by tag |
| `/archives` | All posts archive |
| `/about` | About page (Markdown at `src/pages/about.md`) |
| `/search` | Pagefind search |
| `/rss.xml` | RSS feed |

### Styling

- Tailwind CSS v4 with `@theme` directive in `global.css`
- Light/dark mode via CSS variables on `<html>` data-theme attribute
- Light accent: `#006cac` (blue), Dark accent: `#ff6b01` (orange)
- Typography plugin with custom prose overrides in `typography.css`
- Code blocks styled with Shiki (themes: min-light / night-owl)

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).

### Site Config

All site-wide settings live in `src/config.ts` (SITE object): author name, description, OG image settings, posts per page, timezone, etc.

### Key Patterns

- Components use Astro's `.astro` single-file format (no React/Vue runtime)
- View transitions enabled via Astro's Client Router
- OG images are dynamically generated per post/project when `SITE.dynamicOgImage` is true
- Shiki transformers support `[!code highlight]`, `[!code ++]`, `[!code --]`, `[!code word:text]`, and filename annotations in code blocks
- Theme preference stored in localStorage, synced with system preference
- Pagefind search index is built post-build and copied to `public/pagefind/`
