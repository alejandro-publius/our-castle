// Bundled original recordings; credits, licences and hashes live in assets/music.
// The browser only requests the recording it is about to play after opt-in.
const recording = (id, title, artist, path, type = 'audio/mpeg') => Object.freeze({
  id, title, artist, url: `/assets/music/${path}`, type, volume: .16,
});
export const MUSIC = Object.freeze({
  village: recording('village', 'Peaceful Village', 'HydroGene', 'hydrogene/peaceful-village.mp3'),
  farm: recording('farm', 'Farm Life', 'Bert Cole', 'bitbybit/farm-life.ogg', 'audio/ogg; codecs="vorbis"'),
  woodland: recording('woodland', 'Wood Forest Town', 'HydroGene', 'hydrogene/wood-forest-town.mp3'),
  forest: recording('forest', 'Spirits Forest', 'HydroGene', 'hydrogene/spirits-forest.mp3'),
  library: recording('library', 'Ancient Library', 'HydroGene', 'hydrogene/ancient-library.mp3'),
  shop: recording('shop', 'Welcome to the Item Shop', 'congusbongus', 'welcome-to-the-item-shop.mp3'),
});

export function tracksForRealm({ period, district }) {
  if (period === 'night') return [MUSIC.library, MUSIC.forest, MUSIC.woodland];
  if (district === 'market') return [MUSIC.shop, MUSIC.farm, MUSIC.village];
  if (['garden', 'knights-rest', 'lantern-glade', 'sword-stone', 'family-project'].includes(district))
    return [MUSIC.woodland, MUSIC.forest, MUSIC.village];
  return [MUSIC.village, MUSIC.farm, MUSIC.woodland, MUSIC.shop];
}
