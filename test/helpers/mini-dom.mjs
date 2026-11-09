// A minimal DOM for running one page module in Node, with no browser: only what src/app/kit-list.js uses (elements,
// text, attributes, hidden/disabled/value, events, focus and a few simple selectors). The document holds one block of
// the page's own markup (index.html), so a test drives the real element ids, nesting and starting state.
// It is not a general HTML parser: it reads the plain markup of that block and refuses anything it does not support.
import { readFileSync } from 'node:fs';

const PAGE = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (text) => text.replace(/&([a-z]+|#\d+);/g, (whole, name) => {
  if (!(name in ENTITIES)) throw new Error(`mini-dom: unsupported entity ${whole}`);
  return ENTITIES[name];
});
const dataAttribute = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class MiniNode {
  parentNode = null;
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node instanceof MiniDocument;
  }
}

export class MiniText extends MiniNode {
  constructor(text) { super(); this.data = String(text); }
  get textContent() { return this.data; }
}

function* descendants(parent) {
  for (const node of parent.childNodes) {
    if (!(node instanceof MiniElement)) continue;
    yield node;
    yield* descendants(node);
  }
}

// Only the selector forms the page module uses: tag, [attribute], [attribute="value"] and tag[attribute="value"].
function matcher(selector) {
  const m = /^([a-z][a-z0-9]*)?(?:\[([a-z][a-z0-9-]*)(?:="([^"]*)")?\])?$/.exec(selector);
  if (!m || (!m[1] && !m[2])) throw new Error(`mini-dom: unsupported selector ${selector}`);
  const [, tag, name, value] = m;
  return (el) => (!tag || el.localName === tag) && (!name || (value === undefined ? el.hasAttribute(name) : el.getAttribute(name) === value));
}

export class MiniElement extends MiniNode {
  #attributes = new Map();
  #listeners = new Map();
  #value = null;
  constructor(ownerDocument, localName) {
    super();
    this.ownerDocument = ownerDocument;
    this.localName = localName.toLowerCase();
    this.childNodes = [];
    this.dataset = new Proxy({}, {
      get: (_, key) => (typeof key === 'string' ? this.getAttribute(dataAttribute(key)) ?? undefined : undefined),
      set: (_, key, value) => { this.setAttribute(dataAttribute(key), value); return true; },
    });
  }
  get tagName() { return this.localName.toUpperCase(); }
  getAttribute(name) { return this.#attributes.get(name) ?? null; }
  setAttribute(name, value) { this.#attributes.set(name, String(value)); }
  removeAttribute(name) { this.#attributes.delete(name); }
  hasAttribute(name) { return this.#attributes.has(name); }
  get id() { return this.getAttribute('id') ?? ''; }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(on) { if (on) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(on) { if (on) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get src() { return this.getAttribute('src') ?? ''; }
  set src(value) { this.setAttribute('src', value); }
  // A field's current value: what was typed or set, otherwise its default from the markup.
  get value() { return this.#value ?? (this.localName === 'textarea' ? this.textContent : this.getAttribute('value') ?? ''); }
  set value(value) { this.#value = String(value); }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }
  set textContent(text) { this.replaceChildren(...(String(text) ? [String(text)] : [])); }

  append(...items) {
    for (const item of items) {
      const node = item instanceof MiniNode ? item : new MiniText(item);
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...items) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...items);
    // As in a browser, focus that was inside the removed nodes returns to the body.
    const doc = this.ownerDocument;
    if (!doc.activeElement.isConnected) doc.activeElement = doc.body;
  }

  addEventListener(type, listener) {
    if (!this.#listeners.has(type)) this.#listeners.set(type, []);
    this.#listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    const delivered = { ...event, target: this, currentTarget: this, preventDefault() {} };
    for (const listener of this.#listeners.get(event.type) ?? []) listener(delivered);
    return true;
  }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click' }); }

  // Laid out on the page: connected, with no hidden element on the way up (hidden is display: none) and not inside a
  // closed <details> other than as its summary.
  get offsetParent() {
    if (!this.isConnected) return null;
    for (let node = this; node instanceof MiniElement; node = node.parentNode) {
      if (node.hidden) return null;
      const parent = node.parentNode;
      if (parent instanceof MiniElement && parent.localName === 'details' && !parent.hasAttribute('open') && node.localName !== 'summary') return null;
    }
    return this.parentNode instanceof MiniElement ? this.parentNode : null;
  }
  focus() { if (this.offsetParent) this.ownerDocument.activeElement = this; }

  querySelectorAll(selector) { const matches = matcher(selector); return [...descendants(this)].filter(matches); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

export class MiniDocument extends MiniNode {
  constructor() {
    super();
    this.body = new MiniElement(this, 'body');
    this.body.parentNode = this;
    this.activeElement = this.body;
  }
  createElement(localName) { return new MiniElement(this, localName); }
  getElementById(id) {
    for (const el of descendants(this.body)) if (el.id === id) return el;
    return null;
  }
}

// Start tags with double-quoted or bare attributes, end tags, comments and text: the plain markup of the page's blocks.
const TOKEN = /<!--[\s\S]*?-->|<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"]*")?)*)\s*\/?>|([^<]+)/y;

/** A new document whose body holds the element of index.html with this id, and everything inside it. */
export function documentFromPage(id, html = PAGE) {
  const at = html.indexOf(` id="${id}"`);
  const open = html.lastIndexOf('<', at);
  if (at < 0 || open < 0) throw new Error(`mini-dom: index.html has no element with id ${id}`);
  const doc = new MiniDocument();
  const stack = [doc.body];
  TOKEN.lastIndex = open;
  do {
    const from = TOKEN.lastIndex;
    const token = TOKEN.exec(html);
    if (!token) throw new Error(`mini-dom: unsupported markup at offset ${from} of index.html`);
    const [, end, tag, attributes, text] = token;
    if (text !== undefined) stack.at(-1).append(decode(text));
    else if (tag) {
      const el = doc.createElement(tag);
      for (const [, name, value] of attributes.matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g)) el.setAttribute(name, decode(value ?? ''));
      stack.at(-1).append(el);
      if (!VOID.has(el.localName)) stack.push(el);
    } else if (end) {
      if (stack.at(-1).localName !== end) throw new Error(`mini-dom: </${end}> does not close <${stack.at(-1).localName}> in index.html`);
      stack.pop();
    }
  } while (stack.length > 1);
  return doc;
}
