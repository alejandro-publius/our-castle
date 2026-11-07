# Shared families: passkeys, invitations and server-enforced permissions

November 6, 2026. An opt-in **family access mode** for real families on this computer: each person signs in with their own passkey, the owner invites the others with a one-time link, and the server decides every request from the signed-in member's own membership. The example game (`npm run demo`) and the owner's configured app are unchanged and never switch into this mode.

## Try it

```
npm run family -- --port 3200 --data ./data/family
```

Then open **http://localhost:3200** (exactly this address; other local addresses redirect to it).

- **Starting a family.** **Start a new family** asks for your name and creates a passkey on this device. You become the owner of a new household with an empty placeholder goal, no progress and no example data. Found the house in **House**, then set the real goal in **Plan**.
- **Inviting.** In **House → Invite to the family**, give a name and choose **Adult** or **Child**, then send the link yourself. It works once, for 48 hours, and Our Castle sends no email.
- **Joining.** The invited person opens the link in their own browser, confirms the family and role, and creates their own passkey.
- **Day to day.** Members see the same goal, place, plan and progress. An open page shows another member's saved change as it happens ([live updates](#live-updates)); without a connection it re-reads when shown or focused, and at most every 45 seconds while visible. Sign out and add a passkey from **House**.

The runner keeps its own database (`<data>/our-castle-family-example.sqlite`). It reads no `.env` file and no provider keys: payments are simulated and plans use the built-in rules. The server can also run in this mode with `OUR_CASTLE_ACCESS=family` and `OUR_CASTLE_ORIGIN=http://localhost:<port>`. No request can choose the mode.

## Who can do what

| Member | Can | Cannot |
| --- | --- | --- |
| Owner (the founder) | Everything an adult can; name and crest the house; create and withdraw invitations; remove another member's access | Remove their own access; be removed |
| Adult | Change the goal and the Build choice, make, edit and use plans, approve exact contribution amounts (and, with a sandbox, PayPal checkout, refunds and checks), search the market, ask the steward, log bills and gifts | Invite, remove access or change the house |
| Child | See the realm, goal, plan, progress and ledger; try weekly amounts with the read-only schedule check; change their own avatar | Any goal, plan, payment, refund, provider check, model or market search; inviting or changing anyone's role |

"Child" is a permission the owner chooses when inviting. A passkey does not prove anyone's age or identity, and Our Castle stores no biometric data (the device keeps that).

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| Library | `@simplewebauthn/server` **14.0.3** and `@simplewebauthn/browser` **14.0.0**, exact pins | A maintained WebAuthn library; no hand-written signature or attestation code. 14.0.3 includes the 14.0.2 fix for GHSA-2g3p-m8c9-hhwh. 14.1.0, released hours before this work, adds metadata-service and attestation-format changes this app does not use, plus a new major X.509 dependency, so the matched, six-week-old pair was chosen. The browser helper's one-file UMD bundle is served from `node_modules` by exact path and loaded only by the sign-in screens. |
| Passkeys | Discoverable credentials (`residentKey: required`); user verification required and re-checked on the server; `none` attestation; ES256/RS256 | Sign-in needs no username. User verification is the device's own lock. |
| Origin and relying party | Exact `OUR_CASTLE_ORIGIN`; RP ID is its host name. Plain http only for `localhost`; IP addresses are refused at start-up | WebAuthn binds credentials to the RP ID. Invalid production origins stop the server rather than weakening checks. |
| Ceremonies | Challenges are single use, 5 minutes, bound to the purpose and to a short-lived HttpOnly browser binding (sign-in, new family, invitation) or to the session (add a passkey). They are marked used before verification. | A replayed, expired or other-window response fails. |
| Sessions | 256-bit random token in an HttpOnly, SameSite=Strict, path-wide cookie (`__Host-` and Secure on https); SHA-256 at rest; new identifier on every sign-in; 30-minute idle and 12-hour absolute expiry; sign-out and access removal revoke on the server | OWASP Session Management: opaque, rotated, expiring, revocable |
| CSRF | Every authenticated write needs `X-CSRF-Token`, derived from the session secret and given to the page only by `GET /api/session` (kept in memory, never storage). Writes also need the exact `Origin`. | Not SameSite alone |
| Authorization | One enumerated policy per route (`server/access/policy.mjs`). An unlisted route is refused, and a unit test keeps the routes and rules identical. Household, goal and acting member come only from the session: a request naming another household, goal, approver or member is refused before any service or provider work. | OWASP Authorization: deny by default, check each request against the actual relationship |
| Waits | A family write is authorized again once its body has arrived, before anything runs. The planner checks again after its model wait and before it stores a plan; the steward checks before and after each model turn and before each tool. Every private answer, success or error, is checked again when it is sent; only sign-out, which ends its own session, is exempt. These re-checks are not activity and never clear a cookie. A capture or refund already sent to PayPal is still recorded exactly once; only its answer is withheld, and the owner can recover it without another capture. | Access is checked when the action happens, not only when the request arrived |
| Invitations | 256-bit random token (in the URL fragment, which browsers do not send to servers), SHA-256 at rest, 48 hours, single use with an atomic accept (two browsers racing produce one member), role stored by the server and re-checked at completion | An invitation always creates a new account and member; it cannot reset credentials or raise a role. |
| Shared goal | In family mode a goal edit must carry the revision the form was showing. A stale save is refused (409), and **Load latest goal** keeps the member's own edits. | Another member's newer goal is never silently overwritten. |
| Per-request scope | Planner, steward and state use the request's own household. Market drafts are accepted only from a household this server showed them to. The example-only reset is refused. PayPal's signed webhook stays a machine route. | No shared "current household" and no cross-family cached results |
| Limits | 30 ceremony requests a minute per address per ceremony; 30 invitations an hour per household; up to 12 members and open invitations | Bounded abuse; the counters live in memory |
| Audit | `audit_events`: actor, household, action, time and an id (never a token, hash or credential) for family creation, invitations, joining, passkeys, sign-in and sign-out, refused sign-ins and access removal | Internal evidence; no dashboard |
| Data | The `family-access` migration (step 7 of the integrated sequence) adds new tables only (accounts, passkeys, memberships, invitations, sessions, ceremony challenges, audit events). Family mode uses its own database file and never creates the example household. | Existing rows and columns are untouched (tested from a pre-access file and from every earlier schema; see [Integration](#integration-one-migration-sequence)). |

## Live updates

Every open page of a shared family keeps one live-update stream (`GET /api/events`, server-sent events), so a change saved on one device appears on the others without a reload or a click.

| Area | Decision | Why |
| --- | --- | --- |
| What travels | Only an event name (`ready`, `invalidate`, `end`) and an opaque household revision such as `Xy3…a.12`. No record, name, id, amount or token. The page then re-reads `/api/state` through the normal authorized route. | Minimal data on the stream; the same authorization as any read |
| Who is told | After any authorized write (except calculations, look-ups and questions), every open page of **that household**, and no other. A verified PayPal webhook tells only the households whose payment records it changed; a newly accepted invitation tells the family. A write the access rules refuse announces nothing; one that fails inside its route still sends a notice, since it may have recorded a status. | No cross-family signal |
| Order | Each household's revision moves before a write runs and again after it, and every family-mode state carries it. A page keeps only answers for its own member and household that are no older than the one it shows (a server restart is a newer start). One read at a time; a change announced during a read reads once more after it. | An older answer that arrives late never replaces a newer one |
| Sessions | A stream and a background re-read (`X-Our-Castle-Refresh: background`) are not activity, so they never keep an idle session alive. The server re-checks each stream's session and membership every 15 seconds and ends the stream at once on sign-out, removed access, a renewed sign-in in the same browser, and idle or absolute expiry. The page then asks for the passkey with the reason ("Your access to this family was removed."). A request refused because this browser signed in again as the same member (in another tab) while it was under way does not end the page: the page checks `/api/session` first, keeps the newer session and its CSRF token, and asks the member to check the latest records before trying again. | An open tab is not a way around expiry or revocation |
| Bounds | Up to 3 streams per sign-in (a new tab replaces the oldest, which falls back to re-reading on focus), 24 per household and 200 per server; more are refused with `503 live_busy`. One shared timer, released with the last stream; every stream ends when the server stops. | Bounded connections and timers |
| Reconnecting | The browser reconnects a dropped stream by itself. A refused or unreachable stream retries with backoff (1 s doubling to 30 s, with jitter), checks the session first, and refreshes the CSRF token after a renewed sign-in. On reconnect the page re-reads if the revision moved. After 8 seconds away it shows one compact control in the top bar: "Updates paused · **Reconnect**". | Recover from drops and restarts without a storm of requests |
| Work in progress | Unsaved Plan fields, a schedule trial, a Merchant draft, an avatar being chosen and a half-typed invitation stay as they are; only results for an older goal are cleared (a trial result, an old answer). A save against a goal another member changed is refused once with **Load latest goal** / **Review latest goal**, which keeps the member's own edits. A newly opened area's deed card can appear over a form; it changes nothing, and closing it returns focus to where it was. The Ledger keeps its filter, search, sort, selection and keyboard position, and a focused map marker keeps the keyboard (the map's buttons are rebuilt only when an area opens or closes or the Build choice changes, and a rebuilt button keeps its place and focus). | Live updates never cost anyone their typing or their place |
| Approvals | A ticked contribution approval covers one amount, for one goal, by one adult, in one session. If the goal (or the sign-in) changes underneath it, the tick is cleared with one message and must be given again; an unrelated change, a dropped connection or a server restart (the same session) keeps it; ticking also stops a later suggested amount replacing the approved one. Server verification is unchanged. | Amount-specific adult approval stays true to what was seen |

Example mode has no stream and its state carries no revision.

## Integration: one migration sequence

The integrated build has seven schema steps: main's four SQL steps, then three checked steps that each test the actual tables before changing them: `goal-project-kind` (5), `merchant-selection` (6) and `family-access` (7). Schema 5 and 6 were written by two different pre-integration branches (goal projects and sponsor depth each used 5; family access used 6), so a database at 5 or 6 is named in a warning and re-checked from step 5, never trusted. Every path (4, both 5s, 6, 7) reaches exactly a fresh database's schema with its rows kept; a schema newer than 7 is refused and left untouched (`test/unit/migration-integration.test.mjs`). This was also checked against each source branch's own `openDatabase` on throwaway files.

## Recovery limits

- **No takeover.** There is no unauthenticated identity switch, recovery email or administrator takeover. A member who loses every passkey cannot sign in as that member again.
- **Re-inviting.** The owner can invite the person again (a new member and passkey) and remove the old member's access. Earlier records keep the old member's name.
- **Losing the owner.** If the owner loses every passkey, nobody can manage invitations or access for that family. Add a second passkey from House while recently signed in (within 10 minutes of a passkey check), or use a passkey that the device syncs.
- **Not yet available:** ownership transfer, account deletion and a member leaving on their own.

## Checks

These are local tests: real HTTP and real WebAuthn verification, with simulated payments and no provider calls.

**Live updates (`test/unit/family-live.test.mjs`, 7 cases).** Real streams over HTTP read like an EventSource, two families on one server: only the changed household's pages are told, with a bare revision, and every state answer is ordered by it; reads, calculations, merchant look-ups and refused writes announce nothing; a fake Channel3 product saved as a goal is announced; one simulated contribution is credited once and announced once per page; removed access, a renewed sign-in, sign-out and idle expiry end a stream at once, and streams and background reads never extend a session; per-session, per-household and server bounds; every stream, listener and the timer released; a verified fake-PayPal webhook tells only the household it settled; a real restart on the same file; example mode has none.

**Browser (`test/e2e/shared-live.spec.mjs`, 4 cases).** Each person a separate Chromium context with its own virtual passkey; every request leaving the server's origin is refused and recorded, and none were (Channel3's image CDN gets a drawn stand-in):
- **Three members and a separate family (desktop):** a goal and Build choice reaching the others without reload or focus; a schedule trial, an avatar being chosen and a half-typed invitation untouched by an unrelated change and surviving another member's goal save, with **Load latest goal** keeping the member's own field; an approval kept through an unrelated change and cleared once when the goal changed elsewhere; one simulated contribution credited once with the same receipt and the Manor Gardens deed on every family page; the owner's keyboard kept on the visited Manor marker through a live update that leaves the map as it is and one that rebuilds it (another adult's Build choice); the owner's Ledger keeping its filter, search, sort, selected receipt and keyboard position while the weekly Treasury moved by Studio live data in the same instance; a fake Channel3 product saved only after **Review latest goal**; the child shown no steward questions; the other family never re-reading; removed access ending the child's page at once; no stream or timer left after the pages closed.
- **A dropped connection (desktop):** the server cut every connection while one device was offline; nothing shown for a brief drop, then one **Reconnect** control; **Reconnect** sending a new attempt at once (clicked while still offline, so it never races the automatic reconnect) and the change made meanwhile arriving when the network returns, and by itself after a second drop; 31 idle minutes ending both open sessions without a click.
- **A real restart of `scripts/family.mjs` (desktop):** both pages reconnecting by themselves to the new server start and still receiving changes, in the same document; an approval given before the restart kept (the same session) and paid once after it.
- **Two 390 px phones:** a change arriving live; the Reconnect control fitting the top bar with a 44 px target and no horizontal scroll.

**Server (`test/unit/family-access.test.mjs`, 18 cases).** A software authenticator, test-only `node:crypto` P-256, produces genuine signed responses. The cases cover:
- **Configuration and routes:** server-only configuration; every route enumerated in both directions.
- **Family creation and cookies:** cookie attributes; hash-at-rest; zero progress; no example household.
- **Refused ceremonies:** another origin or RP; no user verification; the wrong type or challenge; a replay; another window; expiry; a cloned counter.
- **Sessions:** rotation; CSRF; exact host and origin; idle and absolute expiry; sign-out.
- **Invitations:** hashing; single use; a race; a tampered role; withdrawal; expiry.
- **Refusals:** child and outsider refusals across 14 routes; spoofed household, goal, approver and member; another household's capture, contribution, plan and steward order.
- **Shared goal and access:** stale goal edits; one contribution seen by everyone; owner-only revocation; refused sign-in after revocation; audit content.
- **Passkeys, restart and upgrade:** a second passkey and its recent-check window; persistence through a server restart on the same file; the upgrade from a pre-access database.
- **Waits (8 cases):** an adult removed, signed out or expired while a request body is still arriving makes no household write. The steward, with a fake model transport, starts no further tool or model turn and returns no answer after removal, sign-out or expiry during a model wait, or removal during a tool read. An active control finishes without its re-checks extending the session.

**Runtime boundaries (`test/unit/family-runtime-boundaries.test.mjs`, 9 cases).** A gated fake planner is interrupted by removal, idle expiry, sign-out and a renewed sign-in, with valid, invalid and failed answers. It saves no late plan and returns no private answer, and the newer sign-in's cookie keeps working. An active control saves its plan without extending the session. A fake PayPal capture and refund already sent when the adult is removed are each recorded once and return no private state, and the owner recovers the capture without a second one.

**Browser (`test/e2e/family-access.spec.mjs`).** Chromium's virtual authenticator, a separate one per person, covers:
- **One family across independent contexts:**
  - an owner, an adult and a child plus a separate family;
  - a goal and Build choice reaching another open page live;
  - a refused stale edit recovered with Load latest goal;
  - a simulated contribution seen once by all;
  - the child refused in the page and over HTTP;
  - own-avatar editing;
  - a spoofed household refused;
  - revoked access ending the session and refusing the passkey;
  - sign-out and sign-in.
- **Expiry and links:** session expiry returning to sign-in; withdrawn, broken and expired invitation links.
- **Renewed sign-in:** a plan request waits on a gated fake planner while a second tab of the same browser signs in with the owner's passkey (copied to that tab's virtual authenticator). The first tab stays signed in, says to check the latest records, saves no plan, and then the same request succeeds.
- **Restart:** a real restart of `scripts/family.mjs` keeping the family and session.
- **Phone:** 390 px fit with 44 px controls.

Live captures: [owner's page showing the Manor deed from another member's contribution](screenshots/shared-live-owner-manor.png) · [owner's Ledger kept through a live update](screenshots/shared-live-owner-ledger.png) · [Reconnect, desktop](screenshots/shared-live-reconnect.png) · [Reconnect, phone](screenshots/shared-live-phone-reconnect.png) · [access removed during a connection](screenshots/shared-live-removed.png) ([provenance](screenshots/shared-live-sources.json)).

Captures: [phone sign-in](screenshots/family-access-phone-sign-in.png) · [invitation](screenshots/family-access-invitation.png) · [owner's family section](screenshots/family-access-owner.png) · [child's read-only plan](screenshots/family-access-child-plan.png) · [removed access](screenshots/family-access-revoked.png) · [phone family section](screenshots/family-access-phone-house.png) ([provenance](screenshots/family-access-sources.json)).

The virtual authenticator is not a real phone, Touch ID, Face ID or security-key test. This is not a security certification, a public deployment or evidence of real family use.
