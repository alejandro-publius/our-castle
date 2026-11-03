/** Original Tiny Castle emblems, plus the Sun Knight's new sun device. */
export const CARD_ART = Object.freeze({
  arthur: {
    accent: "#9e203b",
    halo: "#f09c59",
    emblem: "crown",
  },
  lancelot: {
    accent: "#164fa6",
    halo: "#7ccbd8",
    emblem: "sword",
  },
  guinevere: {
    accent: "#652779",
    halo: "#d893cc",
    emblem: "rose",
  },
  gawain: {
    accent: "#13734d",
    halo: "#b2d76d",
    emblem: "sun",
  },
  merlin: {
    accent: "#3f3392",
    halo: "#7ebbe9",
    emblem: "star",
  },
  golem: {
    accent: "#2c6964",
    halo: "#bdd181",
    emblem: "mountain",
  },
  fae: {
    accent: "#286b3d",
    halo: "#b2d35a",
    emblem: "leaf",
  },
  dragon: {
    accent: "#a43926",
    halo: "#f4ad48",
    emblem: "dragon",
  },
});
const SIGILS = {
  crown:
    '<path d="M22 78 13 34 40 52 60 20 80 52 107 34 98 78Z"/><path d="M24 92H96M28 102H92"/><circle cx="60" cy="65" r="5"/>',
  sword:
    '<path d="m60 12 12 20-7 49H55l-7-49Z"/><path d="M35 77Q60 92 85 77M60 88V105M51 107H69"/>',
  rose: '<path d="M60 100V65M60 87Q29 89 25 69 52 65 60 87M60 78Q86 80 94 59 67 56 60 78"/><path d="M60 17C77 6 89 28 81 39 103 45 91 68 73 63 62 83 40 72 42 58 20 59 19 34 38 31 35 13 54 7 60 17Z"/><path d="M48 34Q72 22 75 44 73 61 53 52 40 46 48 34Z"/>',
  sun: '<circle cx="60" cy="60" r="23"/><path d="M60 8v17M60 95v17M8 60h17M95 60h17M23 23l12 12M85 85l12 12M23 97l12-12M85 35l12-12"/>',
  star: '<path d="m60 16 12 26 29-3-17 23 17 23-29-3-12 26-12-26-29 3 17-23-17-23 29 3Z"/><circle cx="60" cy="62" r="16"/><circle cx="60" cy="62" r="5"/>',
  mountain:
    '<path d="m13 96 30-60 16 24 16-42 33 78ZM34 54l9 10 8-13M65 43l10 9 8-14"/><path d="m49 96 10-36 14 36M30 96l8-17M87 96l-4-18"/>',
  leaf: '<path d="M24 96Q10 37 100 16 105 100 24 96ZM24 96 83 34M44 75 40 51M44 75 73 77M62 57 64 36M62 57 88 58M24 96 16 108"/>',
  dragon:
    '<path d="M24 100Q87 113 85 77L108 61 89 44 86 20 69 35 54 30 60 47 42 54 61 69 74 66Q73 93 49 87L19 62 25 91Z"/><path d="M49 87 14 29 52 47 31 46 42 66M89 44l-8 8M99 70l9 13-17-4"/>',
};
export function cardEmblem(id, className = "card-sigil") {
  return `<svg class="${className}" viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${SIGILS[CARD_ART[id].emblem]}</svg>`;
}
export function decorateCard(node, id) {
  node.style.setProperty("--card-accent", CARD_ART[id].accent);
  node.style.setProperty("--card-halo", CARD_ART[id].halo);
}

const WEAPONS = {
  sword: SIGILS.sword,
  lance: '<path d="M38 109 73 40M68 46l-4-20L94 8 82 42ZM65 59l21 7-9-23"/>',
  shield:
    '<path d="M20 20h80v43Q93 91 60 109 27 91 20 63ZM60 37v47M41 59h38"/>',
  staff:
    '<path d="m31 108 38-71M58 40 48 24 78 7 91 30 72 49ZM48 24l24 25M78 7 69 37"/>',
  fists:
    '<path d="M27 88 15 60l16-7V28h17V19h17v8h17v10h15v39L82 99H43ZM31 53l16 11M48 28v29M65 27v31M82 37v24"/>',
  flame:
    '<path d="M64 9Q83 43 66 56 63 37 50 36 54 61 33 68 24 47 31 39 5 68 28 94 52 119 79 99 117 76 91 46 92 74 75 76 85 45 64 9Z"/>',
  axe: '<path d="m32 111 40-95M52 31Q89 1 108 35L76 62 60 50M45 51 76 62"/>',
  hammer: '<path d="m34 108 34-68M46 13 100 40 81 68 27 41Z"/>',
};
export function equipmentEmblem(gear) {
  return `<svg class="equipment-sigil" viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${WEAPONS[gear]}</svg>`;
}
