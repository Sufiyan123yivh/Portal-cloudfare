// /functions/fusion4k.js
const config = {
  url: "http://tv.stream4k.cc/",
  mac: "00:1A:79:00:31:14",
  sn: "12A1BDB0FEA5D",
  device_id_1: "1F85A5927EC37F7416495E2BC8E7032988F91D59ADA5B939FA56E7E5D957328D",
  device_id_2: "1F85A5927EC37F7416495E2BC8E7032988F91D59ADA5B939FA56E7E5D957328D",
  sig: "",
  api: "263",
};

const scheme = config.url.startsWith("https") ? "https" : "http";
const host = new URL(config.url).host;

function buildHeaders(token) {
  return {
    "User-Agent":
      "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250 stbapp ver:2 rev:250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    Referer: `${scheme}://${host}/stalker_portal/c/`,
    Authorization: token ? `Bearer ${token}` : "",
    Cookie: `mac=${config.mac}; stb_lang=en; timezone=GMT`,
  };
}

async function fetchInfo(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data = {};
  try {
    const jsonStart = text.indexOf('{');
    if (jsonStart !== -1) data = JSON.parse(text.slice(jsonStart));
  } catch (e) {
    console.log("⚠️ JSON parse error:", e.message);
  }
  return { data, raw: text };
}

async function handshake() {
  const url = `${scheme}://${host}/stalker_portal/server/load.php?type=stb&action=handshake&mac=${config.mac}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(""));
  return res.data?.js?.token || "";
}

async function getProfile(token) {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = `${scheme}://${host}/stalker_portal/server/load.php?type=stb&action=get_profile&sn=${config.sn}&device_id=${config.device_id_1}&device_id2=${config.device_id_2}&signature=${config.sig}&timestamp=${timestamp}&api_signature=${config.api}&JsHttpRequest=1-xml`;
  await fetchInfo(url, buildHeaders(token));
}

async function getToken() {
  const token = await handshake();
  await getProfile(token);
  return token;
}

async function getAllChannels(token) {
  const url = `${scheme}://${host}/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  if (!res.data?.js?.data) throw new Error("Invalid channel data: " + res.raw.slice(0, 200));
  return res.data.js.data;
}

async function getGenres(token) {
  const url = `${scheme}://${host}/stalker_portal/server/load.php?type=itv&action=get_genres&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  const map = {};
  for (const g of res.data?.js || []) if (g.id !== "*") map[g.id] = g.title;
  return map;
}

async function getStreamUrl(token, cmd) {
  const encoded = encodeURIComponent(cmd);
  const url = `${scheme}://${host}/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encoded}&JsHttpRequest=1-xml`;
  const res = await fetchInfo(url, buildHeaders(token));
  return res.data?.js?.cmd || null;
}

function getLogo(logo) {
  if (!logo || (!logo.endsWith(".png") && !logo.endsWith(".jpg")))
    return "https://i.ibb.co/gLsp7Vrz/x.jpg";
  return `${scheme}://${host}/stalker_portal/misc/logos/320/${logo}`;
}

export async function onRequest(context) {
  const { request } = context;
  const urlObj = new URL(request.url);
  const id = urlObj.searchParams.get("id");

  try {
    const baseUrl = `${urlObj.origin}/tatatv.m3u8`;

    if (id) {
      const token = await getToken();
      const cmd = `/ch/${id}`;
      const streamUrl = await getStreamUrl(token, cmd);
      if (!streamUrl) throw new Error("Failed to fetch stream link");
      return Response.redirect(streamUrl, 302);
    }

    const token = await getToken();
    const [channels, genres] = await Promise.all([getAllChannels(token), getGenres(token)]);

    let playlist = `#EXTM3U\n#DATE:- ${new Date().toLocaleString("en-IN")}\n\n`;
    for (const ch of channels) {
      const group = genres[ch.tv_genre_id] || "Others";
      const logo = getLogo(ch.logo);
      const id = ch.cmd.split("/ch/").pop().replace(/\D+$/, "");
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
    console.error("❌ Server error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
