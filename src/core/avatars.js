// Original cosmetic identities. Appearance never changes membership, approval or rewards.
export const FAMILY_AVATARS = Object.freeze([
  { id: 'ranger', label: 'Ranger', skin: 0xc38d6d, hair: 0x513b35, cloth: 0x527557, trim: 0xddba79, kind: 'hood' },
  { id: 'knight', label: 'Knight', skin: 0xd9a67f, hair: 0x493c38, cloth: 0x355f93, trim: 0xacb7a2, kind: 'helm' },
  { id: 'royal', label: 'Royal', skin: 0x93664f, hair: 0x302e36, cloth: 0xad5770, trim: 0xddba79, kind: 'crown' },
  { id: 'wizard', label: 'Wizard', skin: 0xd9a67f, hair: 0xded6b8, cloth: 0x777099, trim: 0xddba79, kind: 'hat' },
  { id: 'gardener', label: 'Gardener', skin: 0xe3bc91, hair: 0x65402e, cloth: 0x86a56c, trim: 0xeddcb4, kind: 'straw' },
  { id: 'bard', label: 'Bard', skin: 0x93664f, hair: 0x302e36, cloth: 0x9d3e46, trim: 0xddba79, kind: 'beret' },
  { id: 'scholar', label: 'Scholar', skin: 0xc38d6d, hair: 0x513b35, cloth: 0x355f93, trim: 0xeddcb4, kind: 'book' },
  { id: 'explorer', label: 'Explorer', skin: 0xe3bc91, hair: 0x9e714b, cloth: 0x425b47, trim: 0xeddcb4, kind: 'scarf' },
].map(Object.freeze));
const byId = new Map(FAMILY_AVATARS.map((a) => [a.id, a]));
export const avatarById = (id) => byId.get(id) ?? null;
const defaults = ['ranger', 'bard', 'scholar', 'knight', 'royal', 'gardener', 'wizard', 'explorer'];
export const memberAvatar = (member, index = 0) => avatarById(member?.avatarId) ?? byId.get(defaults[Math.abs(index) % defaults.length]);
export const avatarImage = (id) => '/assets/member-avatars/' + (avatarById(id)?.id ?? 'ranger') + '.png';
