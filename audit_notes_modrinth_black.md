# Modrinth.black transport audit — 2026-08-19

The public landing page claims that it uses the official Modrinth API and that files are downloaded from the official Modrinth CDN. In this environment, the candidate API routes `/api/v2/search`, `/v2/search`, and `/api/search` were unavailable: one request timed out and the others returned a 403 HTML interstitial from mitelis.net rather than JSON. The browser was also held on the mitelis.net "please wait" interstitial and did not expose a launcher-consumable API contract.

Implementation implication: do not replace the existing validated Modrinth API path with `https://modrinth.black` until the service publishes a documented, machine-readable API/download endpoint or the user supplies the provider's contract. The launcher may expose the site only as an optional external discovery link; it must retain health-check, cache, and explicit unavailable state for API transport.
