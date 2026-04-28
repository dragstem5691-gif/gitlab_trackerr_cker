# GitLab Time Tracking Report

A fast, beautiful web app for generating clean time reports from GitLab projects with support for PM-linked task clusters and cross-project linked items.

## Features

- **Time tracking aggregation**: Fetch all time entries from a GitLab project and its linked work items
- **PM clusters**: Automatically merge linked PM issues into one root cluster with attached branch work items
- **Per-user breakdowns**: See hours tracked per person, per issue, with period vs. all-time comparison
- **People ranking**: Flat ranking of contributors by hours in selected period with issue breakdowns
- **Tree roll-ups**: Automatic summation of each tree (root + all linked children) for quick overview
- **Grand totals**: Aggregate stats across entire report with top contributors highlighted
- **Build logging**: Real-time visibility into data collection steps, GraphQL pages, cross-project fetches
- **Session-only storage**: Token and settings kept in browser sessionStorage, never persisted
- **Demo mode**: Try with bundled sample data (no GitLab token needed)

## Quick Start

### Prerequisites
- Node.js 16+ and npm
- A GitLab account with API access (for real data) or use demo mode

### Installation

```bash
npm install
npm run dev
```

Open browser to `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run preview
```

Output goes to `dist/` directory.

### Run with Docker

```bash
docker compose up -d --build
```

Open browser to `http://localhost:8080`

To stop the container:

```bash
docker compose down
```

## Usage

1. **Enter GitLab instance URL** (e.g., `https://gitlab.com` or your self-hosted GitLab)
2. **Paste your GitLab personal access token** (create one at `/user/profile/personal_access_tokens`)
3. **Enter project path** (e.g., `group/project-name` or `https://gitlab.com/group/project-name`)
4. **Select date range** for the report period
5. **Click "Build report"** to fetch and aggregate data

The **Trees** view shows:
- Grand total banner (all PM clusters + standalone items)
- Per-tree roll-up banners (root + linked children)
- Full issue details with per-user breakdown

The **People** view shows:
- Ranked contributors by hours in period
- Share percentage and all-time comparison
- Expandable per-issue breakdown

Click **"New report"** to reset and start fresh. Use **Demo** button to try with sample data.

## Security

- Your GitLab token is stored **only in this browser tab's sessionStorage**
- It is **never persisted** to disk or sent anywhere except to your GitLab instance
- Each new browser session requires you to paste the token again
- All computation happens client-side

## Architecture

- **Frontend**: React 18 + TypeScript + Tailwind CSS + Vite
- **APIs**: GitLab GraphQL (for issues & timelogs) + REST (for issue links)
- **Build tooling**: Vite + ESLint + TypeScript strict mode
- **Icons**: Lucide React (no external UI library dependencies)

## File Structure

```
src/
  components/
    BuildLog.tsx           # Real-time log of collection/aggregation steps
    FilterForm.tsx         # Project/date input form
    IssueNodeCard.tsx      # Tree node card with per-user breakdown
    PeopleView.tsx         # Flat ranking of contributors
    ReportView.tsx         # Main report display with tabs (Trees/People)
  lib/
    aggregation.ts         # Tree roll-ups, grand totals, people ranking
    gitlab.ts              # GitLab GraphQL & REST client
    logger.ts              # Build event logging system
    time.ts                # Date/time utilities
    demoData.ts            # Sample dataset for demo mode
  App.tsx                  # Main app component with logger integration
  types.ts                 # TypeScript type definitions
  index.css                # Global Tailwind styles
  main.tsx                 # React entry point
```

## Development

```bash
# Start dev server (hot reload)
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Build for production
npm run build

# Preview production build locally
npm run preview
```

## Limitations

- GitLab API rate limits may apply (usually 300 requests/min)
- Time entries must have a `spentAt` date within the selected period
- Linked items must be accessible to the authenticated user
- Only supports date ranges (no custom time-of-day filtering)

## License

MIT

## Troubleshooting

**"Project not found"**
- Check project path spelling
- Ensure token has `read_api` permission
- Verify GitLab instance URL matches your instance

**"No data found"**
- Verify time entries exist in GitLab for the selected period
- Check that users have time entries in the format GitLab expects
- Try expanding the date range

**Build is slow**
- Large projects (1000+ issues) take longer due to API pagination
- Cross-project fetches add per-link latency (parallel in browser)
- Check browser console (F12) for detailed progress in BuildLog

**Token not saved between sessions**
- Session storage is intentionally cleared on browser refresh
- Paste token again or check browser settings (don't clear on exit)
