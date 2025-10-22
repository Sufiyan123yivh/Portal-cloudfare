// /functions/fusion4k.js
// Compatible with Cloudflare Pages Functions

const config = {
  url: "https://tatatv.cc/stalker_portal/c/",
  mac: "00:1A:79:00:13:DA",
  sn: "8DC34D20E1021",
  device_id_1:
    "04AAC14D19D6184933091188770C419C0FB2D744BF402A8F56C6654A3A9CAA43",
  device_id_2:
    "04AAC14D19D6184933091188770C419C0FB2D744BF402A8F56C6654A3A9CAA43",
  sig: "",
  api: "263",
};

const host = new URL(config.url).host;

// Simple KV-like cache (runtime only)
const tokenCache = new Map();

// Helper to fetch JSON safely
async function fetchInfo(url, headers) {
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

// Handshake
async function handshake() {
  const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
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

// Re-handshake
async function reGenerateToken(token) {
  const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `http://${host}/stalker_portal/c/`,
    Host: host,
  };
  const res = await fetchInfo(url, headers);
  return res.data?.js?.token || token;
}

// Get profile
async function getProfile(token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `http://${host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${config.sn}&device_id=${config.device_id_1}&device_id2=${config.device_id_2}&signature=${config.sig}&timestamp=${timestamp}&api_signature=${config.api}&JsHttpRequest=1-xml`;
  const headers = buildHeaders(token);
  await fetchInfo(url, headers);
}

// Generate new token
async function generateToken() {
  const { token } = await handshake();
  const validToken = await reGenerateToken(token);
  await getProfile(validToken);
  tokenCache.set(host, validToken);
  return validToken;
}

// Get token (auto-refresh)
async function getToken(forceRefresh = false) {
  const cached = tokenCache.get(host);
  if (!forceRefresh && cached) return cached;
  return await generateToken();
}

// Headers builder
function buildHeaders(token) {
  return {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `http://${host}/stalker_portal/c/`,
    Authorization: `Bearer ${token}`,
    Host: host,
  };
}

// Safe fetch wrapper
async function safeFetch(fetchFn) {
  try {
    const token = await getToken();
    return await fetchFn(token);
  } catch (err) {
    console.log("Token expired or failed, regenerating...");
    const token = await getToken(true);
    return await fetchFn(token);
  }
}

// Get all channels
async function getAllChannels(token) {
  const url = `http://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  if (!res.data?.js?.data) throw new Error("Invalid channel data");
  return res.data.js.data;
}

// Get genres
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

// Get stream URL (cmd)
async function getStreamUrl(token, cmd) {
  if (!cmd) return null;
  const encodedCmd = encodeURIComponent(cmd);
  const url = `http://${host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encodedCmd}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  return res.data?.js?.cmd || null;
}

// Logo fix
function getLogo(logo) {
  if (!logo || (!logo.endsWith(".png") && !logo.endsWith(".jpg"))) {
    return "https://i.ibb.co/gLsp7Vrz/x.jpg";
  }
  return `http://${host}/stalker_portal/misc/logos/320/${logo}`;
}

// Cloudflare Pages API handler
export async function onRequest(context) {
  const { request } = context;
  const urlObj = new URL(request.url);

  try {
    const baseUrl = `${urlObj.origin}/api/fusion4k`;

    // If ?id=... present → redirect to stream
    const channelId = urlObj.searchParams.get("id");
    if (channelId) {
      const streamUrl = await safeFetch(async (token) => {
        const channels = await getAllChannels(token);
        const ch = channels.find((c) => c.cmd && c.cmd.includes(`/ch/${channelId}`));
        if (!ch) return null;
        return await getStreamUrl(token, ch.cmd);
      });
      if (!streamUrl)
        return new Response("Failed to fetch stream link", { status: 500 });
      return Response.redirect(streamUrl, 302);
    }

    // Otherwise → return full M3U playlist
    const [channels, genres] = await safeFetch(async (token) => {
      const ch = await getAllChannels(token);
      const gr = await getGenres(token);
      return [ch, gr];
    });

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
        "Content-Disposition": 'inline; filename="playlist.m3u"',
      },
    });
  } catch (err) {
    console.error(err);
    return new Response("Server error", { status: 500 });
  }
}
