// Family access: passkey accounts, households shared through invitations, and server-side sessions. Only used when the
// server is configured for family access (config.access.mode === 'family'); the example household never has accounts.
//
// Passkeys are verified by the pinned @simplewebauthn/server library against this server's exact origin and relying
// party, with user verification required. Every secret the browser holds (session, ceremony binding, invitation) is a
// random opaque token; the database keeps only its SHA-256 hash. Sessions rotate on every sign-in, expire after
// inactivity and absolutely, and end on sign-out or when the owner removes the member's access.
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { transaction } from '../db.mjs';
import { DomainError, addDays, getActiveGoal, getGoal, getHousehold, newId, setStartingProgress } from '../household.mjs';
import { CURRENCY } from '../../src/core/rules.js';
import { cleanDisplayName, cookieName, createRateLimiter, hashToken, parseCookies, randomToken, sameHash, serializeCookie } from './primitives.mjs';

const ALGORITHMS = [-7, -257]; // ES256 and RS256, the algorithms passkey platforms use
const MAX_MEMBERS = 12;        // active members plus pending invitations in one household
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export class AccessError extends DomainError {}
const denied = (status, code, message) => new AccessError(status, code, message);

export function createAccess({ db, clock, config, events = {} }) {
  // Live-update hooks (server/live.mjs): a session ended, a member lost access, a household's membership changed.
  const nowMs = () => clock.now().getTime();
  const iso = (ms = nowMs()) => new Date(ms).toISOString();
  const SESSION = cookieName('oc_session', config.secure);
  const FLOW = cookieName('oc_flow', config.secure);
  const ceremonyLimit = createRateLimiter({ windowMs: 60_000, max: 30, now: nowMs });
  const inviteLimit = createRateLimiter({ windowMs: 3_600_000, max: 30, now: nowMs });

  // ---------- Cookies, ceremonies' browser binding and sessions ----------
  function addCookie(res, cookie) {
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), cookie]);
  }
  const cookie = (req, name) => { const v = parseCookies(req.headers.cookie)[name]; return v && TOKEN.test(v) ? v : null; };
  // A session's CSRF token is derived from its secret, so the server need not store it and another site cannot know it.
  const csrfFor = (token) => hashToken(`csrf:${token}`).slice(0, 43);

  function limited(req, bucket, limiter = ceremonyLimit) {
    if (!limiter.take(`${bucket}:${req.socket?.remoteAddress ?? 'local'}`)) throw denied(429, 'too_many_attempts', 'Too many attempts. Wait a minute, then try again.');
  }

  /** The browser's binding for a ceremony that starts before anyone is signed in. */
  function flowFor(req, res) {
    let flow = cookie(req, FLOW);
    if (!flow) { flow = randomToken(); addCookie(res, serializeCookie(FLOW, flow, { maxAgeSeconds: config.flowMs / 1000, secure: config.secure })); }
    return hashToken(flow);
  }

  function audit({ householdId = null, accountId = null, memberId = null, action, subject = null }) {
    db.prepare('INSERT INTO audit_events (household_id, account_id, member_id, action, subject, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(householdId, accountId, memberId, action, subject, iso());
  }

  function revokeSession(id, reason) {
    db.prepare('UPDATE sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL').run(iso(), reason, id);
    events.sessionEnded?.(id, reason);
  }

  /** The signed-in member behind this request's session cookie, or why there is none. */
  function readSession(req, { activity = true } = {}) {
    const token = cookie(req, SESSION);
    if (!token) return { session: null, reason: parseCookies(req.headers.cookie)[SESSION] ? 'invalid' : 'none' };
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
    if (!row || row.revoked_at) return { session: null, reason: 'expired' };
    const t = nowMs();
    if (Date.parse(row.expires_at) <= t) { revokeSession(row.id, 'expired'); return { session: null, reason: 'expired' }; }
    if (t - Date.parse(row.last_seen_at) > config.sessionIdleMs) { revokeSession(row.id, 'idle'); return { session: null, reason: 'expired' }; }
    const member = db.prepare(`SELECT ms.is_owner, ms.access, m.role, m.display_name FROM memberships ms JOIN members m ON m.id = ms.member_id
      WHERE ms.member_id = ? AND ms.household_id = ? AND ms.account_id = ?`).get(row.member_id, row.household_id, row.account_id);
    if (!member || member.access !== 'active') { revokeSession(row.id, 'access_revoked'); return { session: null, reason: 'revoked' }; }
    if (activity && t - Date.parse(row.last_seen_at) > 60_000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(iso(t), row.id);
    return { session: { ...row, token, role: member.role, owner: member.is_owner === 1, name: member.display_name }, reason: null };
  }

  function startSession(req, res, { accountId, memberId, householdId }) {
    // Rotation: a ceremony always ends any session this browser had and issues a new identifier.
    const previous = cookie(req, SESSION);
    if (previous) {
      const old = db.prepare('SELECT id FROM sessions WHERE token_hash = ?').get(hashToken(previous));
      if (old) revokeSession(old.id, 'rotated');
    }
    const token = randomToken(), t = nowMs();
    db.prepare(`INSERT INTO sessions (id, token_hash, csrf_hash, account_id, member_id, household_id, created_at, last_seen_at, verified_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId('ses'), hashToken(token), hashToken(csrfFor(token)), accountId, memberId, householdId, iso(t), iso(t), iso(t), iso(t + config.sessionAbsoluteMs));
    addCookie(res, serializeCookie(SESSION, token, { maxAgeSeconds: config.sessionAbsoluteMs / 1000, secure: config.secure }));
    addCookie(res, serializeCookie(FLOW, '', { maxAgeSeconds: 0, secure: config.secure }));
  }

  function clearSessionCookie(res) { addCookie(res, serializeCookie(SESSION, '', { maxAgeSeconds: 0, secure: config.secure })); }

  // ---------- Ceremony challenges: single use, short lived, bound to their purpose and to this browser or session ----------
  function saveChallenge({ purpose, challenge, flowHash = null, sessionId = null, invitationId = null, displayName = null, userHandle = null }) {
    const id = newId('chl'), t = nowMs();
    db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(iso(t - 86_400_000));
    db.prepare(`INSERT INTO auth_challenges (id, purpose, challenge, flow_hash, session_id, invitation_id, display_name, user_handle, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, purpose, challenge, flowHash, sessionId, invitationId, displayName, userHandle, iso(t), iso(t + config.challengeMs));
    return id;
  }
  function consumeChallenge({ ceremonyId, purpose, req = null, sessionId = null }) {
    const row = typeof ceremonyId === 'string' ? db.prepare('SELECT * FROM auth_challenges WHERE id = ? AND purpose = ?').get(ceremonyId, purpose) : null;
    const flow = req ? cookie(req, FLOW) : null;
    const bound = row && (sessionId ? row.session_id === sessionId : Boolean(flow && row.flow_hash && sameHash(row.flow_hash, hashToken(flow))));
    if (!bound) throw denied(400, 'ceremony_expired', 'This passkey step expired or belongs to another window. Start again.');
    // Mark it used before verifying, so neither a failure nor a replay can use it twice.
    if (db.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL').run(iso(), row.id).changes !== 1
      || Date.parse(row.expires_at) <= nowMs()) throw denied(400, 'ceremony_expired', 'This passkey step expired or was already used. Start again.');
    return row;
  }

  async function registrationOptions({ userName, userHandle, excludeCredentials = [] }) {
    return generateRegistrationOptions({
      rpName: config.rpName, rpID: config.rpId, userName, userDisplayName: userName, userID: new Uint8Array(Buffer.from(userHandle, 'base64url')),
      attestationType: 'none', timeout: config.challengeMs, supportedAlgorithmIDs: ALGORITHMS, excludeCredentials,
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    });
  }
  async function verifiedRegistration(response, challenge) {
    let result;
    try {
      result = await verifyRegistrationResponse({
        response, expectedChallenge: challenge.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId,
        requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS,
      });
    } catch { result = null; }
    if (!result?.verified || !result.registrationInfo?.userVerified) throw denied(400, 'passkey_rejected', 'That passkey could not be verified. Nothing was saved; try again.');
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    if (db.prepare('SELECT 1 FROM passkeys WHERE id = ?').get(credential.id)) throw denied(409, 'passkey_exists', 'That passkey is already registered.');
    return { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [], deviceType: credentialDeviceType, backedUp: credentialBackedUp };
  }
  function insertPasskey(accountId, key) {
    db.prepare(`INSERT INTO passkeys (id, account_id, public_key, counter, transports, device_type, backed_up, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(key.id, accountId, key.publicKey, key.counter, JSON.stringify(key.transports), key.deviceType, key.backedUp ? 1 : 0, iso());
  }
  function insertAccount(displayName, userHandle) {
    const id = newId('acct');
    db.prepare('INSERT INTO accounts (id, display_name, user_handle, created_at) VALUES (?, ?, ?, ?)').run(id, displayName, userHandle, iso());
    return id;
  }

  // ---------- Invitations ----------
  const invitationStatus = (row) => (row.status === 'pending' && Date.parse(row.expires_at) <= nowMs() ? 'expired' : row.status);
  const invitationView = (row) => ({ id: row.id, name: row.display_name, role: row.role, status: invitationStatus(row), createdAt: row.created_at, expiresAt: row.expires_at, acceptedAt: row.accepted_at });
  function invitationByToken(token) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    return db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(hashToken(token)) ?? null;
  }
  function openInvitation(token) {
    const row = invitationByToken(token);
    const status = row ? invitationStatus(row) : 'unknown';
    if (status !== 'pending') {
      const message = { expired: 'This invitation has expired. Ask the family for a new one.', revoked: 'This invitation was withdrawn.', accepted: 'This invitation has already been used.' }[status]
        ?? 'This invitation link is not valid.';
      throw new AccessError(410, 'invitation_unavailable', message, { invitationStatus: status });
    }
    return row;
  }

  return {
    sessionCookieName: SESSION,
    readSession,
    clearSessionCookie,
    /**
     * Whether a session (by id) may still receive live updates: null if so, otherwise why not. Unlike a request this is
     * not activity, so an open page never keeps an idle session alive; it ends the session when it has expired.
     */
    sessionEndReason(sessionId) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      if (!row || row.revoked_at) return row?.revoke_reason === 'signed_out' ? 'signed_out' : row?.revoke_reason === 'access_revoked' ? 'access_revoked' : 'expired';
      const t = nowMs();
      if (Date.parse(row.expires_at) <= t) { revokeSession(row.id, 'expired'); return 'expired'; }
      if (t - Date.parse(row.last_seen_at) > config.sessionIdleMs) { revokeSession(row.id, 'idle'); return 'expired'; }
      const member = db.prepare('SELECT access FROM memberships WHERE member_id = ? AND household_id = ? AND account_id = ?').get(row.member_id, row.household_id, row.account_id);
      if (!member || member.access !== 'active') { revokeSession(row.id, 'access_revoked'); return 'access_revoked'; }
      return null;
    },
    csrfOk(req, session) {
      const sent = req.headers['x-csrf-token'];
      return typeof sent === 'string' && sent.length < 100 && sameHash(hashToken(sent), session.csrf_hash);
    },
    /** The request's scope, derived only from a validated session and its active membership. */
    scopeOf(session) {
      const goal = getActiveGoal(db, session.household_id);
      if (!goal) throw denied(409, 'goal_missing', 'This family has no active goal.');
      return Object.freeze({ mode: 'family', householdId: session.household_id, goalId: goal.id, memberId: session.member_id, accountId: session.account_id, role: session.role, owner: session.owner, sessionId: session.id, verifiedAt: session.verified_at });
    },
    sessionInfo(session) {
      if (!session) return { signedIn: false };
      const household = getHousehold(db, session.household_id);
      return { signedIn: true, csrfToken: csrfFor(session.token), member: { id: session.member_id, name: session.name, role: session.role, owner: session.owner }, household: { id: household.id, name: household.name } };
    },

    // ---------- Create a family: the creator's passkey and name; the household, owner and an empty goal ----------
    async familyOptions(req, res, body) {
      limited(req, 'family');
      const name = cleanDisplayName(body.displayName);
      if (!name) throw denied(400, 'invalid_name', 'Enter your name (up to 40 characters).');
      const userHandle = randomToken();
      const options = await registrationOptions({ userName: name, userHandle });
      return { options, ceremonyId: saveChallenge({ purpose: 'create-family', challenge: options.challenge, flowHash: flowFor(req, res), displayName: name, userHandle }) };
    },
    async familyVerify(req, res, body) {
      limited(req, 'family');
      const challenge = consumeChallenge({ ceremonyId: body.ceremonyId, purpose: 'create-family', req });
      const key = await verifiedRegistration(body.response, challenge);
      const at = iso();
      const ids = transaction(db, () => {
        const accountId = insertAccount(challenge.display_name, challenge.user_handle);
        insertPasskey(accountId, key);
        const householdId = newId('hh'), memberId = newId('m'), goalId = newId('goal');
        db.prepare(`INSERT INTO households (id, name, play_mode, crest_field, crest_charge, is_example, setup_complete, created_at)
          VALUES (?, ?, 'family', 'cobalt', 'stag', 0, 0, ?)`).run(householdId, `House of ${challenge.display_name}`.slice(0, 40), at);
        db.prepare("INSERT INTO members (id, household_id, display_name, role, is_example, sort, avatar_id) VALUES (?, ?, ?, 'adult', 0, 0, NULL)").run(memberId, householdId, challenge.display_name);
        db.prepare("INSERT INTO memberships (member_id, account_id, household_id, is_owner, access, created_at) VALUES (?, ?, ?, 1, 'active', ?)").run(memberId, accountId, householdId, at);
        // A placeholder goal the family replaces in Plan: nothing reported, nothing contributed, no weekly amount chosen.
        db.prepare('INSERT INTO goals (id, household_id, name, target_cents, currency, target_date, weekly_budget_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
          .run(goalId, householdId, 'Our first goal', 10000, CURRENCY, addDays(clock.today(), 56), at);
        setStartingProgress(db, getGoal(db, goalId), 0, at);
        audit({ householdId, accountId, memberId, action: 'family.created' });
        audit({ householdId, accountId, memberId, action: 'passkey.added', subject: key.id.slice(0, 12) });
        return { accountId, memberId, householdId };
      });
      startSession(req, res, ids);
      audit({ ...ids, action: 'session.signed_in' });
      return { signedIn: true };
    },

    // ---------- Sign in with a discoverable passkey ----------
    async signInOptions(req, res) {
      limited(req, 'signin');
      const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: 'required', timeout: config.challengeMs });
      return { options, ceremonyId: saveChallenge({ purpose: 'sign-in', challenge: options.challenge, flowHash: flowFor(req, res) }) };
    },
    async signInVerify(req, res, body) {
      limited(req, 'signin');
      const challenge = consumeChallenge({ ceremonyId: body.ceremonyId, purpose: 'sign-in', req });
      const response = body.response;
      const key = typeof response?.id === 'string' ? db.prepare('SELECT * FROM passkeys WHERE id = ?').get(response.id) : null;
      if (!key) throw denied(400, 'passkey_rejected', 'That passkey is not registered with this Our Castle.');
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(key.account_id);
      if (typeof response.response?.userHandle === 'string' && response.response.userHandle !== account.user_handle) throw denied(400, 'passkey_rejected', 'That passkey could not be verified.');
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response, expectedChallenge: challenge.challenge, expectedOrigin: config.origin, expectedRPID: config.rpId, requireUserVerification: true,
          credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) },
        });
      } catch { result = null; }
      if (!result?.verified || !result.authenticationInfo.userVerified) throw denied(400, 'passkey_rejected', 'That passkey could not be verified.');
      const membership = db.prepare('SELECT * FROM memberships WHERE account_id = ?').get(account.id);
      if (!membership || membership.access !== 'active') {
        audit({ householdId: membership?.household_id, accountId: account.id, memberId: membership?.member_id, action: 'session.refused_revoked' });
        throw denied(403, 'access_revoked', 'This passkey no longer has access to a family here.');
      }
      db.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?').run(result.authenticationInfo.newCounter, iso(), key.id);
      const ids = { accountId: account.id, memberId: membership.member_id, householdId: membership.household_id };
      startSession(req, res, ids);
      audit({ ...ids, action: 'session.signed_in' });
      return { signedIn: true };
    },

    // ---------- Accept an invitation: confirm, then enrol a new passkey for the invited member ----------
    invitationPreview(req, body) {
      limited(req, 'invite');
      const row = openInvitation(body.token);
      return { invitation: { familyName: getHousehold(db, row.household_id).name, name: row.display_name, role: row.role, expiresAt: row.expires_at } };
    },
    async invitationOptions(req, res, body) {
      limited(req, 'invite');
      const row = openInvitation(body.token);
      const userHandle = randomToken();
      const options = await registrationOptions({ userName: row.display_name, userHandle });
      return { options, ceremonyId: saveChallenge({ purpose: 'accept-invite', challenge: options.challenge, flowHash: flowFor(req, res), invitationId: row.id, displayName: row.display_name, userHandle }) };
    },
    async invitationVerify(req, res, body) {
      limited(req, 'invite');
      const challenge = consumeChallenge({ ceremonyId: body.ceremonyId, purpose: 'accept-invite', req });
      const row = openInvitation(body.token);
      if (row.id !== challenge.invitation_id) throw denied(400, 'ceremony_expired', 'This passkey step belongs to another invitation. Start again.');
      const key = await verifiedRegistration(body.response, challenge);
      const at = iso();
      const ids = transaction(db, () => {
        // Accept exactly once: a second browser, a revoke or the expiry in the meantime leaves this one unchanged.
        const memberId = newId('m');
        const won = db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = ?, accepted_member_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
          .run(at, memberId, row.id, at).changes === 1;
        if (!won) throw new AccessError(410, 'invitation_unavailable', 'This invitation was already used, withdrawn or has expired.');
        const accountId = insertAccount(row.display_name, challenge.user_handle);
        insertPasskey(accountId, key);
        const sort = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM members WHERE household_id = ?').get(row.household_id).next;
        // The role is the one the owner chose and the server stored; nothing the browser sends can change it.
        db.prepare('INSERT INTO members (id, household_id, display_name, role, is_example, sort, avatar_id) VALUES (?, ?, ?, ?, 0, ?, NULL)').run(memberId, row.household_id, row.display_name, row.role, sort);
        db.prepare("INSERT INTO memberships (member_id, account_id, household_id, is_owner, access, created_at) VALUES (?, ?, ?, 0, 'active', ?)").run(memberId, accountId, row.household_id, at);
        audit({ householdId: row.household_id, accountId, memberId, action: 'invitation.accepted', subject: row.id });
        audit({ householdId: row.household_id, accountId, memberId, action: 'passkey.added', subject: key.id.slice(0, 12) });
        return { accountId, memberId, householdId: row.household_id };
      });
      startSession(req, res, ids);
      audit({ ...ids, action: 'session.signed_in' });
      events.householdChanged?.(ids.householdId); // the family's open pages show the new member
      return { signedIn: true };
    },

    // ---------- A signed-in member: sign out, or add another passkey after a recent passkey check ----------
    signOut(res, scope) {
      revokeSession(scope.sessionId, 'signed_out');
      clearSessionCookie(res);
      audit({ householdId: scope.householdId, accountId: scope.accountId, memberId: scope.memberId, action: 'session.signed_out' });
      return { signedIn: false };
    },
    async passkeyOptions(req, scope) {
      limited(req, 'passkey');
      if (nowMs() - Date.parse(scope.verifiedAt) > config.recentAuthMs) throw denied(403, 'reauth_required', 'Sign in again with your passkey, then add another one.');
      const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(scope.accountId);
      const existing = db.prepare('SELECT id, transports FROM passkeys WHERE account_id = ?').all(scope.accountId).map((k) => ({ id: k.id, transports: JSON.parse(k.transports) }));
      const options = await registrationOptions({ userName: account.display_name, userHandle: account.user_handle, excludeCredentials: existing });
      return { options, ceremonyId: saveChallenge({ purpose: 'add-passkey', challenge: options.challenge, sessionId: scope.sessionId }) };
    },
    async passkeyVerify(req, scope, body) {
      limited(req, 'passkey');
      const challenge = consumeChallenge({ ceremonyId: body.ceremonyId, purpose: 'add-passkey', sessionId: scope.sessionId });
      const key = await verifiedRegistration(body.response, challenge);
      insertPasskey(scope.accountId, key);
      audit({ householdId: scope.householdId, accountId: scope.accountId, memberId: scope.memberId, action: 'passkey.added', subject: key.id.slice(0, 12) });
      return { passkeys: db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?').get(scope.accountId).n };
    },

    // ---------- The owner: invitations and access ----------
    createInvitation(req, scope, body) {
      limited(req, `invitations:${scope.householdId}`, inviteLimit);
      const name = cleanDisplayName(body.name);
      if (!name) throw denied(400, 'invalid_name', 'Give the invitation a name (up to 40 characters).');
      if (!['adult', 'child'].includes(body.role)) throw denied(400, 'invalid_role', 'Choose Adult or Child.');
      const t = nowMs();
      const { active } = db.prepare("SELECT COUNT(*) AS active FROM memberships WHERE household_id = ? AND access = 'active'").get(scope.householdId);
      const { pending } = db.prepare("SELECT COUNT(*) AS pending FROM invitations WHERE household_id = ? AND status = 'pending' AND expires_at > ?").get(scope.householdId, iso(t));
      if (active + pending >= MAX_MEMBERS) throw denied(409, 'family_full', `A family here has up to ${MAX_MEMBERS} members, counting open invitations.`);
      const token = randomToken(), id = newId('inv');
      db.prepare(`INSERT INTO invitations (id, household_id, token_hash, display_name, role, status, created_by, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(id, scope.householdId, hashToken(token), name, body.role, scope.memberId, iso(t), iso(t + config.inviteMs));
      audit({ householdId: scope.householdId, accountId: scope.accountId, memberId: scope.memberId, action: 'invitation.created', subject: id });
      // The link is shown once. The token travels in the URL fragment, which browsers do not send to servers or in referrers.
      return { invitation: invitationView(db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)), link: `${config.origin}/#invite=${token}` };
    },
    revokeInvitation(scope, invitationId) {
      const changed = db.prepare("UPDATE invitations SET status = 'revoked', revoked_at = ? WHERE id = ? AND household_id = ? AND status = 'pending'")
        .run(iso(), invitationId, scope.householdId).changes;
      if (changed !== 1) throw denied(409, 'invitation_not_pending', 'Only an invitation that is still waiting can be withdrawn.');
      audit({ householdId: scope.householdId, accountId: scope.accountId, memberId: scope.memberId, action: 'invitation.revoked', subject: invitationId });
      return { revoked: true };
    },
    revokeMember(scope, memberId) {
      const target = db.prepare('SELECT * FROM memberships WHERE member_id = ? AND household_id = ?').get(memberId, scope.householdId);
      if (!target) throw denied(404, 'not_found', 'Family member not found.');
      if (target.is_owner === 1 || memberId === scope.memberId) throw denied(409, 'owner_required', 'The family owner keeps access; nobody can remove it.');
      if (target.access !== 'active') throw denied(409, 'already_revoked', 'This member no longer has access.');
      transaction(db, () => {
        db.prepare("UPDATE memberships SET access = 'revoked', revoked_at = ? WHERE member_id = ?").run(iso(), memberId);
        db.prepare("UPDATE sessions SET revoked_at = ?, revoke_reason = 'access_revoked' WHERE member_id = ? AND revoked_at IS NULL").run(iso(), memberId);
        audit({ householdId: scope.householdId, accountId: scope.accountId, memberId: scope.memberId, action: 'member.access_revoked', subject: memberId });
      });
      events.memberRevoked?.(memberId);
      return { revoked: true };
    },

    /** What the signed-in member sees about the family: who is in it and, for the owner, the invitations. */
    viewer(scope) {
      const members = db.prepare(`SELECT m.id, m.display_name AS name, m.role, ms.is_owner, ms.access FROM members m
        JOIN memberships ms ON ms.member_id = m.id WHERE m.household_id = ? ORDER BY m.sort`).all(scope.householdId)
        .map((m) => ({ id: m.id, name: m.name, role: m.role, owner: m.is_owner === 1, access: m.access }));
      const invitations = scope.owner
        ? db.prepare('SELECT * FROM invitations WHERE household_id = ? ORDER BY created_at DESC LIMIT 20').all(scope.householdId).map(invitationView)
        : [];
      return {
        mode: 'family', me: { memberId: scope.memberId, role: scope.role, owner: scope.owner },
        members, invitations,
        passkeys: db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?').get(scope.accountId).n,
        recentlyVerified: nowMs() - Date.parse(scope.verifiedAt) <= config.recentAuthMs,
      };
    },
  };
}
