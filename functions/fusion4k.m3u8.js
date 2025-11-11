
// /functions/fusion4k.js
const config = {
  url: "http://tv.stream4k.cc/",
  mac: "00:1A:79:7F:0C:2C",
  sn: "34B7721BF84DD",
  device_id_1:
    "EB1729D3A7D23E502EEF473848A7DEC8B1C234DE5318093C6616A6464BCD6BA8",
  device_id_2:
    "EB1729D3A7D23E502EEF473848A7DEC8B1C234DE5318093C6616A6464BCD6BA8",
  sig: "",
  api: "263",
};

const host = new URL(config.url).host;

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

async function getToken() {
  const token = await handshake();
  await getProfile(token);
  return token;
}

async function getAllChannels(token) {
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  if (!res.data?.js?.data) throw new Error("Invalid channel data");
  return res.data.js.data;
}

async function getGenres(token) {
  const url = `https://${host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  const map = {};
  for (const g of res.data?.js || []) if (g.id !== "*") map[g.id] = g.title;
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
    const baseUrl = `${urlObj.origin}/tatatv.m3u8`;

    // Direct stream
    if (id) {
      const token = await getToken();
      const cmd = `/ch/${id}`;
      const streamUrl = await getStreamUrl(token, cmd);
      if (!streamUrl) return new Response("Failed to fetch stream link", { status: 500 });
      return Response.redirect(streamUrl, 302);
    }

    // Full playlist
    const token = await getToken();
    const [channels, genres] = await Promise.all([getAllChannels(token), getGenres(token)]);

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
