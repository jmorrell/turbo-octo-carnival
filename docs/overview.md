# Fieldwork: an illustrated walkthrough

Fieldwork gives people and their own agents a shared place to **publish evidence, see what it means, and continue each other's investigations**. The durable unit is a saved observation with its context. A chat can end or compact without taking the investigation with it.

This guide describes the PoC as built on 3 October 2026, including the unified Cloudflare SQL integration. Gatekeepers are a proposed extension, clearly marked below.

**Reading route:** [system](#1-what-runs-where) → [saved evidence](#2-what-an-artifact-actually-contains) → [example investigation](#3-follow-one-investigation) → [publication](#4-how-a-query-becomes-shared-evidence) → [collaboration](#5-how-people-and-agents-work-together) → [custom views](#6-how-custom-views-run) → [SQL](#7-how-cloudflare-sql-fits) → [next boundaries](#8-what-is-built-and-what-comes-next).

An [offline HTML edition](overview.html) contains the same guide and rendered diagrams. Download it and open it in a browser; it needs no server or network connection. For the interface itself, see the [workspace screenshot](workspace.png).

## 1. What runs where

Your agent keeps its own model, tools, credentials, and conversation. Fieldwork supplies the shared record, visual components, and collaboration API. Humans and agents use the same underlying operations.

~~~mermaid
flowchart TB
    accTitle: Fieldwork deployment and clients
    accDescr: Browsers and external agents call a Cloudflare Worker, which routes each room to a Durable Object. The room stores artifacts in R2, queries Cloudflare SQL, and runs custom views in isolated Dynamic Workers. Agents can also collect data with their own tools.
    Browser["Browser<br/>React + ECharts"]
    Agent["Your agent<br/>CLI or MCP"]
    External["Other sources<br/>your existing tools"]
    subgraph Cloudflare["Cloudflare runtime and services"]
        API["Worker<br/>routing + assets"]
        Room["Room Durable Object<br/>SQLite + WebSockets"]
        Archive[("R2<br/>full artifacts")]
        Render["Dynamic Workers<br/>custom rendering"]
        SQL["Cloudflare SQL<br/>upstream query service"]
    end
    Browser <-->|"HTTP + WS"| API
    Agent <-->|"HTTP"| API
    Agent <-->|"own tools"| External
    API <-->|"room ID"| Room
    Room <-->|"save / read"| Archive
    Room <-->|"render"| Render
    Room <-->|"query / result"| SQL
~~~

The Durable Object is the natural coordination point: it serializes room mutations, assigns event order, and maintains live connections. Each room has its own object. SQLite holds the small working index; R2 holds the complete evidence. Cloudflare SQL is an upstream service reached through a binding or the HTTPS endpoint.

An investigation can run for hours across many agents without a long-lived agent process inside Fieldwork. External tools can do arbitrary work and publish the useful outputs when ready. Native adapters currently cover the synthetic fixture and Cloudflare SQL; another source can participate immediately through JSON import.

## 2. What an artifact actually contains

The objects are deliberately small in number:

| Object | Meaning |
| --- | --- |
| Room | A shared investigation, its threads, saved evidence, and ordered activity |
| Thread / branch | An organizational view with its own new artifacts and a fixed set inherited at fork time |
| Artifact | Saved data together with metadata explaining what it is, where it came from, and how to display it |
| Finding | An artifact containing an interpretation, a status, and citations to other artifacts |

An artifact stores the actual JSON output, a title, author/harness labels, timestamps, source details, parent artifact IDs, a view type, and a hash of the saved data. Native captures add the executed query and connection choice. Custom views add their function source, code hash, input IDs, drawing, and SVG snapshot.

**An artifact ID identifies one saved observation.** Opening its chart reads that observation; it does not silently rerun the query. A query rerun creates another artifact linked to the old one.

Provenance has four meanings, assigned by the server:

| Label | What Fieldwork knows |
| --- | --- |
| Captured | Its adapter recorded a request and result together |
| Imported | An investigator supplied the output and its source description |
| Derived | A custom renderer ran over explicitly identified saved inputs |
| Inference | An investigator published an interpretation |

This makes incomplete provenance usable and visible. Imports need no recipe, and neither queries nor renderers must be deterministic. An import's instructions remain text for an investigator to follow with their own tools. A content hash identifies the saved JSON; it does not attest to source truth, verified authorship, or a correct conclusion. A finding marked supported must cite evidence, but Fieldwork does not assess its reasoning.

## 3. Follow one investigation

The included example asks why checkout latency increased in eu-west. All incident data and investigator labels are fictional. The fixture goes through the real storage, rendering, and publication paths; no Codex or pi model is run to generate the example.

~~~mermaid
flowchart TB
    accTitle: Evidence behind the example retry hypothesis
    accDescr: The latency observation leads to a sampled trace. A custom timeline derives from that trace. The finding cites the latency chart, heatmap, deployment events, and trace; the timeline is a visualization of existing evidence.
    L["Captured · latency chart<br/>eu-west diverges after 10:24"]
    H["Captured · heatmap<br/>a second latency band appears"]
    D["Imported · deployment events<br/>retry rollout completes at 10:24"]
    T["Imported · trace stages<br/>400 ms spent in retry backoff"]
    V["Derived · custom timeline<br/>Where the time goes"]
    F["Open finding<br/>Synchronous retries are a candidate cause"]
    L -->|"guided follow-up"| T
    T -->|"saved input"| V
    L -->|"cited by"| F
    H -->|"cited by"| F
    D -->|"cited by"| F
    T -->|"cited by"| F
~~~

The arrows follow saved parent references. They record investigative lineage and citations, not proof of causation.

The six cards answer different questions. The line chart locates the regression, the heatmap shows its distribution, and the deployment table supplies a plausible trigger. The sampled trace shows a possible mechanism. The custom timeline makes those same trace stages easier to understand; it is not an additional independent measurement.

The finding remains **open**. Its text asks for more traces and a test of disabling the retry change. Another engineer can fetch those exact observations, fork a thread to challenge the hypothesis, and publish counterevidence with a different agent.

## 4. How a query becomes shared evidence

This is the normal successful query path. The entry Worker routes the request to the room; it is omitted here to keep the sequence readable.

~~~mermaid
sequenceDiagram
    accTitle: Capturing and publishing a query result
    accDescr: The room runs a source query, saves the complete artifact in R2, commits its SQLite metadata and event, then notifies browsers. Browsers fetch the saved result rather than rerunning the query.
    participant A as Agent or browser
    participant R as Room Durable Object
    participant S as SQL source
    participant O as R2 archive
    participant B as Other browser
    A->>R: POST /query + room key
    R->>S: SQL + parameters
    S-->>R: Complete JSON result
    R->>O: PUT new artifact: receipt + data
    O-->>R: Stored
    R->>R: SQLite transaction: metadata, event,<br/>idempotency result when supplied
    R-->>B: WebSocket: changed + cursor
    R-->>A: 201 + artifact metadata
    B->>R: GET room state, then new artifact
    R->>O: GET saved artifact
    O-->>R: Archived JSON
    R-->>B: Data + provenance for display
~~~

Saving to R2 first prevents a successful metadata publication from pointing at an unfinished upload. The SQLite transaction commits the evidence index, event, and optional idempotency result together. R2 and SQLite are not one distributed transaction: a failure between them can leave an unreferenced R2 object. There is no orphan collector yet.

Agents can supply an idempotency key when retrying a write after a lost response. A completed operation with the same key and request returns its earlier result; a different request using that key is rejected.

Publication is append-only through the API. There are no artifact update or delete endpoints. That preserves the application history, while long-term retention and backups remain operational responsibilities.

## 5. How people and agents work together

**Multiplayer today means shared evidence, presence, activity, and independent threads.** Browsers receive WebSocket invalidations and fetch fresh state plus missing artifacts. They reload state on reconnect. This is publication-level collaboration; there is no character-by-character shared editor or synchronized cursor.

A fork records artifact IDs rather than copying data:

~~~mermaid
flowchart LR
    accTitle: A fork inherits a fixed evidence set
    accDescr: Main contains A and B when a fork is created. Main later adds C, while the fork adds D. Main sees A, B, C and the fork sees A, B, D.
    M["Main at fork time<br/>A, B"]
    F["New thread<br/>inheritedIds = A, B"]
    MC["Main adds C<br/>sees A, B, C"]
    FD["Thread adds D<br/>sees A, B, D"]
    M -->|"continue"| MC
    M -->|"fork"| F
    F -->|"continue"| FD
~~~

A fork can inherit everything visible at creation, or only through a selected anchor artifact. Later parent-thread work does not appear automatically. There is no merge operation yet, although findings can cite any artifact in the same room. Threads are not access boundaries.

For agents, the loop is: **read the room → fetch relevant evidence → investigate with any tools → publish observations and findings → read colleagues' changes**. The MCP tools and CLI expose these operations without choosing a model or harness. Agents retain the room, thread, and last change cursor in their own context, then page through changes after a compaction or interruption. Events identify new work; full artifacts are fetched separately.

For humans, dragging a time range on a standard chart creates a structured selection with the source artifact ID. It can seed a follow-up query or be copied to an agent. Fieldwork does not automatically schedule an agent when someone makes a selection.

## 6. How custom views run

Standard views are host-owned React/ECharts components: line charts, heatmaps, tables, and JSON. Charts support time selections. SQL result envelopes render their rows as tables while preserving the complete response for inspection.

When those views do not fit, an agent submits a JavaScript function and one to eight saved input IDs. The function computes a **declarative drawing**. The host controls what reaches the browser.

~~~mermaid
flowchart LR
    accTitle: Custom renderer execution boundary
    accDescr: Fieldwork loads only the selected saved artifacts, passes them to an isolated Dynamic Worker, validates its drawing, archives the code and output, and displays an SVG image in the browser.
    C["Agent function<br/>+ input IDs"]
    I["Host loads<br/>saved inputs"]
    subgraph Isolation["Untrusted code boundary"]
        W["Dynamic Worker<br/>no network or bindings"]
    end
    V["Host validates<br/>drawing JSON"]
    O["R2 archive<br/>code + inputs + output"]
    B["Browser<br/>SVG image"]
    C --> I --> W --> V
    V --> O
    O --> B
~~~

The renderer gets those complete artifacts, not room credentials or a source connection. The host rejects scripts, HTML, event handlers, external references, and arbitrary CSS in its output. It limits the drawing to 256 KiB, 2,000 nodes, and depth 24, with a five-second request timeout.

Agent JavaScript executes in the Dynamic Worker, never in the workspace browser. Custom views are currently static SVG images; richer interactions remain future work. The saved SVG preserves the observed output even if rerunning the code later gives a different result. Rerunning a component uses its original saved inputs and creates a new revision.

This borrows Cloudflare OS's principle of a small host with explicitly limited extension capabilities. It does not embed the Cloudflare OS gadget runtime. The [component contract](architecture.md#custom-components-and-cloudflare-os) and [example function](../examples/render.js) show the exact interface.

## 7. How Cloudflare SQL fits

The native adapter uses the unified SQL API released on 2 October 2026. Both connections feed the same artifact publication path:

| Connection | When it is used | Current constraints |
| --- | --- | --- |
| Workers binding: ANALYTICS_SQL | Preferred automatically when configured and no request-level scope or time_range is supplied | Deploying account; SQL and params; no Log Explorer, explicit FORMAT, or request-level scope/time_range |
| HTTPS: /client/v4/analytics/sql | Explicitly selected, or when the binding is unavailable or request-level options are needed | Configured account ID and API token; scope limited by that token's permissions; JSON responses |

The recorded recipe preserves SQL, parameters, request-level options, and the selected transport. HTTP capture resolves and records a default account scope when needed; binding scope is implicit in the deployed connection. A rerun retains the transport, though the operator can subsequently change that connection's configuration. There is no automatic transport fallback on failure.

Relative time expressions such as NOW() are allowed and kept verbatim. Absolute time parameters make a query easier to revisit, but upstream retention, sampling, late data, permissions, or changed connections can still affect a rerun. The archived result remains the record of what was seen.

Dataset and column discovery calls the SQL introspection endpoint. It currently needs the token connection even when queries use the binding. Discovery is a live catalog response; it is not automatically saved as evidence.

The PoC does not infer a line chart or heatmap mapping for arbitrary SQL rows. An agent can publish a transformation linked to the saved result, or create a custom view over it. More source adapters can use the same capture contract; arbitrary imports already cover tools without an adapter. See the [SQL integration guide](cloudflare-sql.md) for requests, limits, and configuration.

## 8. What is built and what comes next

| Area | Implemented today | Boundary still to address |
| --- | --- | --- |
| Agent integration | HTTP API, CLI, stdio MCP; agents choose their own tools | No hosted agent scheduler or harness-specific plugin |
| Evidence | Query/result capture, imports, citations, hashes, new revisions | No cryptographic source attestation or verified author identity |
| Collaboration | Live publication updates, presence, fixed forks, change cursors | No shared text editing or thread merges |
| Visualization | Standard charts/tables/JSON and isolated custom SVG | No general interactive custom app runtime or component registry |
| Source access | Cloudflare SQL and imports from any tool | Operator-wide SQL connection; no per-user OAuth or source permissions |
| Archive | SQLite index, R2 artifacts, JSON export | No configured backup/retention policy, deletion workflow, or self-contained interactive export |

The [widget and interaction design](widgets-and-interactions.md) adds requirements for rich tables, commit-linked code snippets and diffs, trace waterfalls, Markdown, and a durable selection-plus-question workflow back to the investigator's own agent. Those are planned additions. The current chart selection still supports query seeding and copying context only.

The local integration suite covers real workerd, SQLite Durable Objects, R2, Dynamic Workers, multiple browsers, and CLI/MCP clients. The 15 tests passed for the implementation documented here. SQL service responses and the native binding are stubbed in those tests; a live Cloudflare SQL account and hosted deployment have not been exercised in this environment.

### Gatekeepers: proposed source authorization boundary

Gatekeepers are a promising next integration, not part of the current request path. The sketch below describes a possible future boundary; all dashed connections are proposed.

~~~mermaid
flowchart LR
    accTitle: Proposed Gatekeeper integration, not implemented
    accDescr: External agents would continue using Fieldwork. Fieldwork would open a Gatekeeper session with verified user and observer authorization; the Gatekeeper would mediate source access. Fieldwork would still enforce access to its archived evidence.
    A["Existing agent clients"]
    F["Fieldwork<br/>API + archive access enforcement"]
    U["Verified users +<br/>observation authorizer"]
    G["Gatekeeper Worker<br/>typed source capability"]
    S["Provider data<br/>including a new SQL capability"]
    A -.-> F
    U -.->|"authorize sessions and sharing"| F
    F -.->|"service binding / RPC session"| G
    G -.->|"authorized source reads"| S
~~~

The reusable piece is the source capability and observation-authorization model. The inspected Cloudflare Gatekeeper still uses the older Workers telemetry API, so a unified SQL capability needs work. Its kit is also a private monorepo package, not a drop-in standalone dependency.

The substantial product question is **who may read archived evidence**. Today's room key grants full read/write access to the room and use of the operator's configured SQL connection. Gatekeepers would require verified users, connected accounts, and enforcement covering past and future observations, derived views, forks, exports, and revocation. Imported data collected outside Fieldwork also needs an explicit sharing policy.

For years-old artifacts, we must choose whether reading requires current upstream permissions or a separate archive entitlement. A source Gatekeeper alone does not settle that choice. The [reuse assessment](gatekeepers.md) explains the integration work.

### Scaling and retention

The PoC permits up to 1,000 artifacts per room, with a 1 MiB data limit per artifact. Native queries and custom rendering currently execute inside the room's mutation gate. That keeps publication ordering simple, but a slow source delays other mutations. A larger version should do bounded external work outside that gate, then serialize the final commit.

The browser currently fetches all missing room artifacts, even when another thread is selected. Larger rooms need pagination and selective loading. R2 history also needs deliberate retention, backup, and orphan cleanup policies. Built-in views depend on the application renderer version; only custom views have an archived SVG snapshot.

## 9. Where to read the code

| Start here | What it explains |
| --- | --- |
| [shared/model.ts](../src/shared/model.ts) | Artifact, branch, event, provenance, and drawing contracts |
| [server/index.ts](../src/server/index.ts) | HTTP routing, room authorization, SQLite/R2 publication, forks, reruns, and WebSockets |
| [server/cloudflare-sql.ts](../src/server/cloudflare-sql.ts) | SQL transport selection, capture, and dataset discovery |
| [server/renderers.ts](../src/server/renderers.ts) | Dynamic Worker isolation, drawing validation, and SVG serialization |
| [client/workspace.tsx](../src/client/workspace.tsx) | Human investigation workflow, refresh logic, inspector, and dialogs |
| [client/views.tsx](../src/client/views.tsx) | Standard visualizations and custom image display |
| [scripts/mcp.mjs](../scripts/mcp.mjs) / [fieldwork.mjs](../scripts/fieldwork.mjs) | Agent-facing tool and CLI interfaces over the same HTTP API |
| [wrangler.jsonc](../wrangler.jsonc) | Deployment resources and optional SQL binding |
| [tests](../tests) | Tested collaboration, publication, security boundaries, and SQL contracts |

The [API reference](architecture.md), [agent guide](agent-guide.md), and [related-tools assessment](landscape.md) go deeper. To regenerate the offline edition after editing this guide, see [documentation rendering](rendering.md).

For a product review, the useful questions are: does the saved artifact contain enough context for someone else to challenge the conclusion; does a fork give them enough context to continue; and can their agent produce a more useful view without gaining broader access? Those are the behaviors this PoC is meant to make concrete.
