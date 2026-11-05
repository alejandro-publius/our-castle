import { FAMILY_AVATARS, memberAvatar, avatarImage } from '../core/avatars.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const portrait = (id, size = 56) => {
  const img = el('img', 'member-portrait');
  img.src = avatarImage(id); img.width = size; img.height = size; img.alt = '';
  return img;
};

/** Cosmetic editing only. Native radio keys, explicit Save, Escape/Cancel and focus return. */
export function createFamilyAvatars(root, { save }) {
  let members = [], editing = null, draft = null, busy = false;
  const heading = el('h4', '', 'Family'); heading.id = 'family-avatar-heading';
  root.setAttribute('aria-labelledby', heading.id);
  const roster = el('div', 'member-roster');
  const form = el('form', 'avatar-picker'); form.id = 'avatar-picker'; form.hidden = true;
  const fieldset = el('fieldset');
  const legend = el('legend'); legend.id = 'avatar-picker-title';
  const choices = el('div', 'avatar-choices');
  const actions = el('div', 'actions');
  const submit = el('button', 'primary', 'Save avatar'); submit.type = 'submit';
  const cancel = el('button', '', 'Cancel'); cancel.type = 'button';
  const status = el('p', 'avatar-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  actions.append(submit, cancel); fieldset.append(legend, choices); form.append(fieldset, actions);
  root.replaceChildren(heading, roster, form, status);

  function renderRoster() {
    heading.textContent = members.length > 1 ? 'Family' : 'Your character';
    roster.replaceChildren(...members.map((member, i) => {
      const avatar = memberAvatar(member, i), button = el('button', 'member-choice');
      button.type = 'button'; button.dataset.member = member.id; button.dataset.avatar = avatar.id;
      button.setAttribute('aria-label', 'Change avatar for ' + member.name + ', current ' + avatar.label);
      button.setAttribute('aria-expanded', String(editing === member.id));
      button.setAttribute('aria-controls', form.id);
      button.title = member.name + ' · ' + avatar.label;
      button.append(portrait(avatar.id), el('span', '', member.name));
      button.addEventListener('click', () => open(member.id));
      return button;
    }));
  }
  function open(id) {
    if (busy) return;
    const member = members.find((m) => m.id === id); if (!member) return;
    editing = id; draft = memberAvatar(member, members.indexOf(member)).id; status.textContent = '';
    legend.textContent = 'Avatar for ' + member.name;
    choices.replaceChildren(...FAMILY_AVATARS.map((avatar) => {
      const label = el('label', 'avatar-option'), input = el('input');
      input.type = 'radio'; input.name = 'memberAvatar'; input.value = avatar.id; input.checked = avatar.id === draft; input.setAttribute('aria-label', avatar.label);
      input.addEventListener('change', () => { draft = avatar.id; });
      const face = el('span', 'avatar-face'); face.append(portrait(avatar.id, 64), el('span', '', avatar.label));
      label.append(input, face); return label;
    }));
    form.hidden = false; renderRoster();
    choices.querySelector('input:checked')?.focus({ preventScroll: true });
    form.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  function close() {
    const id = editing; editing = null; form.hidden = true; renderRoster();
    [...roster.children].find((b) => b.dataset.member === id)?.focus({ preventScroll: true });
  }
  cancel.addEventListener('click', () => { if (!busy) { status.textContent = ''; close(); } });
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); event.stopPropagation(); status.textContent = ''; close(); }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (busy || !editing || !draft) return;
    const member = members.find((m) => m.id === editing);
    if (!member) { close(); return; }
    if (memberAvatar(member, members.indexOf(member)).id === draft) { close(); return; }
    busy = true; fieldset.disabled = true; submit.disabled = true; cancel.disabled = true; status.textContent = '';
    try {
      await save(editing, draft);
      close(); status.textContent = member.name + '’s avatar saved.';
    } catch (error) {
      status.textContent = error.message || 'Could not save. Try again.';
    } finally {
      busy = false; fieldset.disabled = false; submit.disabled = false; cancel.disabled = false;
    }
  });
  return {
    update(nextMembers) {
      members = nextMembers;
      if (editing && !members.some((m) => m.id === editing)) { editing = null; form.hidden = true; }
      renderRoster();
    },
  };
}
