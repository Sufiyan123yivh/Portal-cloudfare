// /functions/fusion4k.js
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
const TOKEN_CACHE_TTL = 10 * 60 * 1000; // 10 min
let tokenCache = { token: null, expires: 0 };
let channelsCache = { data: null, expires: 0 };
let genresCache = { data: null, expires: 0 };

function buildHeaders(token) {
  return {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `https://${host}/stalker_portal/c/`,
    Authorization: `Bearer ${token}`,
    Cookie: `mac=${config.mac}; stb_lang=en; timezone=GMT`,
  };
}

async function fetchInfo(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  try {
    return { data: JSON.parse(text.replace(/^.*?{/, "{")), raw: text };
  } catch {
    return { data: {}, raw: text };
  }
}

async function handshake() {
  const url = `https://${host}/stalker_portal/server/load.php?type=stb&action=handshake&mac=${config.mac}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(""));
  return res.data?.js?.token || "";
}

async function getProfile(token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://${host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${config.sn}&device_id=${config.device_id_1}&device_id2=${config.device_id_2}&signature=${config.sig}&timestamp=${timestamp}&api_signature=${config.api}&JsHttpRequest=1-xml`;
  await fetchInfo(url, buildHeaders(token));
}

async function generateToken() {
  const token = await handshake();
  await getProfile(token);
  tokenCache = { token, expires: Date.now() + TOKEN_CACHE_TTL };
  return token;
}

async function getToken(force = false) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  return await generateToken();
}

async function safeFetch(fn) {
  try {
    const token = await getToken();
    return await fn(token);
  } catch (err) {
    const token = await getToken(true);
    return await fn(token);
  }
}

async function getAllChannels(token) {
  if (channelsCache.data && Date.now() < channelsCache.expires) return channelsCache.data;
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  if (!res.data?.js?.data) throw new Error("Invalid channel data");
  channelsCache = { data: res.data.js.data, expires: Date.now() + TOKEN_CACHE_TTL };
  return res.data.js.data;
}

async function getGenres(token) {
  if (genresCache.data && Date.now() < genresCache.expires) return genresCache.data;
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  const map = {};
  for (const g of res.data?.js || []) if (g.id !== "*") map[g.id] = g.title;
  genresCache = { data: map, expires: Date.now() + TOKEN_CACHE_TTL };
  return map;
}

async function getStreamUrl(token, cmd) {
  const encoded = encodeURIComponent(cmd);
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encoded}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  return res.data?.js?.cmd || null;
}

function getLogo(logo) {
  if (!logo || (!logo.endsWith(".png") && !logo.endsWith(".jpg")))
    return "https://i.ibb.co/gLsp7Vrz/x.jpg";
  return `https://${host}/stalker_portal/misc/logos/320/${logo}`;
}

export async function onRequest(context) {
  const { request } = context;
  const urlObj = new URL(request.url);
  const id = urlObj.searchParams.get("id");

  try {
    const baseUrl = `${urlObj.origin}/fusion4k.js`;

    // Direct stream - instant
    if (id) {
      return await safeFetch(async (token) => {
        const cmd = `/ch/${id}`; // generate cmd directly
        const streamUrl = await getStreamUrl(token, cmd);
        if (!streamUrl) return new Response("Failed to fetch stream link", { status: 500 });
        return Response.redirect(streamUrl, 302);
      });
    }

    // Full playlist
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
        "Content-Disposition": 'inline; filename="tatatv.m3u8"',
      },
    });
  } catch (err) {
    console.error("Server error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
