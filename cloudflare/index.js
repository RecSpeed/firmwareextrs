export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

    // 🔁 Domain override işlemi (miui CDN'leri tek CDN'e yönlendiriliyor)
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

    // 🌐 URL formatını normalize et
    if (!url.includes(".zip")) {
      return new Response("Only .zip URLs are supported.", { status: 400 });
    }
    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");

    // 🔍 1. KV kontrolü (işlem zaten başlatılmış mı?)
    const kvKey = `${get}:${name}`;
    const trackingUrl = await env.FCE_KV.get(kvKey);
    if (trackingUrl) {
      return new Response(`\n\nTrack progress: ${trackingUrl}\n`, { status: 200 });
    }

    // 🔍 2. GitHub Release'de var mı?
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const expectedName = `${get}_${name}.zip`;
      const asset = release.assets.find(a => a.name === expectedName);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 🧠 3. Yeni görev tetikle → KV'ye geçici olarak kaydet (2 dakika TTL)
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/runs`, {
      expirationTtl: 120
    });

    // 🚀 GitHub Actions tetikleme
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
          track,
          get
        }
      })
    });

    if (dispatchRes.ok) {
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/runs`, { status: 200 });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
}
