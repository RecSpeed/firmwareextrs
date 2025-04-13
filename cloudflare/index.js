export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

    // 🌐 CDN yönlendirmesi
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

    // 1️⃣ v.json kontrolü
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const entry = data[name];
        if (entry) {
          if (entry[`${get}_zip`] === "false") {
            return new Response(`❌ Already checked. ${get} not found.`, { status: 404 });
          }
          if (entry[`${get}_zip`] === "true" && entry[`${get}_link`]) {
            return new Response(`link: ${entry[`${get}_link`]}`, { status: 200 });
          }
        }
      }
    } catch (_) {}

    // 2️⃣ Release kontrolü (v.json'da eksikse fallback)
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

    // 3️⃣ Daha önce başlatıldı mı?
    const lastTrack = await env.FCE_KV.get(kvKey);
    if (lastTrack) {
      // PCE sonucu tamamlandıysa durumuna göre karar ver
      const runsRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `token ${env.GTKK}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (runsRes.ok) {
        const runs = await runsRes.json();
        const run = runs.workflow_runs.find(r => r.name === lastTrack && r.head_branch === "main");
        if (run) {
          if (run.status === "completed") {
            if (run.conclusion === "failure") {
              return new Response(`❌ Build failed. ${get} not found.`, { status: 404 });
            }
            if (run.conclusion === "success") {
              return new Response(`Track complete. Check release.`, { status: 200 });
            }
          } else {
            return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${run.id}`, {
              status: 202
            });
          }
        }
      }
    }

    // 4️⃣ Dispatch (yeni görev başlat)
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, track, { expirationTtl: 180 });

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
          track
        }
      })
    });

    if (dispatchRes.ok) {
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
        status: 202
      });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
