export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing required 'url' or 'get' parameter", { status: 400 });
    }

    const allowedGets = ["boot_img", "recovery_img"];
    if (!allowedGets.includes(get)) {
      return new Response(`Only these values are allowed for 'get': ${allowedGets.join(", ")}`, { status: 400 });
    }

    const domains = [
      "ultimateota.d.miui.com",
      "superota.d.miui.com",
      "bigota.d.miui.com",
      "cdnorg.d.miui.com",
      "bn.d.miui.com",
      "hugeota.d.miui.com",
      "cdn-ota.azureedge.net",
      "airtel.bigota.d.miui.com",
    ];

    if (!url.includes(".zip")) {
      return new Response("Only .zip URLs are supported", { status: 400 });
    }

    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    const Name = url.split("/").pop().replace(".zip", "");
    const cacheKey = `${Name}_${get}`;

    // 1. KV’de varsa (başarılı link) → doğrudan dön
    const kvValue = await env.FCE_KV.get(cacheKey);
    if (kvValue && kvValue !== "processing") {
      return new Response(`link: ${kvValue}`, { status: 200 });
    }

    // 2. Eğer hâlâ işleniyor durumundaysa beklet
    if (kvValue === "processing") {
      return new Response("Currently processing, please wait...", { status: 202 });
    }

    // 3. Release'te varsa (v.json üzerinden kontrol)
    try {
      const vJsonRes = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      const vData = await vJsonRes.json();
      if (vData[Name] && vData[Name][`${get}_zip`] === "true" && vData[Name][`${get}_link`]) {
        await env.FCE_KV.put(cacheKey, vData[Name][`${get}_link`]); // kalıcı olarak kaydet
        return new Response(`link: ${vData[Name][`${get}_link`]}`, { status: 200 });
      }
    } catch (err) {
      // v.json hatası varsa geç
    }

    // 4. Eğer yukarıdakilerin hiçbiri değilse → yeni görev başlat
    await env.FCE_KV.put(cacheKey, "processing", { expirationTtl: 180 }); // geçici flag (3 dakika)

    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Cloudflare Worker",
    };

    const BaseUrl = "https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml";
    const githubDispatchUrl = `${BaseUrl}/dispatches`;
    const TRACK_URL = `${BaseUrl}/runs`;

    const track = Date.now().toString();
    const data = {
      ref: "main",
      inputs: { url, track, get },
    };

    try {
      const githubResponse = await fetch(githubDispatchUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data),
      });

      if (githubResponse.ok) {
        // kullanıcıya takip bağlantısını döndür
        return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
          status: 200,
        });
      } else {
        const githubError = await githubResponse.text();
        return new Response(`GitHub Response Error: ${githubError}`, { status: 500 });
      }
    } catch (error) {
      return new Response(`Dispatch Error: ${error.message}`, { status: 500 });
    }
  },
};
