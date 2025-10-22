// /functions/tatatv.mjs
export const onRequest = async (context) => {
  const { request } = context;
  const urlObj = new URL(request.url);
  const id = urlObj.searchParams.get("id");

  // ⚙️ Configuration
  const config = {
    baseUrl: "https://tatatv.cc/stalker_portal",
    mac: "00:1A:79:00:13:DA",
  };

  // 🧠 In-memory token cache (no KV)
  let globalThisCache = globalThis.__tatatvCache || {
    token: null,
    expires: 0,
  };
  globalThis.__tatatvCache = globalThisCache;

  // Fetch helper
  async function fetchInfo(url, headers) {
    const res = await fetch(url, { headers });
    const text = await res.text();
    try {
      return JSON.parse(text.replace(/^.*?{/, "{"));
    } catch {
      return {};
    }
  }

  // Get or refresh token
  async function getValidToken(forceRefresh = false) {
    const now = Date.now();

    // ✅ Use cached token if still valid
    if (!forceRefresh && globalThisCache.token && now < globalThisCache.expires) {
      return globalThisCache.token;
    }

    console.log("🔄 Generating new token...");
    const handshakeUrl = `${config.baseUrl}/server/load.php?type=stb&action=handshake&mac=${config.mac}&JsHttpRequest=1-xml`;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `${config.baseUrl}/c/`,
    };

    const data = await fetchInfo(handshakeUrl, headers);
    const token = data?.js?.token || "";
    globalThisCache.token = token;
    globalThisCache.expires = now + 4 * 3600 * 1000; // valid for 4 hours
    return token;
  }

  // Auto-refresh wrapper
  async function withToken(callback) {
    try {
      const token = await getValidToken();
      return await callback(token);
    } catch (err) {
      console.log("⚠️ Token failed, retrying...");
      const token = await getValidToken(true);
      return await callback(token);
    }
  }

  // Build headers
  function buildHeaders(token) {
    return {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `${config.baseUrl}/c/`,
      Authorization: `Bearer ${token}`,
    };
  }

  // Get all channels
  async function getAllChannels(token) {
    const url = `${config.baseUrl}/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
    const data = await fetchInfo(url, buildHeaders(token));
    return data?.js?.data || [];
  }

  // Get genres
  async function getGenres(token) {
    const url = `${config.baseUrl}/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    const data = await fetchInfo(url, buildHeaders(token));
    const genres = {};
    for (const g of data?.js || []) {
      if (g.id !== "*") genres[g.id] = g.title;
    }
    return genres;
  }

  // Get stream URL
  async function getStreamUrl(token, cmd) {
    const encodedCmd = encodeURIComponent(cmd);
    const url = `${config.baseUrl}/server/load.php?type=itv&action=create_link&cmd=${encodedCmd}&JsHttpRequest=1-xml`;
    const data = await fetchInfo(url, buildHeaders(token));
    return data?.js?.cmd || null;
  }

  // Fallback logo
  function getLogo(logo) {
    if (!logo) return "https://i.ibb.co/gLsp7Vrz/x.jpg";
    return `${config.baseUrl}/misc/logos/320/${logo}`;
  }

  // 🎬 If ?id= present → stream link redirect
  if (id) {
    return await withToken(async (token) => {
      const channels = await getAllChannels(token);
      const ch = channels.find((c) => c.cmd?.includes(`/ch/${id}`));
      if (!ch) return new Response("Channel not found", { status: 404 });

      const streamUrl = await getStreamUrl(token, ch.cmd);
      if (!streamUrl)
        return new Response("Failed to fetch stream link", { status: 500 });

      return Response.redirect(streamUrl, 302);
    });
  }

  // 📺 If no ?id= → return full playlist
  return await withToken(async (token) => {
    const [channels, genres] = await Promise.all([
      getAllChannels(token),
      getGenres(token),
    ]);

    let playlist = `#EXTM3U\n#DATE:- ${new Date().toLocaleString("en-IN")}\n\n`;

    for (const ch of channels) {
      const group = genres[ch.tv_genre_id] || "Others";
      const logo = getLogo(ch.logo);
      const id = ch.cmd.replace("ffrt http://localhost/ch/", "");
      const playUrl = `${urlObj.origin}/tatatv.m3u8?id=${encodeURIComponent(id)}`;
      playlist += `#EXTINF:-1 tvg-id="${id}" tvg-logo="${logo}" group-title="${group}",${ch.name}\n${playUrl}\n\n`;
    }

    return new Response(playlist, {
      headers: {
        "Content-Type": "audio/x-mpegurl",
        "Content-Disposition": 'inline; filename="tatatv.m3u8"',
      },
    });
  });
};
