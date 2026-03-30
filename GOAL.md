# Tools.tycho.sh — Internal Tools & Documentation Hub

## Problem
tools.tycho.sh currently has no index page — it's a blank site. Individual HTML pages get deployed to it (like agent-architectures.html) but there's no home, no navigation, no coherent site structure.

## What the user sees
A clean, professional internal tools site. Light theme (white/light grey). Think: a team wiki meets a docs site. Not flashy, just good typography and clear navigation.

### Landing page (index.html)
- Site title: "Tycho Tools"
- Subtitle: "Internal documentation, dashboards, and tools"
- Card grid linking to available tools and pages:
  - **Fundraising HQ** → review.tycho.sh (external link)
  - **Investor Deck** → deck.tycho.sh (external link)
  - **Agent Architectures** → /agent-architectures.html (research on multi-agent patterns)
  - **Specialist Plan** → /specialist-plan.html (implementation plan for thin-router pattern)
  - **System Status** → links to key dashboards/monitoring
- Footer with "Powered by Tycho ⚡"
- Responsive: works on phone

### Navigation
- Simple top nav bar: "Tycho Tools" on left, links on right
- Nav persists across all pages (shared header component or just consistent HTML)

### Style
- System font stack
- Max-width 960px centered content
- Light theme ONLY. White background, subtle grey accents.
- Cards with subtle shadow/border for the grid
- No JavaScript frameworks. Vanilla HTML/CSS. Minimal JS if needed.
- No dark mode toggle, no theme switcher

### Pages included in this build
1. **index.html** — landing page with card grid
2. **_header.html** — shared nav (or just paste into each page)

### Existing pages to preserve
- agent-architectures.html (35KB, already deployed)
- specialist-plan.html (being written by another agent, will arrive soon)

These existing pages should get the shared nav added to them but their content must NOT be modified.

## What "done" looks like
1. Visit tools.tycho.sh → see a clean landing page with card grid
2. Click a card → go to the right page
3. All existing pages still work
4. Looks good on mobile
5. Deployed and verified with curl

## Technical details
- Deploy: `npx wrangler pages deploy . --project-name=tycho-tools --branch=main`
- Auth: CF Access (already configured, 302 redirect)
- Working directory: /Users/theclaw/.openclaw/workspace/tools-site/
- CF credentials: `CLOUDFLARE_API_KEY=$(security find-generic-password -a "tycho" -s "tycho/cloudflare-global-api-key" -w) CLOUDFLARE_EMAIL="theo@cloudnc.com"`
