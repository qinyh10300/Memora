# Memora privacy and authorization boundary review v1

Date: 2026-08-07

Scope: identity, workspace membership, memory visibility, retrieval, protected assets,
document chunks and citations, Agent tools and executions, logs, metrics and external
observability events.

Result: PASS. No path was found that exposes another user's private record, asset,
document chunk, prompt or citation. The review was performed against server-side query
construction and mutation authorization, not against UI visibility alone.

## Invariants reviewed

1. The current principal is derived from an active, unexpired, non-revoked session and an
   active membership in the exact active workspace.
2. Retrieval applies workspace, deletion, timeline, author and visibility predicates in SQL
   before lexical, trigram, vector or reranker candidate generation.
3. A private memory is readable only by its author. Workspace-visible memories are readable
   only by active members of the same workspace.
4. Assets, document pages and chunks inherit server-side authorization from ownership or an
   active workspace-visible memory reference; removing that reference revokes access.
5. Citations are accepted only for chunks in the same workspace and are re-authorized before
   persistence and response rendering.
6. Agent tools cannot choose actor, workspace or author identity. Saving requires an explicit
   user save instruction and creates a private memory by default.
7. Agent execution recovery and cancellation require both workspace and actor identity.
8. Logs, metrics, traces and optional external observability events do not contain memory
   bodies, document text, prompts, raw queries, passwords, cookies, tokens or session values.

## Boundary matrix

| Boundary | Server-side enforcement | Adversarial evidence | Result |
| --- | --- | --- | --- |
| Session to principal | Session expiry/revocation and active membership are joined when resolving the principal. | Invalid, revoked and cross-workspace sessions are rejected. | PASS |
| Personal memory | Authorized query requires current author for `PRIVATE` records. New records default to private. | A second account cannot list, search, fetch or cite the private marker. | PASS |
| Team memory | Authorized query requires exact workspace plus active membership and `WORKSPACE` visibility. | Pending applicants cannot read team content; approval grants access; removal revokes it. | PASS |
| Deletion and unsharing | Active retrieval excludes deleted records; asset and citation authorization is recalculated from current visibility. | Unshare and delete tests remove results and derivative access. | PASS |
| Lexical/vector retrieval | Every retriever starts from the same authorized SQL relation; RRF and reranking only see those candidates. | SQL-shape tests and real PostgreSQL evaluation report zero unauthorized candidates. | PASS |
| Protected assets | Read requires ownership or a currently authorized workspace-visible memory reference. | Private, shared, unshared and deleted lifecycle is tested across two users. | PASS |
| PDF pages/chunks | Status, retry, cancel, download and chunk context all re-check asset/workspace authorization. | Cross-user access is rejected; delete propagation removes pages, chunks and vectors. | PASS |
| Page citations | Candidate chunk IDs must belong to the active workspace and to the attachment context supplied by the server. | Forged/out-of-context chunk IDs are rejected; unsharing invalidates historical access. | PASS |
| Agent tools | Typed registry validates arguments; identity and workspace are injected by the server; explicit save intent is required. | Invalid tools, denied tools, duplicate saves and forged arguments return bounded public errors. | PASS |
| Execution events | Reads and cancellation filter by actor and workspace; events contain public state and safe summaries only. | Other users receive not-found and private markers are absent from persisted/recovered events. | PASS |
| Logs and metrics | Recursive key redaction covers content, query, prompt, credentials and session values; metrics use enums, counts and durations. | Observability tests inject sensitive markers and assert they are absent from logs, metrics and sink payloads. | PASS |

## Code paths reviewed

- `apps/api/src/memora/identity/dependencies.py`: authenticated principal and active
  membership resolution.
- `apps/api/src/memora/memories/authorization.py`: canonical authorized-memory relation and
  author-only mutation guard.
- `apps/api/src/memora/retrieval/service.py`: lexical, trigram and semantic retrieval over the
  authorized relation, plus post-retrieval explanation data.
- `apps/api/src/memora/api/assets.py` and `apps/api/src/memora/api/documents.py`: asset,
  parse-job and document-context authorization.
- `apps/api/src/memora/api/drafts.py`: attachment context, citation persistence and final
  authorization checks.
- `apps/api/src/memora/agent/tools.py` and `apps/api/src/memora/agent/executions.py`: typed tool
  policy, explicit save intent, bounded results and actor/workspace execution ownership.
- `apps/api/src/memora/logging.py`, `apps/api/src/memora/observability.py` and
  `apps/api/src/memora/api/observability.py`: recursive redaction, low-cardinality metrics and
  constrained client-error events.

## Verification commands

The release closeout reruns the following after this review:

```bash
cd apps/api
uv run pytest \
  tests/test_identity.py \
  tests/test_memories.py \
  tests/test_retrieval.py \
  tests/test_assets.py \
  tests/test_documents.py \
  tests/test_agent_tools.py \
  tests/test_drafts.py \
  tests/test_observability.py

make eval-retrieval-postgres
make browser-e2e
```

The acceptance condition is zero unauthorized candidates, no sensitive marker in logs or
events, and successful revocation after unsharing, deletion or member removal.

## Residual risks and controls

- The optional external observability receiver is not configured in the current local
  deployment. Its event schema is deliberately allowlisted and contains no free-form user
  text; production operators must still validate receiver retention and access controls.
- PostgreSQL remains the enforcement boundary. Any future search index, analytics exporter or
  vector store must reproduce authorization-before-recall and requires a new ADR and leakage
  test suite before activation.
- Administrators can remove team members but cannot read private memories merely because they
  are administrators. This is intentional and must remain covered when adding future admin
  reporting.
- Operational database backups contain protected user data by design. They are created with
  owner-only permissions and must be encrypted and access-controlled by the deployment
  environment when moved off-host.
