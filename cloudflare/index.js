export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

    // CDN yönlendirme
    const domains = [
      "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com", "cdnorg.d.miui.com",
      "bn.d.miui.com", "hugeota.d.miui.com", "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
    ];
    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    if (!url.includes(".zip")) {
      return new Response("Only .zip URLs are supported.", { status: 400 });
    }

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const kvKey = `${get}:${name}`;

    // 🔍 Öncelikle v.json kontrolü yapılmalı
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const found = Object.entries(data).find(([key]) => key.startsWith(name));
        if (found) {
          const [, values] = found;
          if (values[`${get}_zip`] === "false") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          }
          if (values[`${get}_zip`] === "true" && values[`${get}_link`]) {
            return new Response(`link: ${values[`${get}_link`]}`, { status: 200 });
          }
        }
      }
    } catch (e) {
      // sessizce geç
    }



    // 2️⃣ Release'de varsa link ver
    const rel = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (rel.ok) {
      const json = await rel.json();
      const asset = json.assets.find(a => a.name === `${get}_${name}.zip`);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 3️⃣ v.json kontrolü - başarısız mıydı?
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const entry = Object.entries(data).find(([key]) => key.startsWith(name));
        if (entry) {
          const [, values] = entry;
          if (values[`${get}_zip`] === "false") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          }
        }
      }
    } catch (e) {
      // ignore v.json error
    }

        // 🔁 1. KV kontrolü (aynı görev halen çalışıyor mu?)
    const trackingUrl = await env.FCE_KV.get(kvKey);
    if (trackingUrl) {
      return new Response(`\n\nTrack progress: ${trackingUrl}\n`, { status: 200 });
    }

    
    // 4️⃣ İşlem başlatılmamış, şimdi başlat → track bilgisi verip çık
    const trackId = Date.now().toString();
    const runUrl = `https://github.com/RecSpeed/firmwareextrs/actions`; // gösterilecek sayfa

    await env.FCE_KV.put(kvKey, runUrl, { expirationTtl: 120 });

    const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "FCE Worker"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          url,
          get,
          track: trackId
        }
      })
    });

    if (dispatchRes.ok) {
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: ${runUrl}`, {
        status: 200
      });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
