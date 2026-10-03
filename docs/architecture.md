# Architecture and API

Fieldwork separates three things: collection with the investigator's tools, publication of durable evidence, and rendering that evidence. A native adapter is useful, but not a requirement for participation.

## Storage and collaboration

Each room is a SQLite-backed Durable Object. It stores room metadata, branches, evidence metadata, an ordered event log, and idempotency records. Full artifacts live in R2 under a room ID and a fresh artifact ID. An artifact includes its data, origin, actor label, timestamps, recipe or renderer code when available, parent IDs, and a SHA-256 of the JSON data.

Publication writes the R2 object first. It then commits metadata, the event, and the idempotency result in one SQLite transaction. A failure before that transaction may leave an unreferenced R2 object, but cannot expose metadata pointing at an unfinished upload. There is no orphan collector in this PoC.

Room mutations are serialized through a Durable Object input gate. Native source calls have a 15-second timeout; renderer requests have a 5-second timeout. This is deliberately simple for the PoC. Longer investigations and large concurrent rooms should execute external work outside the mutation gate and serialize only the final publication.

Hibernatable WebSockets broadcast invalidations, and clients fetch fresh room state. Reconnecting clients also reload state. Agents can page through the ordered change log, save its cursor, and resume after compaction. A branch records a fixed list of inherited artifact IDs. It does not copy or mutate the data, and subsequent parent-thread publications do not silently appear in the fork.

## Provenance

The server assigns the origin category; imports cannot claim to be native captures.

| Origin | Meaning |
| --- | --- |
| captured | The application ran the adapter and recorded its request and result together |
| imported | An investigator supplied the data and source description |
| derived | A saved custom renderer used explicit saved inputs |
| inference | An investigator's interpretation, optionally citing observations |

Neither an origin label nor a content hash guarantees that a conclusion is correct. A supported finding requires at least one citation, but the system does not verify its reasoning. Actor names and harness names are self-declared labels.

Reproducibility is optional. An imported recipe is inert text. Fieldwork never turns arbitrary imported instructions into a server command. Rerunning a native query or custom component creates a new artifact whose parents include the previous revision. Upstream results and nondeterministic component results may change without changing the old evidence.

## HTTP surface

Requests and responses use JSON. Room endpoints are relative to **/api/rooms/:roomId**. Supply **Authorization: Bearer ROOM_KEY**. Writes may supply **Idempotency-Key**, using 1–100 alphanumeric, underscore, or hyphen characters. Reusing a key with a different payload returns 409.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /api/rooms | Create a room; optional sample=true; hosted creation requires WORKSPACE_KEY |
| GET | /api/sources | List native adapters and connection availability |
| GET | /api/health | Runtime health |
| GET | / | Metadata, branches, evidence summaries, recent events, presence, cursor |
| GET | /changes?after=0 | Up to 200 ordered events, cursor, and hasMore |
| GET | /evidence/:id | Full saved artifact |
| POST | /query | Run demo-telemetry or cloudflare and capture a result |
| POST | /evidence | Import JSON from any source |
| POST | /findings | Publish an interpretation with status and cited parentIds |
| POST | /branches | Fork from fromBranchId, optionally through anchorId |
| POST | /components | Render saved inputIds using supplied JavaScript |
| POST | /evidence/:id/rerun | Append a new query or component revision |
| GET | /export | Room metadata plus all saved artifacts |
| GET | /live | WebSocket upgrade; protocols fieldwork and ROOM_KEY |

See the Zod schemas in src/shared/model.ts and the examples directory for exact request shapes. Branch IDs default to main. Artifacts and citations are scoped to their room; branches are organizational boundaries, not access boundaries.

Invite links put the room key in the URL fragment. The client removes it from the address bar after saving it in session storage. HTTP requests use a bearer header; WebSocket requests use the second offered subprotocol, avoiding credentials in request URLs. Only the key hash is retained in room metadata. Logs, exports, and evidence must not contain credentials.

## Standard components

The host renders line charts and heatmaps with ECharts, plus tables and JSON. Malformed chart input falls back to inspectable JSON. Timestamps use Unix milliseconds; chart labels use UTC. Drag selections become a structured time window with the source artifact ID, ready for another query or an external agent.

Line chart data:

    {
      "unit": "ms",
      "series": [
        { "name": "eu-west", "points": [[1791021600000, 110], [1791021660000, 125]] }
      ]
    }

Missing observations may use null values. Each series can have different timestamps; the chart aligns their union without inventing measurements.

Heatmap data:

    {
      "unit": "requests / latency bucket (ms)",
      "times": [1791021600000, 1791021660000],
      "buckets": ["0–100", "100–200"],
      "cells": [[0, 0, 42], [0, 1, 12], [1, 0, 33], [1, 1, 20]]
    }

Cells are [timeIndex, bucketIndex, count]. Tables accept an array of records. The UI limits previews; the complete saved artifact remains downloadable.

## Custom components and Cloudflare OS

The borrowed ideal is a small, accountable core with explicitly limited extension capabilities. This PoC does not embed Cloudflare OS or require its agent harness.

An agent publishes a JavaScript function expression plus up to eight input artifact IDs. The host loads exactly those archived inputs and passes them as an array of complete artifacts to a Dynamic Worker. The worker receives no bindings or credentials, has globalOutbound=null, a zero-subrequest limit, and a 50 ms CPU limit.

The function returns a declarative drawing:

    (inputs) => ({
      tag: "svg",
      attrs: { viewBox: "0 0 640 160" },
      children: [{
        tag: "text",
        attrs: { x: 20, y: 60, fill: "#98d7b9", "font-size": 24 },
        text: String(inputs[0].data.length) + " saved observations"
      }]
    })

The host bounds output to 256 KiB, 2,000 nodes, and depth 24. A server-owned schema allows drawing primitives and text, with a narrow attribute list. It rejects scripts, event handlers, raw HTML, styles, links, external resource references, and foreignObject. The host escapes XML, saves both the drawing and SVG snapshot, and displays the SVG as an image. Agent code never runs in the workspace browser.

This allows arbitrary JavaScript computation over captured evidence, including nondeterministic computation. It does not provide custom interactive browser apps. The saved output is always the record; rendering again creates a new revision. A future extension model can add audited capabilities, typed interaction events, and shareable component packages without handing extensions ambient access to sources or room credentials.

## Operational boundaries

The workspace creation key protects hosted provisioning; each room has a separate bearer capability. All room-key holders can read and edit every thread and use any operator-configured source adapter. There is no per-user source authorization, rate limiting, revocation, or data redaction layer yet.

Archive data is durable independently of chat history and source retention. It is not an automatic compliance archive: configure backups, lifecycle rules, retention controls, budgets, and operational ownership before using it as an organizational record.
