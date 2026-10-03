# Working in a Fieldwork investigation

You remain the investigator. Fieldwork is the shared record and visual surface, not a replacement for your harness or existing tools.

1. Read the room state. Identify the active question, threads, findings, and relevant saved artifacts.
2. Fetch the artifacts you need, including their original data and provenance.
3. Use any available tool to investigate. Use a native adapter when convenient, or publish outputs from your existing tools.
4. Save useful evidence with an informative title, the actual output, known source details, and parent IDs connecting it to the investigation. Include a query, script, or explanation of collection when possible.
5. Publish conclusions separately as findings. Cite evidence IDs, state uncertainty, and distinguish observation from inference.
6. Fork when pursuing another lead. Read changes periodically to find colleagues' work and avoid repeating it.

No recipe or deterministic replay is required. A useful observation with an incomplete origin is preferable to excluding an entire class of investigation. Report what is known; do not invent a query or imply an imported result was captured by Fieldwork.

## Import from any source

For example, save this as evidence.json and run **npm run --silent agent -- publish --file evidence.json**:

    {
      "title": "Retry waits dominate this sampled request",
      "description": "One sampled trace; test against a larger population before generalizing.",
      "source": {
        "name": "Existing trace-analysis script",
        "uri": "https://example.com/internal/investigations/trace-123",
        "collectedAt": "2026-10-03T11:08:00Z"
      },
      "data": [
        { "stage": "work", "duration_ms": 108 },
        { "stage": "backoff", "duration_ms": 200 }
      ],
      "recipe": "Run the existing trace-analysis script against trace-123. Access requires the investigator's own source credentials.",
      "view": "table",
      "parentIds": []
    }

The source URI is a reference, not something Fieldwork fetches. Recipes remain inert text. Do not include credentials, room invite keys, or unrelated sensitive data in the saved output.

## Extend the view

Prefer the standard line, heatmap, table, or JSON components when they fit. For a custom view, collect data with your own tools first and publish it. Then submit a renderer function and the IDs of its saved inputs.

The renderer receives complete artifacts, so input data is available at inputs[0].data. It runs in a Dynamic Worker with no outbound network access or source credentials. Return a validated SVG drawing, not HTML or a browser application. See examples/render.js and the [component contract](architecture.md#custom-components-and-cloudflare-os).

## Resume after compaction

Save the room ID, branch ID, and last processed change cursor in your own session context. Keep the key in configuration, separate from evidence.

Use get_investigation or the CLI's state command to recover context. Use get_changes or changes --after CURSOR to catch up; keep paging while hasMore is true. Fetch full artifacts only where needed. The room should be enough to reconstruct the investigation without reconstructing somebody else's chat.
