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

    // 1️⃣ KV kontrolü (aynı görev halen çalışıyor mu?)
    const trackingUrl = await env.FCE_KV.get(kvKey);
    if (trackingUrl) {
      return new Response(`\n\nTrack progress: ${trackingUrl}\n`, { status: 200 });
    }

    // 2️⃣ Release kontrolü
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

    // 2.5️⃣ v.json kontrolü
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const found = Object.entries(data).find(([key]) => key.startsWith(name));
        if (found) {
          const [, values] = found;
          if (values[`${get}_zip`] === "false") {
            return new Response("❌ Requested image not found.", { status: 404 });
          }
        }
      }
    } catch (e) {}

    // 3️⃣ Dispatch ve Polling ile takip
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/runs`, {
      expirationTtl: 120
    });

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
      const TRACK_URL = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/runs`;

      const pollingLimit = 12; // 12 * 5s = 60s
      for (let i = 0; i < pollingLimit; i++) {
        await new Promise(r => setTimeout(r, 5000)); // 5 saniye bekle

        const trackRes = await fetch(TRACK_URL, {
          method: "GET",
          headers: {
            Authorization: `token ${env.GTKK}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "FCE Worker"
          }
        });

        if (trackRes.ok) {
          const data = await trackRes.json();
          const run = data.workflow_runs.find(w => w.head_branch === "main" && w.name === track);

          if (run && run.status === "completed") {
            if (run.conclusion === "success") {
              return new Response(`✅ Track complete for ${name} [${get}]. Check release.`, { status: 200 });
            } else if (run.conclusion === "failure") {
              return new Response(`❌ Requested image (${get}) not found or failed.`, { status: 404 });
            }
          }
        }
      }

      return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
        status: 202
      });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
