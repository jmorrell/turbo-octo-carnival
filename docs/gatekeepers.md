# Reusing Cloudflare OS Gatekeepers

Assessment based on Cloudflare OS commit 5cae880e5e54563895a067e7f4dae67514e581be, inspected on 3 October 2026. This is a proposed next integration, not a claim that the current PoC enforces Gatekeeper permissions.

## Fit

Gatekeepers are a good match for Fieldwork's source-access boundary. The canonical interface describes independently deployed Workers connected through service bindings and JavaScript RPC. A Gatekeeper exposes a typed capability for a particular resource. Credentials and provider-specific policy stay behind that capability.

The host creates a session with an observation/action authorizer. Reads must be authorized before data is returned; writes use a separate approval path. External agents do not need to use Cloudflare OS's agent harness: Fieldwork can remain their HTTP/MCP endpoint while its server talks to the Gatekeeper.

This is more than credential storage. The observer contract is relevant to saved evidence: before a collaborator opens data, the Gatekeeper checks that their own connected account can observe everything already read through that capability. Future observations must respect the admitted collaborators' access. The host has to enforce that decision across every way it serves data.

## What is reusable today

| Layer | Existing implementation | Work for Fieldwork |
| --- | --- | --- |
| Canonical Gatekeeper interfaces | Resource descriptions, typed sessions, user verifiers, observation authorization | Implement the host side around source queries and evidence publication |
| Gatekeeper kit | Independent modules for connection handshakes, credentials, observers, cursors, bounded responses, and caching | Integrate selected modules and their storage/lifetime contracts |
| Deployed provider Gatekeepers | Separate Workers and Durable Objects, including a read-only Cloudflare observability Gatekeeper | Configure service bindings and connect-account lifecycle; adapt the requested source surface |
| Observer enforcement | Source-specific admission and per-read checks plus Workshop enforcement | Add verified users and source accounts, authorize room opens, and handle revocation and future excluded observations |

The kit explicitly ships independent leaf modules. Its proposed base-class assembly layer is not shipped. The package is private in the monorepo and depends on workshop-shared and observability packages, so adoption needs a pinned source dependency or an upstream extraction; it is not currently a standalone npm installation.

The inspected Cloudflare Gatekeeper exposes Workers Observability through the older telemetry API. A unified SQL capability still needs implementation, appropriate grants, and observer checks for the datasets and fields it can read. Wrapping arbitrary SQL in the existing Worker-scoped capability would not establish the same scope guarantee.

## Suggested integration

Start with a small read-only spike:

1. Deploy one Cloudflare Gatekeeper and connect it to Fieldwork through a service binding.
2. Implement the connect callback and handoff lifecycle for a verified Fieldwork user, persisting the connection capability separately from evidence.
3. Add a SQL session capability and an observation authorizer around query and schema-discovery reads. Refuse unsupported write actions.
4. Publish authorized results using Fieldwork's existing immutable artifact path, retaining the query and source capability reference.
5. Keep the current CLI and MCP protocol so Codex, pi, and OpenCode remain external clients.

This is a bounded architectural spike. Making the full multiplayer sharing guarantees work is a larger change: current room invite keys grant complete room access, and actor names are self-declared. Those are insufficient for source-level observer verification.

The next stage needs verified identity, per-user connected accounts, admission checks on saved data, and consistent enforcement across artifact reads, exports, event streams, rendering inputs, and forks. Admission should cover past observations; future publication must account for every authorized collaborator, including people currently offline. Revocation cannot be handled only by hiding a button.

## Imported and derived evidence

An arbitrary agent can collect data with tools outside Fieldwork. Gatekeepers cannot retroactively verify that an imported output came through their capability or that its supplied origin is accurate. Imported evidence should keep its honest origin label and follow an explicit workspace sharing policy.

For derived views, source restrictions must follow all parent inputs. A custom component cannot widen access by transforming restricted evidence into a chart. This applies to exports and forks too.

Long-lived records also need an explicit access policy: should opening an old artifact require current source access, or an independently granted archive entitlement? Cloudflare OS's observer model provides a strong starting point, but the archive's policy is a product decision, not something the presence of a Gatekeeper automatically settles.

## Sources

- [Canonical Gatekeeper interfaces](https://github.com/cloudflare/cloudflare-os/blob/main/packages/workshop-shared/src/gatekeeper.ts)
- [Gatekeeper kit: shipped scope and responsibility boundaries](https://github.com/cloudflare/cloudflare-os/tree/main/packages/gatekeeper-kit)
- [Cloudflare Gatekeeper](https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-cloudflare/src/cloudflare.ts)
- [Cloudflare source API](https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-cloudflare/src/observability-api.ts)
- [Observer module](https://github.com/cloudflare/cloudflare-os/blob/main/packages/gatekeeper-kit/src/observers.ts)
- [Observer enforcement design and known gaps](https://github.com/cloudflare/cloudflare-os/blob/main/docs/observers.md)
