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
- **Day to day.** Members see the same goal, place, plan and progress. Open pages refresh quietly when focused, and at most every 45 seconds while visible. Sign out and add a passkey from **House**.

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
| Invitations | 256-bit random token (in the URL fragment, which browsers do not send to servers), SHA-256 at rest, 48 hours, single use with an atomic accept (two browsers racing produce one member), role stored by the server and re-checked at completion | An invitation always creates a new account and member; it cannot reset credentials or raise a role. |
| Shared goal | In family mode a goal edit must carry the revision the form was showing. A stale save is refused (409), and **Load latest goal** keeps the member's own edits. | Another member's newer goal is never silently overwritten. |
| Per-request scope | Planner, steward and state use the request's own household. Market drafts are accepted only from a household this server showed them to. The example-only reset is refused. PayPal's signed webhook stays a machine route. | No shared "current household" and no cross-family cached results |
| Limits | 30 ceremony requests a minute per address per ceremony; 30 invitations an hour per household; up to 12 members and open invitations | Bounded abuse; the counters live in memory |
| Audit | `audit_events`: actor, household, action, time and an id (never a token, hash or credential) for family creation, invitations, joining, passkeys, sign-in and sign-out, refused sign-ins and access removal | Internal evidence; no dashboard |
| Data | Migration 6 adds new tables only (accounts, passkeys, memberships, invitations, sessions, ceremony challenges, audit events). Family mode uses its own database file and never creates the example household. | Existing rows and columns are untouched (tested from a pre-access file). |

## Recovery limits

- **No takeover.** There is no unauthenticated identity switch, recovery email or administrator takeover. A member who loses every passkey cannot sign in as that member again.
- **Re-inviting.** The owner can invite the person again (a new member and passkey) and remove the old member's access. Earlier records keep the old member's name.
- **Losing the owner.** If the owner loses every passkey, nobody can manage invitations or access for that family. Add a second passkey from House while recently signed in (within 10 minutes of a passkey check), or use a passkey that the device syncs.
- **Not yet available:** ownership transfer, account deletion and a member leaving on their own.

## Checks

These are local tests: real HTTP and real WebAuthn verification, with simulated payments and no provider calls.

**Server (`test/unit/family-access.test.mjs`, 10 cases).** A software authenticator, test-only `node:crypto` P-256, produces genuine signed responses. The cases cover:
- **Configuration and routes:** server-only configuration; every route enumerated in both directions.
- **Family creation and cookies:** cookie attributes; hash-at-rest; zero progress; no example household.
- **Refused ceremonies:** another origin or RP; no user verification; the wrong type or challenge; a replay; another window; expiry; a cloned counter.
- **Sessions:** rotation; CSRF; exact host and origin; idle and absolute expiry; sign-out.
- **Invitations:** hashing; single use; a race; a tampered role; withdrawal; expiry.
- **Refusals:** child and outsider refusals across 14 routes; spoofed household, goal, approver and member; another household's capture, contribution, plan and steward order.
- **Shared goal and access:** stale goal edits; one contribution seen by everyone; owner-only revocation; refused sign-in after revocation; audit content.
- **Passkeys, restart and upgrade:** a second passkey and its recent-check window; persistence through a server restart on the same file; the upgrade from a pre-access database.

**Browser (`test/e2e/family-access.spec.mjs`).** Chromium's virtual authenticator, a separate one per person, covers:
- **One family across independent contexts:**
  - an owner, an adult and a child plus a separate family;
  - a goal and Build choice reaching another open page on focus;
  - a refused stale edit recovered with Load latest goal;
  - a simulated contribution seen once by all;
  - the child refused in the page and over HTTP;
  - own-avatar editing;
  - a spoofed household refused;
  - revoked access ending the session and refusing the passkey;
  - sign-out and sign-in.
- **Expiry and links:** session expiry returning to sign-in; withdrawn, broken and expired invitation links.
- **Restart:** a real restart of `scripts/family.mjs` keeping the family and session.
- **Phone:** 390 px fit with 44 px controls.

Captures: [phone sign-in](screenshots/family-access-phone-sign-in.png) · [invitation](screenshots/family-access-invitation.png) · [owner's family section](screenshots/family-access-owner.png) · [child's read-only plan](screenshots/family-access-child-plan.png) · [removed access](screenshots/family-access-revoked.png) · [phone family section](screenshots/family-access-phone-house.png) ([provenance](screenshots/family-access-sources.json)).

The virtual authenticator is not a real phone, Touch ID, Face ID or security-key test. This is not a security certification, a public deployment or evidence of real family use.
