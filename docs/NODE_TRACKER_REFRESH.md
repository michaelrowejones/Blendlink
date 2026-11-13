# Node tracker refresh

Primary new-port qualification targets Blender **5.3.0**, with EEVEE as the live
shading reference and separate compositor CPU/GPU contracts. Existing 4.2/5.2
coverage remains historical evidence and compatibility behavior remains intact.
Do not require a new port to support older versions before admitting its measured
5.3 slice. Run legacy regression checks when shared implementation changes.

The native Google Sheet is:
https://docs.google.com/spreadsheets/d/1ISVg8n0WB60MtVdFkBPeBHRRfCPFylXer0cvwM9cwqk/edit

The daily Codex chat automation `refresh-blendlink-node-coverage` runs at 9 a.m.
in the user's local schedule. It uses the connected Google Drive account and
requires this computer/project and the desktop app to be available. No service
account secret, public sharing or Google credentials are stored in the repository.

## Refresh transaction

1. Run the core-only `scripts/export-node-tracker.mjs` exporter from the current
   reviewed checkout into a fresh private output. Its input is the audited
   coverage and capability map, not experimental receipts or class-name guesses.
2. Validate source digests, category counts, duplicate keys and capability-map
   agreement. A changed source fingerprint must remain visible and cannot
   establish that a fresh numerical audit ran. Never overwrite good coverage
   with incomplete extraction or invalid data.
3. Read spreadsheet metadata and bounded current cells with the Google Sheets
   skill. Resolve actual sheet/table IDs. Match rows by **context + native node
   ID**, resolving the Context and Native node ID headers; never match by row
   position, fixed column index or display name.
4. Update source-owned fields only. Preserve manual priority overrides and user
   notes. Identify source-owned node/context/version coverage, remaining work,
   limits, evidence and research columns by header. Suggested priority, Priority
   reason, Dependencies and Usage basis are source-owned. Priority override and
   User notes are manual. Effective priority calculates the override when present,
   otherwise the recommendation. Preserve formulas, dropdowns, notes,
   formatting, frozen panes and table coverage. Use the native row insertion
   workflow for new keys; retain removed keys as historical rather than deleting
   manual annotations. Stop and report duplicate or ambiguous existing keys.
5. Refresh version-detail source rows and summary formulas. Keep the 5.3
   denominator separate from legacy-only entries. Keep research, structural
   handling, baked appearance and live support distinct. Apply no support
   promotion from priority, native availability or a successful process exit.
6. Verify refreshed keys/counts, table extents, representative notes and formula
   results. Record last successful refresh, actual audit generation timestamp,
   source commit and source-fingerprint warnings separately. Mark success only
   after read-back verification. On authentication or extraction failure leave
   coverage intact and report the failed refresh.

Use `source.nativeInventoryAuditGeneratedAt` for the native inventory date and
`source.coverageGeneratedAt` for the classification report date. A
`retained-reviewed-native-catalogs` refresh reclassifies existing inventories
against reviewed port evidence; it does not rediscover nodes or enum states.
Display that distinction whenever `source.nativeInventoryRefreshed` is false.

## Work ordering

Prioritize reusable enabling work first, then common artist workflows, then
remaining completion and specialist features. Dependencies and likely artist
usage are separate fields. Frequency expectations are engineering estimates;
observations from the small official-demo corpus are explicitly labeled and
do not establish population-wide popularity. Completed declared scopes remain
maintenance work; new input domains can reopen a work item.

After each port, review its native/browser correctness, performance and actual
scene evidence, update the audited capability map, then run a refresh. The daily
schedule is a fallback for keeping the report current, not a replacement for
that review or a guarantee that an unavailable computer can execute updates.
