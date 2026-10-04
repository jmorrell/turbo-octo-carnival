# Built-in widgets and questions back to an agent

Design requirements recorded on 3 October 2026. These are the next product capabilities, not features already implemented by the PoC.

Fieldwork's standard widgets should be useful tools for investigation in their own right. Every widget should expose the data behind its view and allow a person to select something meaningful, ask a question about it, and send that question to their own agent.

## The standard widget set

| Widget | Required behavior | Selection passed to an agent |
| --- | --- | --- |
| Tables | Typed sorting, filters, column resizing and visibility, sticky/pinned columns, keyboard navigation, row/cell selection, copying and export; virtualization or pagination instead of a silently truncated preview | Stable references to rows/cells in the saved result, selected columns, and relevant filters/sort order |
| Source code | Syntax highlighting, original line numbers, a single snippet or a collection across files; exact commit-and-line permalinks; saved snippet text remains readable independently of the repository | Snippet IDs, repository, full commit ID, file paths, and original source line ranges |
| Code diffs | Unified and side-by-side views, syntax and intra-line highlighting, multi-file navigation, expandable saved context, whitespace controls, and explicit additions/deletions/renames; pinned base/head revisions | Diff artifact, file change and hunk IDs, selected side, and original old/new line ranges with their revision references |
| Trace waterfalls | Parent/child hierarchy, service identity, timing bars, zoom, expand/collapse, errors, events and attributes; selection of spans or an interval | Trace and span IDs, selected interval, and the artifact containing the trace |
| Markdown | Rendered notes and findings, headings, lists, tables, fenced code, and clickable evidence citations | Artifact and citation references, plus a selected excerpt when useful |
| Line charts and heatmaps | Existing charts, extended from a time selection to semantic region selection | Time interval, selected series or buckets, value bounds and units where relevant |

These should be host-owned components with documented data contracts, available to humans and any agent harness. Custom components remain an escape hatch for views that do not fit them.

### What “really good tables” means

Sorting and filtering must preserve identity. A selected row means the same original row after reordering, pagination, or reconnecting. Duplicate values and duplicate business keys must not collapse distinct observations.

If the source supplies a trustworthy unique row key, retain it. Otherwise, an immutable artifact ID, the path to its row array, and its original row ordinal provide an unambiguous reference. The displayed row number after sorting is insufficient. Selection must distinguish “these rows” from “all rows matching this filter.”

Numeric columns sort numerically; null, missing, and empty values remain distinguishable. Long values and nested JSON need an inspectable cell view. The UI should show how many rows are saved, filtered, and selected, and clearly distinguish a preview from the full captured result. Export should offer an explicit choice of selected, filtered, or all saved rows.

Large-result loading is separate work: a polished grid does not remove the current 1 MiB artifact limit.

### Source code is durable evidence

Each snippet needs its own repository, full commit ID, path, inclusive start/end lines, language when known, and saved text. A collection can span several files or repositories; it must not assume every snippet belongs to the same commit.

For GitHub, the permalink has the shape:

    https://github.com/OWNER/REPO/blob/FULL_COMMIT_ID/path/to/file.ts#L42-L67

Use the commit ID, not a moving branch name. Preserve original line numbers when displaying an excerpt, and include source lines even if the upstream repository later becomes inaccessible. A link supplied by an agent remains an attributed claim unless a source capture actually checked the content at that revision.

Code is displayed as text. Markdown uses a restricted renderer with raw HTML disabled, safe link handling, and no automatic external embeds. Both use host-controlled rendering rather than giving a note or snippet browser execution privileges.

### Code diffs connect changes to observed behavior

Diffs are a first-class built-in widget, usable both in the shared workspace and an MCP App. An investigator should be able to move from a latency regression to its deployment, inspect the relevant changes across files, and ask an agent about a particular hunk.

The review experience needs unified and side-by-side layouts, syntax highlighting, intra-line changes, file navigation with change counts, folding and expansion of captured context, keyboard navigation, and selection across lines or hunks. Whitespace controls change the presentation while preserving the saved comparison. Renames, added/deleted files, binary changes, and file-mode changes need explicit treatment.

Each comparison records the repository, exact base and head commit IDs when available, old/new paths, and comparison semantics. A direct comparison between deployed commits must be distinguishable from a merge-base comparison. Source links point to the corresponding revision and original line on each side, including deleted lines on the base revision.

Archive the patch and captured before/after text, with content hashes and clear coverage. Expanding context should use the saved snapshot. If only a partial patch was captured, show that limit; fetching more content is a new capture with its own provenance. Retrospectives must not depend on an old pull request or a moving branch still being available.

Uncommitted agent work is valid evidence too. Record its known base, captured working-tree content or patch, and hashes, labeling the uncommitted snapshot honestly. Do not require or invent a head commit to display it.

Diff selections identify the artifact, file change, hunk, side, and original old/new line ranges. Switching layouts, hiding whitespace, or collapsing context must not change which code a question references. For example: **“Could this added retry loop explain the latency band?”** should carry the selected change, both captured versions, and links to the relevant telemetry artifacts.

### Trace data stays queryable

A waterfall should preserve the underlying span records: trace ID, span ID, parent span ID, service, operation, timestamps, duration, status, attributes, events, and links when supplied. Explicit time units are required. Normalization must retain a link to the original saved source output.

Missing parents, incomplete traces, and clock skew need visible treatment. Do not silently move spans to invent a clean hierarchy or a causal ordering the data does not establish. A selected span should be fetchable by the next investigator without reconstructing its position on screen.

### Notes and findings use the same Markdown renderer

Freeform notes can explain a plan, methodology, or an observation. Findings retain their status and explicit evidence citations alongside rendered prose. Rendering Markdown does not make a note's factual claims into a captured observation.

## One interaction contract across widgets

The intended flow is:

1. Select a region, rows, source lines, diff lines/hunks, or trace spans.
2. Choose **Ask agent**, type a question, and choose the connected agent session or leave it queued.
3. Save the question and frozen selection in the room before attempting delivery.
4. Deliver a compact reference and context to the chosen harness.
5. Let that agent fetch the saved inputs, use its existing tools, and publish a response or finding into the room.

The agent should receive “these exact observations, in this view, with this question.” Pixel coordinates or a screenshot alone lose too much meaning.

The saved interaction should include:

| Field | Purpose |
| --- | --- |
| Request ID, actor and creation time | Identify the human's question and deduplicate delivery |
| Room and branch IDs | Preserve investigative context |
| Target session reference | Route to the selected agent session; a display name alone is not a routing identity |
| Question text | Keep the person's instruction distinct from data being inspected |
| Artifact IDs and hashes | Identify the exact saved inputs |
| Typed selection | Rows/cells, time/value ranges, series/buckets, code lines, diff sides/lines/hunks, or trace spans |
| View version and relevant view state | Preserve transformations, filters, grouping, and sorting that affected what the person saw |
| Delivery and response references | Show whether the request is queued, accepted, answered, failed, or cancelled, and link the resulting artifacts |

For example, this illustrates the proposed semantics for a table selection. It is not an existing API payload:

~~~json
{
  "question": "What are these outliers?",
  "roomId": "investigation-id",
  "branchId": "retry-policy-thread",
  "targetSessionId": "connected-agent-session-id",
  "selection": {
    "kind": "table-rows",
    "artifactId": "saved-sql-result-id",
    "dataPath": ["data"],
    "originalRowIndices": [14, 287],
    "columns": ["service", "duration_ms", "trace_id"]
  },
  "viewState": {
    "sort": [{ "column": "duration_ms", "direction": "descending" }],
    "filters": []
  }
}
~~~

The server should validate these references against the archived artifact and attach the recorded hash. Sorting changes the displayed order, not those original indices. An agent can fetch the full result, original SQL, and parameters through the artifact reference; the initial message needs only a bounded preview and the references.

For a heatmap box, retain both the time range and the selected latency buckets. For a line chart, retain the selected series and any value bounds. The current time-only brush is not enough to express every “this spike” or “these outliers” question.

Hovering and selection can update local view context. Sending a question is an explicit user action; moving a pointer should not continually start agent turns.

## What MCP does and does not supply

Core MCP carries tools, resources, and notifications, but it does not define a universal “append this human message to the active agent session and start a turn” operation.

Resource update notifications can tell a subscribed client that an inbox changed. The host still decides whether to fetch it, show it, update model context, or start work. Logging notifications are logs, not a user-message channel.

There are two useful delivery integrations:

| Where the interaction happens | Mechanism | Remaining host responsibility |
| --- | --- | --- |
| Fieldwork view embedded as an MCP App | App-to-host **ui/update-model-context** for selection context; **ui/message** for the explicit question | Support the extension, accept the message, and decide how to run or queue the next turn |
| Standalone Fieldwork workspace | Persist the request in the room; an authorized harness adapter watches the inbox and invokes its host's session/message API | Select the correct session, apply that harness's queue/steering rules, and acknowledge acceptance |

MCP Apps' message channel belongs to the embedded app/host connection. Adding an MCP server to a harness does not give an unrelated browser tab that connection. We can add an embedded companion view in supporting hosts while keeping the durable standalone workspace.

The App context update is replaceable context for future turns; it is not a durable question log. Include the question's frozen selection or its saved request reference in the message too, so a later selection cannot change what “these” meant. Capability support and actual follow-up behavior need testing per host.

### Sampling is not the session-delivery mechanism

Sampling requests an LLM generation through the MCP client. It does not promise delivery to the user's existing conversation, tools, or active agent loop. The current core specification, 2026-07-28, also deprecates sampling and advises new implementations not to adopt it.

Fieldwork should continue to use the investigator's own agent session. Neither the question queue nor a widget needs to become another hosted model runtime.

### Protocol version matters

The repository currently pins MCP SDK 1.32.0, whose supported versions top out at 2025-11-25. It exposes tool calls over stdio. It does not currently expose a request inbox, resource subscriptions, an MCP App, or a session-delivery adapter.

The newer 2026-07-28 core spec uses **subscriptions/listen** for resource notifications. Older versions use their own subscription contract. Implement the negotiated protocol for the actual client; do not add newer methods to the existing stdio server and assume every harness understands them.

This version difference does not change the product contract: questions and selections live in Fieldwork, while delivery is a negotiated capability of the host integration.

## Proposed Cloudflare implementation

~~~mermaid
flowchart LR
    accTitle: Proposed durable selection-to-agent workflow
    accDescr: A user submits a question with a semantic selection. The room Durable Object stores it before a harness adapter delivers it to the chosen agent. The agent fetches saved evidence and publishes an answer back into the room.
    UI["Widget selection<br/>+ human question"]
    DO["Room Durable Object<br/>durable request + event"]
    Bridge["Harness adapter<br/>authenticated outbound connection"]
    Agent["Chosen agent session<br/>its own tools and model"]
    Evidence["Saved response<br/>evidence + finding"]
    UI -->|"submit"| DO
    DO -->|"watch / resume by cursor"| Bridge
    Bridge -->|"host session API"| Agent
    Agent -->|"publish with request reference"| Evidence
    Evidence -->|"room update"| UI
    Agent -.->|"fetch selected artifacts"| DO
~~~

The diagram is a proposal. The existing Worker, room Durable Object, SQLite event log, and R2 artifact store supply much of the foundation.

Add immutable request bodies and append delivery/status events. Keep large original outputs in the existing artifact store. A harness adapter on the investigator's machine, or beside their cloud agent, initiates an authenticated outbound connection; the browser need not reach localhost or expose a local agent to the Internet.

A bridge needs an explicit registration for its session and capabilities. Receiving a room event is not proof the agent accepted the prompt. The UI should distinguish queued, accepted, and answered states. An offline agent's request remains queued.

Expect reconnects and retries. Use request IDs and acknowledgments, with deduplication in the adapter and the host API where available. If a crash occurs after the host accepted a prompt but before the acknowledgment was saved, resolve or expose the uncertain delivery instead of promising exactly-once execution.

When a harness cannot accept pushed turns, provide an inbox tool or CLI command the agent can read, plus a copyable prompt as fallback. A long-poll tool can wait while an agent has explicitly called it; it does not wake an exited harness.

Shared-room presence is separate from permission to steer an agent session. A connection should specify who can direct questions to it. Requests must stay within the room/source access the recipient is authorized to see, including the future Gatekeeper boundary. Credentials and room keys belong in connection configuration, never in saved question text or links.

## Suggested implementation sequence

1. Define shared widget and semantic-selection contracts; build the tables, Markdown, source-code, diff, and trace views on them.
2. Add the durable **Ask agent** request flow and an inspectable pending-request inbox, with explicit targeting and response links.
3. Implement and verify one host adapter end to end: select, ask, deliver to an existing session, inspect evidence, publish a response.
4. Add other harness adapters and an MCP Apps companion where supported, keeping the same saved request contract.

Acceptance should include an agent going offline, duplicate delivery, reconnecting after compaction, selecting rows after sorting, selecting deleted lines or a renamed file in a diff, changing diff layouts after selection, changing the selection after asking, and two investigators using different harnesses. Success is the agent answering the intended question about the intended saved data, with a response the whole room can inspect.

## Sources

- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps 2026-01-26 specification: app-to-host requests](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#requests-view--host)
- [MCP 2026-07-28 resource subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/server/resources#subscriptions)
- [MCP 2026-07-28 subscription streams](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
- [MCP 2026-07-28 sampling and deprecation notice](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling)
- Current implementation: [widgets](../src/client/views.tsx), [MCP tools](../scripts/mcp.mjs), and [shared contracts](../src/shared/model.ts)
