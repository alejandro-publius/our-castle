// Family access in the page: the sign-in dialog (passkey sign-in, starting a family, accepting an invitation) and the
// House section for invitations, access and this member's own passkeys. The server decides everything; this file only
// asks. Passkeys go through SimpleWebAuthn's browser helper, loaded only here. After any sign-in or sign-out the page
// reloads, so nothing from a previous household or member stays on screen.
import { api } from './api.js';

const $ = (selector) => document.querySelector(selector);
function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
  return node;
}
const roleLabel = (role) => (role === 'adult' ? 'Adult' : 'Child');
const day = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

let helper = null;
function passkeys() {
  helper ??= new Promise((resolve, reject) => {
    if (window.SimpleWebAuthnBrowser) return resolve(window.SimpleWebAuthnBrowser);
    const script = document.createElement('script');
    script.src = 'vendor/simplewebauthn/browser.umd.min.js';
    script.onload = () => (window.SimpleWebAuthnBrowser ? resolve(window.SimpleWebAuthnBrowser) : reject(new Error('Passkey support could not load.')));
    script.onerror = () => { helper = null; reject(new Error('Passkey support could not load. Check the connection and try again.')); };
    document.head.append(script);
  });
  return helper;
}
// What the browser's passkey prompt said, in plain words. Cancelling is normal and saves nothing.
function ceremonyMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'AbortError') return 'The passkey request was cancelled or timed out. Nothing was saved.';
  if (error?.name === 'InvalidStateError') return 'This device already has a passkey for this family. Sign in with it instead.';
  if (error?.name === 'NotSupportedError' || error?.name === 'SecurityError') return 'This browser or device cannot use a passkey here. Try a current browser on a device with a screen lock.';
  return error?.message || 'Something went wrong. Nothing was saved; try again.';
}
const reload = () => location.replace(location.pathname);

/** The sign-in dialog. `invitationToken` (from the link's #invite= fragment) opens the invitation step directly. */
export function createAccessDialog({ signedIn: startSignedIn = false } = {}) {
  let signedIn = startSignedIn;
  const dialog = $('#access-dialog'), body = $('#access-body'), title = $('#access-title'), status = $('#access-status');
  let step = 'choose', busy = false, invitation = null, token = null;
  const say = (text, kind = 'error') => { status.textContent = text; status.dataset.kind = kind; };
  const setBusy = (on) => { busy = on; for (const b of body.querySelectorAll('button, input')) b.disabled = on || b.dataset.unsupported === 'true'; };

  async function run(task) {
    if (busy) return;
    setBusy(true); say('Waiting for your passkey…', 'working');
    try { await task(); } catch (error) { say(error.status ? error.message : ceremonyMessage(error)); setBusy(false); }
  }
  const signIn = () => run(async () => {
    const browser = await passkeys();
    const { options, ceremonyId } = await api.post('/api/auth/signin/options', {});
    const response = await browser.startAuthentication({ optionsJSON: options });
    await api.post('/api/auth/signin/verify', { ceremonyId, response });
    say('Signed in.', 'ok'); reload();
  });
  const createFamily = (name) => run(async () => {
    const browser = await passkeys();
    const { options, ceremonyId } = await api.post('/api/auth/family/options', { displayName: name });
    const response = await browser.startRegistration({ optionsJSON: options });
    await api.post('/api/auth/family/verify', { ceremonyId, response });
    say('Your family is ready.', 'ok'); reload();
  });
  const join = () => run(async () => {
    const browser = await passkeys();
    const { options, ceremonyId } = await api.post('/api/auth/invitation/options', { token });
    const response = await browser.startRegistration({ optionsJSON: options });
    await api.post('/api/auth/invitation/verify', { token, ceremonyId, response });
    say('Welcome to the family.', 'ok'); reload();
  });

  function render() {
    status.textContent = '';
    if (step === 'invite' && invitation) {
      title.textContent = `Join ${invitation.familyName}`;
      body.replaceChildren(
        h('p', {}, `You are invited as ${invitation.name} · ${roleLabel(invitation.role)}. This browser will create a passkey that signs you in as ${invitation.name}.`),
        h('p', { class: 'fine' }, `The invitation can be used once, until ${day(invitation.expiresAt)}.`),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary', id: 'access-join', onclick: join }, 'Create passkey and join'),
          h('button', { type: 'button', class: 'link-button', onclick: () => go(signedIn ? null : 'choose') }, 'Not now')));
    } else if (step === 'create') {
      title.textContent = 'Start a family';
      const input = h('input', { id: 'access-name', type: 'text', maxlength: 40, autocomplete: 'name', required: true });
      body.replaceChildren(
        h('form', { class: 'access-form', novalidate: true, onsubmit: (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (!name) { input.setAttribute('aria-invalid', 'true'); say('Enter your name.'); input.focus(); return; }
          input.removeAttribute('aria-invalid'); createFamily(name);
        } },
          h('label', { class: 'field' }, h('span', {}, 'Your name'), input),
          h('p', { class: 'fine' }, 'Your device creates a passkey for you. You can then invite the rest of your family from House.'),
          h('div', { class: 'actions' },
            h('button', { type: 'submit', class: 'primary', id: 'access-create' }, 'Create passkey and family'),
            h('button', { type: 'button', class: 'link-button', onclick: () => go('choose') }, 'Back'))));
    } else {
      title.textContent = 'Our Castle';
      body.replaceChildren(
        h('p', {}, 'Sign in with your passkey to see your family’s realm.'),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'primary', id: 'access-signin', onclick: signIn }, 'Sign in with a passkey'),
          h('button', { type: 'button', class: 'link-button', id: 'access-start', onclick: () => go('create') }, 'Start a new family')),
        h('p', { class: 'fine' }, 'Joining a family? Open the invitation link they sent you.'));
    }
    unsupported();
  }
  function unsupported() {
    if (window.PublicKeyCredential) return;
    for (const b of body.querySelectorAll('button.primary')) { b.disabled = true; b.dataset.unsupported = 'true'; }
    say('This browser cannot use passkeys. Open Our Castle in a current browser on a device with a screen lock.');
  }
  function go(next) {
    if (busy) return;
    if (next === null) { dialog.close(); return; }
    step = next; render(); title.focus();
  }
  // Escape steps back; at the first step there is nothing behind the dialog to return to unless already signed in.
  dialog.addEventListener('cancel', (e) => {
    if (busy) { e.preventDefault(); return; }
    if (step !== 'choose') { e.preventDefault(); go(step === 'invite' && signedIn ? null : 'choose'); }
    else if (!signedIn) e.preventDefault();
  });

  return {
    async open({ message = '', invite = null, signedIn: now = signedIn } = {}) {
      signedIn = now; token = invite;
      if (token) {
        try { ({ invitation } = await api.post('/api/auth/invitation', { token })); step = 'invite'; }
        catch (error) { invitation = null; step = 'choose'; render(); if (!dialog.open) dialog.showModal(); say(error.message); title.focus(); return; }
      } else step = 'choose';
      render();
      if (!dialog.open) dialog.showModal();
      if (message) say(message, 'info');
      title.focus();
    },
  };
}

/** House: who is in the family, the owner's invitations and access, and this member's passkeys and sign-out. */
let lastKey = null, lastLink = null;
export function renderFamilyAccess(state, { onState, onStatus }) {
  const box = $('#family-access'), access = state.access;
  box.hidden = !access;
  if (!access) return;
  // A quiet refresh must not wipe what the owner is typing: re-render only when the family's access changed, and keep
  // the half-typed invitation and the link just created (memory only; a reload forgets it).
  const key = JSON.stringify(access);
  if (key === lastKey) return;
  lastKey = key;
  const typed = { name: $('#invite-name')?.value ?? '', role: $('#invite-role')?.value ?? 'adult', focused: document.activeElement?.id };
  const me = access.members.find((m) => m.id === access.me.memberId);
  const parts = [];
  const act = (label, fn, attrs = {}) => h('button', { type: 'button', class: 'link-button', ...attrs, onclick: async (e) => {
    const button = e.currentTarget; button.disabled = true;
    try { await fn(); } catch (error) { onStatus('error', error.message); } finally { if (button.isConnected) button.disabled = false; }
  } }, label);

  if (access.me.owner) {
    const name = h('input', { id: 'invite-name', type: 'text', maxlength: 40, autocomplete: 'off', required: true });
    const role = h('select', { id: 'invite-role' }, h('option', { value: 'adult' }, 'Adult'), h('option', { value: 'child' }, 'Child'));
    const result = h('div', { class: 'invite-result', id: 'invite-result', hidden: true });
    const form = h('form', { class: 'invite-form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); onStatus('error', 'Give the invitation a name.'); name.focus(); return; }
      name.removeAttribute('aria-invalid');
      const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
      try {
        const res = await api.post('/api/family/invitations', { name: name.value.trim(), role: role.value });
        name.value = '';
        lastLink = { invitation: res.invitation, link: res.link };
        onState(res.state);
        showLink(res.invitation, res.link);
      } catch (error) { onStatus('error', error.message); } finally { submit.disabled = false; }
    } },
      h('label', { class: 'field invite-name' }, h('span', {}, 'Name'), name),
      h('label', { class: 'field invite-role' }, h('span', {}, 'Can'), role),
      h('div', { class: 'actions' }, h('button', { type: 'submit' }, 'Create invitation')));
    parts.push(h('h4', { id: 'invite-heading' }, 'Invite to the family'), form, result);
    const list = access.invitations.filter((i) => i.status !== 'accepted');
    if (list.length) parts.push(h('ul', { class: 'access-list', 'aria-label': 'Invitations' }, list.map((i) => h('li', { 'data-invitation': i.id, 'data-status': i.status },
      h('span', {}, `${i.name} · ${roleLabel(i.role)} · `, { pending: `waiting until ${day(i.expiresAt)}`, expired: 'expired', revoked: 'withdrawn' }[i.status]),
      i.status === 'pending' && act('Withdraw', async () => onState((await api.post(`/api/family/invitations/${encodeURIComponent(i.id)}/revoke`, {})).state), { 'aria-label': `Withdraw the invitation for ${i.name}` })))));
  }
  const others = access.members.filter((m) => m.id !== access.me.memberId);
  if (others.length) parts.push(h('ul', { class: 'access-list', 'aria-label': 'Family members' }, others.map((m) => h('li', { 'data-member': m.id, 'data-access': m.access },
    h('span', {}, `${m.name} · ${roleLabel(m.role)}${m.owner ? ' · owner' : ''}${m.access === 'revoked' ? ' · no access' : ''}`),
    access.me.owner && !m.owner && m.access === 'active' && act('Remove access', async () => onState((await api.post(`/api/family/members/${encodeURIComponent(m.id)}/revoke`, {})).state), { 'aria-label': `Remove ${m.name}'s access` })))));
  parts.push(h('p', { class: 'access-me' }, `Signed in as ${me?.name ?? 'you'} · ${roleLabel(access.me.role)}${access.me.owner ? ' · owner' : ''} · ${access.passkeys} passkey${access.passkeys === 1 ? '' : 's'}`),
    h('div', { class: 'actions' },
      act('Add a passkey', async () => {
        const browser = await passkeys();
        let started;
        try { started = await api.post('/api/auth/passkeys/options', {}); }
        catch (error) { if (error.code === 'reauth_required') { onStatus('info', error.message); return; } throw error; }
        let response;
        try { response = await browser.startRegistration({ optionsJSON: started.options }); } catch (error) { onStatus('info', ceremonyMessage(error)); return; }
        const res = await api.post('/api/auth/passkeys/verify', { ceremonyId: started.ceremonyId, response });
        onStatus('ok', `Passkey added. You have ${res.passkeys}.`);
        onState(await api.get('/api/state'));
      }, { id: 'add-passkey' }),
      act('Sign out', async () => { await api.post('/api/auth/signout', {}); reload(); }, { id: 'sign-out' })));
  box.replaceChildren(...parts);
  if ($('#invite-name')) { $('#invite-name').value = typed.name; $('#invite-role').value = typed.role; }
  if (typed.focused && ['invite-name', 'invite-role'].includes(typed.focused)) $(`#${typed.focused}`)?.focus();
  const still = lastLink && access.invitations.find((i) => i.id === lastLink.invitation.id && i.status === 'pending');
  if (still) showLink(lastLink.invitation, lastLink.link, { focus: false }); else lastLink = null;

  function showLink(invitation, link, { focus = true } = {}) {
    lastLink = { invitation, link };
    const result = $('#invite-result');
    const field = h('input', { id: 'invite-link', type: 'text', readonly: true, value: link, 'aria-label': `Invitation link for ${invitation.name}` });
    result.replaceChildren(
      h('p', {}, `Send this link to ${invitation.name} yourself. It works once, until ${day(invitation.expiresAt)}.`),
      field,
      h('div', { class: 'actions' }, h('button', { type: 'button', id: 'copy-invite', onclick: async (e) => {
        field.select();
        try { await navigator.clipboard.writeText(link); e.currentTarget.textContent = 'Copied'; } catch { e.currentTarget.textContent = 'Select and copy'; }
      } }, 'Copy link')));
    result.hidden = false;
    if (focus) { field.focus(); field.select(); }
  }
}
