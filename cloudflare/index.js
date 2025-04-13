export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

    // 🌐 CDN domain düzeltmesi
    const domains = [
      "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com",
      "cdnorg.d.miui.com", "bn.d.miui.com", "hugeota.d.miui.com",
      "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
    ];
    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    if (!url.includes(".zip")) return new Response("Only .zip URLs are supported.", { status: 400 });

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const kvKey = `${get}:${name}`;

    // 🔒 KV kontrolü
    const lastTrack = await env.FCE_KV.get(kvKey);

    // 🗂️ 1. Release kontrolü
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const expected = `${get}_${name}.zip`;
      const asset = release.assets.find(a => a.name === expected);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 📦 2. v.json kontrolü (önceden false işaretlenmişse)
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const match = Object.entries(data).find(([k]) => k.startsWith(name));
        if (match) {
          const [, values] = match;
          if (values[`${get}_zip`] === "false") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          }
        }
      }
    } catch (_) {}

    // 🔁 3. Daha önce başlatılmışsa onu kontrol et
    if (lastTrack) {
      const runsRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `token ${env.GTKK}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (runsRes.ok) {
        const runs = await runsRes.json();
        const matched = runs.workflow_runs.find(r => r.head_branch === "main" && r.name === lastTrack);
        if (matched) {
          if (matched.status === "completed") {
            if (matched.conclusion === "failure") {
              return new Response(`❌ Requested image (${get}) not found (PCE failed).`, { status: 404 });
            } else if (matched.conclusion === "success") {
              return new Response(`Track complete. Check release.`, { status: 200 });
            }
          }
          return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${matched.id}`, { status: 202 });
        }
      }
    }

    // 🚀 4. Yeni işlem başlat
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
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, { status: 202 });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
