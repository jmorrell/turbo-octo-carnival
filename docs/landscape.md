# Related tools and the product hypothesis

Research checked on 3 October 2026. These are the closest documented overlaps, not an exhaustive claim that nobody else is building this.

## Honeycomb Canvas

[Canvas](https://docs.honeycomb.io/investigate/canvas) is already a collaborative investigation workspace with visible queries, persistent workspaces, team chat, and connectors. It is the closest observability comparison, not merely a dashboard with an assistant added.

External agents can participate through [Honeycomb MCP](https://docs.honeycomb.io/integrations/mcp/tools). The documented Canvas tools send a message to the Canvas agent and poll its response. That differs from giving an arbitrary external agent a direct artifact-publication protocol and an extensible rendering surface. Canvas's documentation also says results are limited by the account's data retention policy; that statement alone does not establish the retention behavior of every saved workspace artifact.

## Grafana Assistant Investigations

[Investigations](https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/platform/investigation/) provide persistent investigative context, access scopes, and snapshot share links. They overlap strongly with keeping findings and investigation context outside an ephemeral chat. This is a reason to test the concrete contribution and continuation workflow, rather than assume that persistence alone differentiates a new product.

## Deepnote

[Deepnote MCP](https://deepnote.com/docs/deepnote-mcp) allows external harnesses to read, create, edit, and run notebooks using existing permissions. [Run snapshots](https://deepnote.com/docs/run-snapshots) preserve immutable notebook state and outputs, with retention dependent on the workspace tier. This is a strong adjacent precedent for agent-accessible collaborative computation and durable results, beyond the observability category.

## Cloudflare OS

[Cloudflare OS](https://github.com/cloudflare/cloudflare-os) contributes a different set of ideas: agent-built gadgets, isolated execution, capability-based access through Gatekeepers, and shareable blueprints. Its [blueprint model](https://github.com/cloudflare/cloudflare-os/blob/5cae880e5e54563895a067e7f4dae67514e581be/docs/blueprints.md) separates reusable code from chat history, storage, and credentials.

Fieldwork borrows the principle of a controlled extension boundary. It does not implement Cloudflare OS's observer permissions, gatekeeper framework, or full interactive gadget runtime. Its smaller initial contract is explicit saved inputs plus a network-disabled renderer that returns a validated drawing.

## What this PoC tests

The product hypothesis is that the shared object should be an investigation's evidence and evolving conclusions, accessible to whichever humans and agents are doing the work. The application owns publication, durable storage, provenance, collaboration, and presentation. The investigator keeps control of tools, harness, and investigative strategy.

Useful questions for the next trial:

- Can two engineers using different harnesses join an investigation, understand the evidence, and follow separate leads without forwarding their chats?
- Do preserved results and honest provenance help someone assess a finding after upstream telemetry has expired?
- Does an agent-authored view make a relationship visible that the standard charts hide?
- Can structured human selections become useful agent context without requiring another long explanation?
- Does a small extension contract cover enough useful views, or does the next iteration need interactive gadgets and explicit capabilities?

Reproducibility is a useful property of some evidence, not the admission rule. That follows the broader argument in [Extensible Software in the Age of LLMs](https://jeremymorrell.dev/blog/extensible-software-in-the-age-of-llms/): provide a reliable shared core and let agents adapt the software around the task.
