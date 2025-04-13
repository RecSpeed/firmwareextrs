export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

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
    const key = `${get}:${name}`;

    // 1️⃣ KV üzerinden işlem durumu kontrolü
    const status = await env.FCE_KV.get(key);
    if (status === "pending") {
      return new Response(`⏳ Process already running.\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, { status: 202 });
    }

    if (status === "done") {
      const dlLink = `https://github.com/RecSpeed/firmwareextrs/releases/download/auto/${get}_${name}.zip`;
      return new Response(`link: ${dlLink}`, { status: 200 });
    }

    if (status === "fail") {
      return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
    }

    // 2️⃣ Yeni işlem başlatılıyor → 'pending' olarak KV’ye yaz
    await env.FCE_KV.put(key, "pending", { expirationTtl: 180 });

    // 3️⃣ GitHub Actions Dispatch tetikleme
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
          track: key
        }
      })
    });

    if (dispatchRes.ok) {
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
        status: 202
      });
    }

    const err = await dispatchRes.text();
    await env.FCE_KV.delete(key); // hata varsa kilidi kaldır
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
