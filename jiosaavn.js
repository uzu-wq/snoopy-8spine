const API_BASE = 'https://saavn.dev/api';

const requestJson = async (url) => {
    const response = await fetch(url, {
        headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
        throw new Error('JioSaavn request failed with HTTP ' + response.status);
    }

    return response.json();
};

const unwrap = (payload) => {
    if (payload && payload.success === false) {
        throw new Error(payload.message || 'JioSaavn API returned an error');
    }
    return payload && payload.data !== undefined ? payload.data : payload;
};

const firstText = (...values) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
};

const imageUrl = (images) => {
    if (typeof images === 'string') return images;
    if (!Array.isArray(images) || images.length === 0) return '';
    const preferred = images.find((item) => item && (item.quality === '500x500' || item.quality === 'high'));
    const chosen = preferred || images[images.length - 1];
    return chosen && (chosen.url || chosen.link) || '';
};

const normalizeTrack = (item) => {
    const artists = item.artists || {};
    const primaryArtists = Array.isArray(artists.primary)
        ? artists.primary.map((artist) => artist.name).filter(Boolean).join(', ')
        : '';
    const artist = firstText(
        item.artist,
        item.primaryArtists,
        primaryArtists,
        typeof artists === 'string' ? artists : '',
        'Unknown Artist'
    );
    const album = typeof item.album === 'string'
        ? item.album
        : firstText(item.album && item.album.name, item.albumName);
    const cover = imageUrl(item.image || item.images || item.albumCover);
    return {
        id: String(item.id || item.songId || item.perma_url || item.url || ''),
        title: firstText(item.name, item.title, item.song, 'Unknown Track'),
        artist,
        album,
        duration: Number(item.duration || item.durationInSeconds || 0),
        albumCover: cover,
        source: 'jiosaavn'
    };
};

const findAudioUrl = (data, quality) => {
    const links = data && (data.downloadUrl || data.download_url || data.media);
    if (typeof links === 'string') return links;
    if (!Array.isArray(links) || links.length === 0) return '';

    const wanted = String(quality || 'HIGH').toUpperCase();
    const preferredQualities = wanted === 'LOW'
        ? ['96kbps', '48kbps', '12kbps']
        : wanted === 'LOSSLESS'
            ? ['320kbps', '160kbps', '96kbps']
            : ['320kbps', '160kbps', '96kbps', '48kbps'];

    for (const preferred of preferredQualities) {
        const match = links.find((item) => String(item.quality || '').toLowerCase() === preferred.toLowerCase());
        if (match && (match.url || match.link)) return match.url || match.link;
    }

    const last = links.find((item) => item && (item.url || item.link));
    return last ? (last.url || last.link) : '';
};

return {
    id: 'jiosaavn',
    name: 'JioSaavn',
    version: '1.0.0',
    labels: ['JioSaavn', 'Search', 'Streaming'],

    searchTracks: async (query, limit = 20) => {
        const term = String(query || '').trim();
        if (!term) return { tracks: [], total: 0 };

        const count = Math.max(1, Math.min(Number(limit) || 20, 50));
        const url = API_BASE + '/search/songs?query=' + encodeURIComponent(term) + '&limit=' + count;
        const payload = await requestJson(url);
        const data = unwrap(payload);
        const results = Array.isArray(data)
            ? data
            : Array.isArray(data.results)
                ? data.results
                : Array.isArray(data.songs)
                    ? data.songs
                    : [];

        const tracks = results
            .map(normalizeTrack)
            .filter((track) => track.id && track.title);

        return { tracks, total: Number(data.total || tracks.length) };
    },

    getTrackStreamUrl: async (trackId, quality = 'HIGH') => {
        const id = String(trackId || '').trim();
        if (!id) throw new Error('A JioSaavn track ID is required');

        const payload = await requestJson(API_BASE + '/songs?id=' + encodeURIComponent(id));
        const data = unwrap(payload);
        const song = Array.isArray(data) ? data[0] : (data.song || data);
        const streamUrl = findAudioUrl(song, quality);

        if (!streamUrl) {
            throw new Error('JioSaavn did not return a playable audio URL for this track');
        }

        const normalized = normalizeTrack(song);
        return {
            streamUrl,
            track: {
                id: normalized.id || id,
                title: normalized.title,
                artist: normalized.artist,
                album: normalized.album,
                duration: normalized.duration,
                albumCover: normalized.albumCover,
                audioQuality: String(quality || 'HIGH').toUpperCase()
            }
        };
    },

    getAlbum: async (albumId) => {
        const id = String(albumId || '').trim();
        if (!id) throw new Error('A JioSaavn album ID is required');

        const payload = await requestJson(API_BASE + '/albums?id=' + encodeURIComponent(id));
        const data = unwrap(payload);
        const album = Array.isArray(data) ? data[0] : data;
        const items = album && (album.songs || album.tracks) || [];
        return {
            album: {
                id: String(album.id || id),
                title: firstText(album.name, album.title, 'Unknown Album'),
                artist: firstText(album.primaryArtists, album.artist),
                albumCover: imageUrl(album.image || album.images)
            },
            tracks: items.map(normalizeTrack).filter((track) => track.id && track.title)
        };
    }
};
