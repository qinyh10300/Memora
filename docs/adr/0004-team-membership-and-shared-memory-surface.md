# ADR 0004: Team membership and shared-memory surface

Status: Accepted

Date: 2026-08-06

## Context

ADR 0002 established personal and team workspaces, server-side active workspace state, and memory
authorization through `workspace_id + author_id + visibility`, while deliberately postponing member
invitations and hiding the team surface during the personal Markdown MVP. Users now need to create and
join teams, inspect membership, and deliberately share selected memories without losing personal use.

## Decision

1. Keep `PERSONAL` and `TEAM` as the only workspace kinds and keep one active workspace in each
   database-backed browser session.
2. Give each team a unique, shareable join code. Authenticated users submit the code in a POST body to
   join as `MEMBER`; the joined team becomes active only after membership is committed.
3. Let team `OWNER`s add an existing active account by normalized email. This release does not send
   email or create invitations for unregistered accounts.
4. Keep membership roles limited to `OWNER` and `MEMBER`. Member removal, leaving, ownership transfer,
   team deletion and join-code rotation require a later decision.
5. Continue using `PRIVATE` and `WORKSPACE` memory visibility. New memories default to `PRIVATE`; only
   an explicit user choice can create or change a memory to `WORKSPACE`.
6. A team member can read their own private memories in that team plus all `WORKSPACE` memories in the
   same team. Other members' private memories must not become candidates for listing, detail, search,
   AI prompts, citations, reports, assets or logs.
7. Only the author may share, unshare, revise or delete a memory. Shared conversations and collaborative
   editing remain out of scope.

## Consequences

### Positive

- Personal and team use share one tested authorization and retrieval pipeline.
- Team joining is usable without an external mail provider.
- Explicit visibility keeps the existing private-by-default invariant visible in both API and UI.
- Author metadata already carried by memory responses can identify shared contributions without a
  second team-feed model.

### Negative

- A forwarded team code is a membership credential, so it needs high entropy, request-body transport
  and rate limiting; rotation is deferred.
- Email invitation works only for already registered accounts and does not notify the recipient.
- One active workspace per session means browser tabs still share the last selected workspace.

## Supersedes

This ADR supersedes only the invitation and hidden-team-surface deferrals in ADR 0002 and the personal-
only UI scope in the current MVP requirements. ADR 0002's workspace, conversation and authorization
boundaries remain in force.

## Revisit triggers

- Users need pending email invitations or external identity-provider membership provisioning.
- Teams need member removal, leave, ownership transfer, role administration or code rotation.
- Shared conversations, collaborative editing or more granular groups become validated requirements.
