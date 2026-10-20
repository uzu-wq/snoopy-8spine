var _snoopySaavnApi = 'https://saavn.dev/api';
var _snoopySearchCache = {};
var _snoopyMeta = {};

function _snoopyFetch(path, params) {
  var qs = '';
  if (params) {
    var keys = Object.keys(params);
    if (keys.length) {
      qs = '?' + keys.map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
    }
  }

  var opts = { headers: { 'Accept': 'application/json' } };
  try {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      opts.signal = AbortSignal.timeout(15000);
    }
  } catch (e) {}

  return fetch(_snoopySaavnApi + path + qs, opts).then(function(r) {
    if (!r.ok) throw new Error('JioSaavn API HTTP ' + r.status);
    return r.json();
  });
}

function _snoopyUnwrap(payload) {
  if (payload && payload.success === false) {
    throw new Error(payload.message || 'JioSaavn API returned an error');
  }
  return payload && payload.data !== undefined ? payload.data : payload;
}

function _snoopyText() {
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function _snoopyImage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    if (!value.length) return '';
    var preferred = null;
    for (var i = 0; i < value.length; i++) {
      var quality = String(value[i] && (value[i].quality || value[i].resolution) || '').toLowerCase();
      if (quality === '500x500' || quality === 'high' || quality === 'high quality') {
        preferred = value[i];
      }
    }
    var chosen = preferred || value[value.length - 1];
    return chosen ? _snoopyText(chosen.url, chosen.link) : '';
  }
  if (typeof value === 'object') {
    var keys = Object.keys(value);
    var preference = ['quality_500', 'quality_320', 'quality_150', '500x500', 'high', 'url'];
    for (var j = 0; j < preference.length; j++) {
      if (value[preference[j]]) return value[preference[j]];
    }
    return keys.length ? value[keys[keys.length - 1]] : '';
  }
  return '';
}

function _snoopyArtist(item) {
  var artists = item && item.artists;
  if (artists && Array.isArray(artists.primary)) {
    return artists.primary.map(function(a) { return a && a.name; }).filter(Boolean).join(', ');
  }
  if (Array.isArray(item && item.primaryArtists)) {
    return item.primaryArtists.map(function(a) {
      return typeof a === 'string' ? a : a && a.name;
    }).filter(Boolean).join(', ');
  }
  return _snoopyText(
    item && item.artist,
    item && item.primaryArtists,
    item && item.music,
    artists && artists.name,
    typeof artists === 'string' ? artists : ''
  ) || 'Unknown Artist';
}

function _snoopyNormalizeTrack(item) {
  item = item || {};
  var albumValue = item.album;
  var album = typeof albumValue === 'string'
    ? albumValue
    : _snoopyText(albumValue && albumValue.name, item.albumName, item.album_name);
  var id = _snoopyText(item.id, item.songId, item.song_id, item.perma_url);
  var title = _snoopyText(item.name, item.title, item.song, item.song_name) || 'Unknown Track';
  var track = {
    id: String(id),
    title: title,
    artist: _snoopyArtist(item),
    album: album,
    duration: Number(item.duration || item.durationInSeconds || item.song_duration || 0),
    albumCover: _snoopyImage(item.image || item.images || item.artworkURL || item.song_image),
    source: 'snoopy-jiosaavn',
    explicit: !!item.explicit
  };
  if (item.url || item.perma_url || item.song_link) {
    track.url = item.url || item.perma_url || item.song_link;
  }
  return track;
}

function _snoopyResults(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.songs)) return data.songs;
  if (data && data.songs && Array.isArray(data.songs.results)) return data.songs.results;
  if (data && Array.isArray(data.tracks)) return data.tracks;
  return [];
}

function _snoopyDownloadUrl(song, quality) {
  var downloads = song && (song.downloadUrl || song.download_url || song.media);
  if (typeof downloads === 'string') return downloads;
  if (!downloads) return '';

  if (Array.isArray(downloads)) {
    var wanted = String(quality || 'HIGH').toUpperCase();
    var preferred = wanted === 'LOW'
      ? ['96kbps', '48kbps', '12kbps']
      : ['320kbps', '160kbps', '96kbps', '48kbps'];
    for (var i = 0; i < preferred.length; i++) {
      for (var j = 0; j < downloads.length; j++) {
        if (String(downloads[j] && downloads[j].quality || '').toLowerCase() === preferred[i]) {
          return downloads[j].url || downloads[j].link || '';
        }
      }
    }
    for (var k = 0; k < downloads.length; k++) {
      if (downloads[k] && (downloads[k].url || downloads[k].link)) {
        return downloads[k].url || downloads[k].link;
      }
    }
    return '';
  }

  var keys = Object.keys(downloads);
  var wantedKeys = String(quality || 'HIGH').toUpperCase() === 'LOW'
    ? ['quality_96', 'quality_48', 'low', 'medium']
    : ['quality_320', 'quality_160', 'quality_128', 'high', 'medium'];
  for (var n = 0; n < wantedKeys.length; n++) {
    if (downloads[wantedKeys[n]]) return downloads[wantedKeys[n]];
  }
  for (var p = 0; p < keys.length; p++) {
    if (typeof downloads[keys[p]] === 'string' && /^https?:\/\//i.test(downloads[keys[p]])) {
      return downloads[keys[p]];
    }
  }
  return '';
}

async function _snoopySearchTracks(query, limit) {
  var q = String(query || '').trim();
  if (!q) return { tracks: [], total: 0 };

  var lim = Math.max(1, Math.min(Number(limit) || 20, 50));
  var cacheKey = q.toLowerCase() + '|' + lim;
  var cached = _snoopySearchCache[cacheKey];
  if (cached && Date.now() - cached.time < 45000) return cached.value;

  try {
    var payload = await _snoopyFetch('/search/songs', {
      query: q,
      limit: lim,
      page: 1
    });
    var data = _snoopyUnwrap(payload);
    var results = _snoopyResults(data);
    var tracks = results.map(_snoopyNormalizeTrack).filter(function(t) {
      return !!(t.id && t.title);
    });

    tracks.forEach(function(track) {
      _snoopyMeta[track.id] = track;
    });

    var value = {
      tracks: tracks,
      total: Number(data && (data.total || data.count)) || tracks.length
    };
    _snoopySearchCache[cacheKey] = { time: Date.now(), value: value };
    return value;
  } catch (e) {
    return { tracks: [], total: 0 };
  }
}

async function _snoopyGetTrackStreamUrl(trackId, quality) {
  var id = String(trackId || '').trim();
  if (!id) return { streamUrl: null, track: { id: id, audioQuality: 'HIGH' } };

  try {
    var payload = await _snoopyFetch('/songs', { id: id });
    var data = _snoopyUnwrap(payload);
    var song = Array.isArray(data) ? data[0] : (data && data.songs && data.songs[0] ? data.songs[0] : data);
    if (!song) throw new Error('Track not found');

    var streamUrl = _snoopyDownloadUrl(song, quality);
    if (!streamUrl) {
      var normalizedSong = _snoopyNormalizeTrack(song);
      if (normalizedSong.url && /^https?:\/\//i.test(normalizedSong.url)) {
        streamUrl = '';
      }
    }

    if (!streamUrl) {
      return {
        streamUrl: null,
        track: Object.assign({}, _snoopyMeta[id] || _snoopyNormalizeTrack(song), {
          id: id,
          audioQuality: String(quality || 'HIGH').toUpperCase()
        })
      };
    }

    var metadata = _snoopyMeta[id] || _snoopyNormalizeTrack(song);
    return {
      streamUrl: streamUrl,
      downloadUrl: streamUrl,
      mimeType: /\.m3u8(\?|$)/i.test(streamUrl) ? 'application/vnd.apple.mpegurl' : 'audio/mp4',
      streamType: /\.m3u8(\?|$)/i.test(streamUrl) ? 'hls' : 'direct',
      track: Object.assign({}, metadata, {
        id: id,
        audioQuality: String(quality || 'HIGH').toUpperCase()
      })
    };
  } catch (e) {
    return {
      streamUrl: null,
      track: Object.assign({}, _snoopyMeta[id] || { id: id }, {
        audioQuality: String(quality || 'HIGH').toUpperCase()
      })
    };
  }
}

async function _snoopyGetAlbum(albumId) {
  var id = String(albumId || '').trim();
  if (!id) return { album: null, tracks: [] };

  try {
    var payload = await _snoopyFetch('/albums', { id: id });
    var data = _snoopyUnwrap(payload);
    var album = Array.isArray(data) ? data[0] : data;
    if (!album) return { album: null, tracks: [] };

    var tracks = _snoopyResults({ results: album.songs || album.tracks || [] })
      .map(_snoopyNormalizeTrack)
      .filter(function(t) { return !!(t.id && t.title); });

    tracks.forEach(function(track) {
      _snoopyMeta[track.id] = track;
    });

    return {
      album: {
        id: String(album.id || id),
        title: _snoopyText(album.name, album.title) || 'Unknown Album',
        artist: _snoopyArtist(album),
        cover: _snoopyImage(album.image || album.images || album.artworkURL),
        year: album.year || ''
      },
      tracks: tracks
    };
  } catch (e) {
    return { album: null, tracks: [] };
  }
}

return {
  id: 'snoopy-jiosaavn',
  name: 'Snoopy Shit',
  version: '1.0.2',
  labels: ['JioSaavn', 'MP4', 'STREAMING'],
  noStreamCache: true,
  searchTracks: _snoopySearchTracks,
  getTrackStreamUrl: _snoopyGetTrackStreamUrl,
  getTrackDownloadUrl: _snoopyGetTrackStreamUrl,
  getAlbum: _snoopyGetAlbum
};
