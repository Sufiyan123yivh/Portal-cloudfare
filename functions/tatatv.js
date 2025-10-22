// /functions/fusion4k.js
// Cloudflare Pages version with detailed error logging

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
const tokenCache = new Map();

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

async function handshake() {
  const url = `https://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=&JsHttpRequest=1-xml`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `https://${host}/stalker_portal/c/`,
  };
  const res = await fetchInfo(url, headers);
  console.log("Handshake:", res.raw);
  return res.data?.js?.token || "";
}

async function reGenerateToken(token) {
  const url = `https://${host}/stalker_portal/server/load.php?type=stb&action=handshake&token=${token}&JsHttpRequest=1-xml`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `https://${host}/stalker_portal/c/`,
  };
  const res = await fetchInfo(url, headers);
  console.log("ReHandshake:", res.raw);
  return res.data?.js?.token || token;
}

async function getProfile(token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `https://${host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${config.sn}&device_id=${config.device_id_1}&device_id2=${config.device_id_2}&signature=${config.sig}&timestamp=${timestamp}&api_signature=${config.api}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  console.log("Profile:", res.raw);
}

async function generateToken() {
  const token = await handshake();
  const validToken = await reGenerateToken(token);
  await getProfile(validToken);
  tokenCache.set(host, validToken);
  return validToken;
}

async function getToken(force = false) {
  const cached = tokenCache.get(host);
  if (!force && cached) return cached;
  return await generateToken();
}

function buildHeaders(token) {
  return {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `https://${host}/stalker_portal/c/`,
    Authorization: `Bearer ${token}`,
  };
}

async function safeFetch(fn) {
  try {
    const token = await getToken();
    return await fn(token);
  } catch (err) {
    console.log("Retrying with new token:", err);
    const token = await getToken(true);
    return await fn(token);
  }
}

async function getAllChannels(token) {
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  if (!res.data?.js?.data) throw new Error(res.raw || "Invalid channel data");
  return res.data.js.data;
}

async function getGenres(token) {
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  const arr = res.data?.js || [];
  const map = {};
  for (const g of arr) {
    if (g.id !== "*") map[g.id] = g.title;
  }
  return map;
}

async function getStreamUrl(token, cmd) {
  const encoded = encodeURIComponent(cmd);
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encoded}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  console.log("CreateLink:", res.raw);
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
  try {
    const baseUrl = `${urlObj.origin}/api/fusion4k`;
    const id = urlObj.searchParams.get("id");

    // Direct stream
    if (id) {
      return await safeFetch(async (token) => {
        const channels = await getAllChannels(token);
        const ch = channels.find((c) => c.cmd?.includes(`/ch/${id}`));
        if (!ch)
          return new Response(
            JSON.stringify({ error: "Channel not found", id }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          );

        const streamUrl = await getStreamUrl(token, ch.cmd);
        if (!streamUrl)
          return new Response(
            JSON.stringify({ error: "Failed to create link", channel: ch }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );

        return Response.redirect(streamUrl, 302);
      });
    }

    // Playlist
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
    console.error("Server error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
