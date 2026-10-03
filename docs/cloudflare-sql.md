# Cloudflare unified SQL integration

Fieldwork's cloudflare source targets the unified Analytics SQL API announced on 2 October 2026. It no longer sends structured queries to the Workers-only telemetry endpoint.

Previously archived structured-telemetry results remain readable. Their old request bodies are not silently converted: publish a SQL query to create a new capture.

## Publish a SQL result

Use the SQL editor, the CLI's query command, or MCP's run_query tool:

    {
      "title": "HTTP requests by response status",
      "source": "cloudflare",
      "query": {
        "query": "SELECT edgeResponseStatus AS status, COUNT(*) AS requests FROM events.httpRequests WHERE timestamp >= $start AND timestamp <= $end GROUP BY edgeResponseStatus ORDER BY requests DESC LIMIT 20",
        "params": {
          "start": "2026-10-03T10:00:00Z",
          "end": "2026-10-03T11:00:00Z"
        }
      },
      "view": "table"
    }

Choose dates inside your account's retention period. Parameters support named objects or positional arrays of strings, finite numbers, booleans, and null. They are passed separately from SQL, never interpolated.

The service accepts one SELECT statement over a schema-qualified dataset and requires a lower time bound. It enforces the supported SQL dialect and dataset/field permissions. Fieldwork does not try to parse or rewrite the SQL. Relative expressions such as NOW() are allowed; the exact text, parameters, capture time, and result remain saved even when a later execution would use a different time window.

## Connections

| Connection | Setup | Scope and limitations |
| --- | --- | --- |
| Workers binding | Enable analytics.binding = ANALYTICS_SQL in Wrangler | Account owning the deployed Worker; SQL and params only; default JSON; currently no Log Explorer datasets |
| SQL endpoint | CF_OBSERVABILITY_ACCOUNT_ID and CF_OBSERVABILITY_API_TOKEN | Default configured account; explicit account/zone scope permitted within the token's authorization; supports request time ranges, Log Explorer, and FORMAT JSON |

The binding is used directly through env.ANALYTICS_SQL.query(). The token path POSTs to **https://api.cloudflare.com/client/v4/analytics/sql**. Neither path uses the old Workers telemetry endpoint or its dry flag.

By default, plain SQL uses the binding when available. Requests with scope or time_range use the token connection. Set the outer transport property to binding or http to choose explicitly. Failures do not silently fall back to another connection, and reruns keep the connection recorded by the original capture. The binding is optional so the synthetic PoC still runs without Cloudflare connectivity.

Both connections supply account scope outside SQL. Do not add accountTag or zoneTag predicates to SQL. On the token path, an explicit request scope may replace the default:

    {
      "scope": { "zoneTag": "32-character-lowercase-hex-zone-id" }
    }

Only one of accountTag and zoneTag is accepted, with a real 32-character lowercase hexadecimal ID. The binding does not accept scope overrides.

To use the HTTP API's request-level time range, remove timestamp predicates from SQL and add:

    {
      "time_range": {
        "start": "2026-10-03T10:00:00Z",
        "end": "2026-10-03T11:00:00Z"
      }
    }

The end is optional and both bounds are inclusive. Native binding queries require time predicates in SQL instead. Fieldwork preserves this request exactly in the recipe, including the default HTTP account scope it resolved.

## Discover the schema

Use the query editor's catalog browser, the CLI, or MCP's list_cloudflare_datasets:

    npm run --silent agent -- datasets
    npm run --silent agent -- datasets events.httpRequests
    npm run --silent agent -- datasets logs.workersLogs --custom-attributes

The authenticated room route proxies **GET /analytics/sql/introspection** using the configured account and API token. The native binding currently has no discovery method. Without token configuration, use your own cf CLI or Cloudflare Observability MCP server to inspect the schema and supply SQL to Fieldwork.

The catalog is dynamic; sample dataset names are examples, not an allowlist. Responses preserve dataset kinds, sampling, columns, availability, and any custom attributes. Custom-attribute discovery reads the preceding seven days and may silently truncate. Catalog presence does not guarantee that the token can query every field.

## Evidence and rendering

The artifact contains the complete JSON result: data, rows, statistics when returned, and any extra metadata such as the typed meta from FORMAT JSON. Log Explorer results without statistics are accepted over HTTP. Tables display data without removing the envelope from storage, hashes, inspectors, or exports.

Use the default JSON output, or FORMAT JSON over HTTP. NDJSON and TSV are not accepted by this capture adapter; they can still be collected externally and published as imported evidence. Agents can build custom views over the saved result at inputs[0].data.data, or publish a chart-shaped transformation linked to the result.

Source errors preserve the documented SQL error description and Retry-After when supplied. Binding errors indicate retryability. There are no implicit retries; results remain bounded to 1 MiB and calls to 15 seconds. A binding timeout stops waiting, but the binding exposes no cancellation method.

## Verification and references

Tests check both connection contracts, parameter preservation, scope selection, full result retention, Log Explorer response shape, catalog discovery, failures, browser SQL editing, and table rendering. Upstream connections are stubbed in these tests. A live account check still requires credentials or an enabled binding.

- [Release announcement](https://blog.cloudflare.com/one-observability-platform/)
- [SQL request and response contract](https://developers.cloudflare.com/analytics/sql-api/query-api/)
- [Dataset introspection](https://developers.cloudflare.com/analytics/sql-api/datasets/)
- [Workers binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/)
- [Permissions and first query](https://developers.cloudflare.com/analytics/sql-api/get-started/)
- [SQL errors](https://developers.cloudflare.com/analytics/sql-api/errors/)
