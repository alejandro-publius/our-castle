import { CREST_CHARGES, CREST_FIELDS } from '../core/rules.js';

// Household crest: heater shield, dark contour, double gold frame and a single charge.
// Crown and leaf adapt the owner's original sigil paths (references/source/heraldry.reference.js);
// stag and tower are new for Our House. Families share one crest; there are no opposing armies.
const CHARGES = {
  crown: '<path d="M22 78 13 34 40 52 60 20 80 52 107 34 98 78Z"/><path d="M24 92H96M28 102H92"/><circle cx="60" cy="65" r="5"/>',
  leaf: '<path d="M24 96Q10 37 100 16 105 100 24 96ZM24 96 83 34M44 75 40 51M44 75 73 77M62 57 64 36M62 57 88 58M24 96 16 108"/>',
  stag: '<path d="M60 108 46 72Q44 60 52 54H68Q76 60 74 72Z"/><path d="M51 58 36 52M69 58 84 52"/><path d="M53 54Q46 34 32 16M46 38 28 36M40 28 46 12M67 54Q74 34 88 16M74 38 92 36M80 28 74 12"/><circle cx="54" cy="72" r="2.5"/><circle cx="66" cy="72" r="2.5"/>',
  tower: '<path d="M36 108V46H84V108Z"/><path d="M31 46V28H43V36H54V28H66V36H77V28H89V46"/><path d="M52 108V86Q60 76 68 86V108"/><path d="M56 58H64V68H56Z"/>',
};
const SHIELD = 'M10 8H110V62C110 100 84 122 60 134 36 122 10 100 10 62Z';
const INNER = 'M19 17H101V62C101 94 80 113 60 124 40 113 19 94 19 62Z';
let serial = 0;

export function crestSvg({ field, charge }, { title = '', className = 'crest' } = {}) {
  const fieldHex = CREST_FIELDS[field]?.hex ?? CREST_FIELDS.cobalt.hex;
  const chargePaths = CHARGES[charge] ?? CHARGES.stag;
  const id = `crest-${++serial}`;
  const label = title ? `<title>${escapeXml(title)}</title>` : '';
  return `<svg class="${className}" viewBox="0 0 120 142" ${title ? 'role="img"' : 'aria-hidden="true" focusable="false"'}>${label}
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>
    <path d="${SHIELD}" fill="${fieldHex}" stroke="#142c34" stroke-width="7" stroke-linejoin="round"/>
    <path d="${SHIELD}" fill="url(#${id})"/>
    <path d="${SHIELD}" fill="none" stroke="#DDBA79" stroke-width="3.5" stroke-linejoin="round" transform="translate(60 71) scale(.93) translate(-60 -71)"/>
    <path d="${INNER}" fill="none" stroke="#e3ba72" stroke-width="2" stroke-linejoin="round" opacity=".9"/>
    <g transform="translate(26 34) scale(.57)" fill="none" stroke="#142c34" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" opacity=".55">${chargePaths}</g>
    <g transform="translate(26 32) scale(.57)" fill="none" stroke="#f3d48f" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">${chargePaths}</g>
  </svg>`;
}

export function chargeIcon(charge) {
  return `<svg class="charge-icon" viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${CHARGES[charge]}</svg>`;
}

export const crestChoices = {
  fields: Object.entries(CREST_FIELDS).map(([key, v]) => ({ key, ...v })),
  charges: Object.entries(CREST_CHARGES).map(([key, label]) => ({ key, label })),
};

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
