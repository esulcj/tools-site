# Tools Site — Build Rules

## What this is
tools.tycho.sh — internal documentation and tools hub.

## Tech
- Pure HTML/CSS. No frameworks. No build step.
- System font stack, max-width 960px centered, light theme only.
- Deploy: `npx wrangler pages deploy . --project-name=tycho-tools --branch=main`
- CF credentials via env: CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL

## Rules
- Light theme ONLY. White background, grey accents. No dark mode.
- Responsive. Must work on phone.
- Do NOT modify content of existing pages (agent-architectures.html, specialist-plan.html). Only add shared nav.
- All links to external sites (review.tycho.sh, deck.tycho.sh) open in new tab.
- No JavaScript frameworks. Vanilla only.
- Card grid on index.html for navigation.
