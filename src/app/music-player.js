// One lazily-created native media element: no overlap, streaming service or timer.
// Changing the realm only affects the choice after the current recording ends.
export function createMusicPlayer({ getTracks, createAudio, isHidden, onError, onTrack = () => {} }) {
  let audio = null, track = null, wanted = false, generation = 0, reload = false;
  let sequence = 0;
  const lastPlayed = new Map();

  function volume() {
    if (!audio || !track) return;
    const seconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const duration = audio.duration;
    const fade = Number.isFinite(duration) ? Math.max(.01, Math.min(.8, duration / 4)) : .8;
    const start = Math.min(1, Math.max(0, seconds / fade));
    const end = Number.isFinite(duration) ? Math.min(1, Math.max(0, (duration - seconds) / fade)) : 1;
    audio.volume = (track.volume ?? .16) * Math.min(start, end);
  }

  function fail(message) {
    pause();
    onError(message);
  }

  function ensureAudio() {
    if (audio) return;
    audio = createAudio();
    audio.preload = 'none'; audio.loop = false; audio.muted = true; audio.volume = 0;
    audio.addEventListener('timeupdate', volume);
    audio.addEventListener('loadedmetadata', volume);
    audio.addEventListener('ended', () => {
      if (!wanted || isHidden() || !audio.ended) return;
      if (loadNext()) play();
    });
    audio.addEventListener('error', () => {
      if (!wanted || !audio.error) return;
      reload = true;
      fail('Sound could not start. Try the Sound button again.');
    });
  }

  function load(recording) {
    generation++;
    track = recording; reload = false;
    audio.muted = true; audio.volume = 0;
    audio.src = recording.url;
    audio.load();
  }

  function loadNext() {
    const playable = getTracks().filter(item => audio.canPlayType(item.type));
    // Least recently played avoids immediate repeats and still rotates fairly
    // after moving between the village, forest, market and night playlists.
    const next = playable.reduce((best, item) => !best || (lastPlayed.get(item.id) ?? -1) < (lastPlayed.get(best.id) ?? -1) ? item : best, null);
    if (!next) { fail('Music is unavailable in this browser.'); return false; }
    lastPlayed.set(next.id, sequence++);
    load(next);
    return true;
  }

  function play() {
    if (!wanted || isHidden()) return;
    const request = ++generation, current = track;
    audio.muted = false; volume();
    try {
      Promise.resolve(audio.play()).then(() => {
        // A late completion cannot restart an off/hidden page. An older play
        // resolving after a newer, deliberate resume must not pause that resume.
        if (!wanted || isHidden()) { audio.muted = true; audio.pause(); }
        else if (request === generation) onTrack(current);
      }).catch(() => {
        if (request === generation && wanted && !isHidden())
          fail('Sound could not start. Try the Sound button again.');
      });
    } catch { fail('Sound is unavailable in this browser.'); }
  }

  function pause() {
    wanted = false; generation++;
    if (audio) { audio.muted = true; audio.pause(); }
  }

  return {
    resume() {
      wanted = true;
      if (isHidden()) return;
      try {
        ensureAudio();
        if (!track || audio.ended) { if (!loadNext()) return; }
        else if (reload) load(track);
        play();
      } catch { fail('Sound is unavailable in this browser.'); }
    },
    pause,
    current: () => track,
  };
}
