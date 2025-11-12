// /functions/fusion4k.js
// Cloudflare Pages Functions version

export const onRequestGet = async ({ request, env }) => {
  const config = {
    url: "http://tv.stream4k.cc",
    mac: "00:1A:79:00:31:14",
    sn: "12A1BDB0FEA5D",
    device_id_1:
      "1F85A5927EC37F7416495E2BC8E7032988F91D59ADA5B939FA56E7E5D957328D",
    device_id_2:
      "1F85A5927EC37F7416495E2BC8E7032988F91D59ADA5B939FA56E7E5D957328D",
    sig: "",
    api: "263",
  };

  const host = new URL(config.url).host;

  // --- Helper to fetch JSON safely ---
  async function fetchInfo(url, headers = {}) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...headers,
        Cookie: `mac=${config.mac}; stb_lang=en; timezone=GMT`,
      },
    });
    const text = await res.text();
    try {
      return { data: JSON.parse(text), raw: text };
    } catch {
      return { data: {}, raw: text };
    }
  }

  // --- Handshake ---
  async function handshake() {
    const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `http://${host}/stalker_portal/c/`,
      Host: host,
    };
    const res = await fetchInfo(url, headers);
    return {
      token: res.data?.js?.token || "",
      random: res.data?.js?.random || "",
    };
  }

  // --- Re-handshake ---
  async function reGenerateToken(token) {
    const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `http://${host}/stalker_portal/c/`,
      Host: host,
    };
    const res = await fetchInfo(url, headers);
    return res.data?.js?.token || token;
  }

  // --- Get profile ---
  async function getProfile(token) {
    const timestamp = Math.floor(Date.now() / 1000);
    const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${config.sn}&device_id=${config.device_id_1}&device_id2=${config.device_id_2}&signature=${config.sig}&timestamp=${timestamp}&api_signature=${config.api}&JsHttpRequest=1-xml`;
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `http://${host}/stalker_portal/c/`,
      Authorization: `Bearer ${token}`,
      Host: host,
    };
    await fetchInfo(url, headers);
  }

  // --- Token handling using KV-like cache (Memory per request) ---
  let tokenCache = null;

  async function generateToken() {
    const { token } = await handshake();
    const validToken = await reGenerateToken(token);
    await getProfile(validToken);
    tokenCache = validToken;
    return validToken;
  }

  async function getToken(force = false) {
    if (!force && tokenCache) return tokenCache;
    return generateToken();
  }

  // --- Headers builder ---
  function buildHeaders(token) {
    return {
      "User-Agent":
        "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
      "X-User-Agent": "Model: MAG250; Link: WiFi",
      Referer: `http://${host}/stalker_portal/c/`,
      Authorization: `Bearer ${token}`,
      Host: host,
    };
  }

  // --- Safe fetch wrapper ---
  async function safeFetch(fn) {
    try {
      const token = await getToken();
      return await fn(token);
    } catch {
      const token = await getToken(true);
      return await fn(token);
    }
  }

  // --- Get channels ---
  async function getAllChannels(token) {
    const url = `http://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
    const res = await fetchInfo(url, buildHeaders(token));
    if (!res.data?.js?.data) throw new Error("Invalid channel data");
    return res.data.js.data;
  }

  // --- Get genres ---
  async function getGenres(token) {
    const url = `http://${host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
    const res = await fetchInfo(url, buildHeaders(token));
    const arr = res.data?.js || [];
    const map = {};
    for (const g of arr) {
      if (g.id !== "*") map[g.id] = g.title;
    }
    return map;
  }

  // --- Get stream URL ---
  async function getStreamUrl(token, cmd) {
    if (!cmd) return null;
    const encodedCmd = encodeURIComponent(cmd);
    const url = `http://${host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encodedCmd}&JsHttpRequest=1-xml`;
    const res = await fetchInfo(url, buildHeaders(token));
    return res.data?.js?.cmd || null;
  }

  function getLogo(logo) {
    if (!logo || (!logo.endsWith(".png") && !logo.endsWith(".jpg"))) {
      return "https://i.ibb.co/gLsp7Vrz/x.jpg";
    }
    return `http://${host}/stalker_portal/misc/logos/320/${logo}`;
  }

  try {
    const urlObj = new URL(request.url);
    const id = urlObj.searchParams.get("id");

    // Direct stream mode
    if (id) {
      const streamUrl = await safeFetch(async (token) => {
        const channels = await getAllChannels(token);
        const ch = channels.find((c) => c.cmd && c.cmd.includes(`/ch/${id}`));
        if (!ch) return null;
        return await getStreamUrl(token, ch.cmd);
      });

      if (!streamUrl)
        return new Response("Failed to fetch stream link", { status: 500 });

      return Response.redirect(streamUrl, 302);
    }

    // Playlist mode
    const [channels, genres] = await safeFetch(async (token) => {
      const ch = await getAllChannels(token);
      const gr = await getGenres(token);
      return [ch, gr];
    });

    const baseUrl = `${urlObj.origin}/functions/fusion4k`;

    let playlist = `#EXTM3U\n#DATE:- ${new Date().toLocaleString("en-IN")}\n\n`;
    for (const ch of channels) {
      const group = genres[ch.tv_genre_id] || "Others";
      const logo = getLogo(ch.logo);
      const id = ch.cmd.replace("ffrt http://localhost/ch/", "");
      const playUrl = `${baseUrl}?id=${encodeURIComponent(id)}`;
      playlist += `#EXTINF:-1 tvg-id="${id}" tvg-logo="${logo}" group-title="${group}",${ch.name}\n${playUrl}\n\n`;
    }

    return new Response(playlist, {
      headers: {
        "Content-Type": "audio/x-mpegurl",
        "Content-Disposition": 'inline; filename="fusion4k.m3u"',
      },
    });
  } catch (err) {
    console.error(err);
    return new Response("Server Error", { status: 500 });
  }
};
