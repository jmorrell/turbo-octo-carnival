# Rendering the project walkthrough

[overview.md](overview.md) is the source of truth. GitHub renders its Mermaid diagrams directly. [overview.html](overview.html) is a generated, self-contained edition with inline SVG diagrams, a contents menu, and diagram enlargement. It can be opened offline.

The documentation renderer uses temporary dependencies outside the project. They are not dependencies of Fieldwork or its deployed Worker:

    DOCS_DEPS=$(mktemp -d)
    npm install --prefix "$DOCS_DEPS" --no-audit --no-fund mermaid@12.1.0 marked@15.0.12
    npx playwright install chromium
    node scripts/render-overview.mjs "$DOCS_DEPS"

Run these commands from the repository root after npm ci. The renderer uses the project's Playwright installation and a temporary HTTP server bound to loopback to render Mermaid, then closes both the browser and server. The resulting HTML loads no scripts, fonts, or styles from the network. Links to repository files are ordinary online navigation.

To change prose or diagram structure, edit overview.md and regenerate. The script also validates that every diagram parses and produces SVG. Check the resulting HTML at desktop and mobile widths before committing it.
