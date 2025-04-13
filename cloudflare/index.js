export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) return new Response("Missing 'get' or 'url' parameter.", { status: 400 });

    // CDN düzeltme
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

    if (!url.includes(".zip")) return new Response("Only .zip URLs are supported.", { status: 400 });

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const kvKey = `${get}:${name}`;

    // KV'den son işlem ID'si
    const lastTrack = await env.FCE_KV.get(kvKey);

    // Release kontrolü
    const releaseRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === `${get}_${name}.zip`);
      if (asset) return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
    }

    // v.json kontrolü
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const entry = Object.entries(data).find(([k]) => k.startsWith(name));
        if (entry) {
          const [, val] = entry;
          if (val[`${get}_zip`] === "false") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          }
        }
      }
    } catch (_) {}

    // Eğer track ID varsa ve işlem tamamlandıysa sonucu oku
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
        const run = runs.workflow_runs.find(w => w.name === lastTrack);
        if (run && run.status === "completed") {
          if (run.conclusion === "failure") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          } else {
            return new Response(`Track complete. Check release.`, { status: 200 });
          }
        }

        // Henüz bitmemişse
        if (run) {
          return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${run.id}`, {
            status: 202
          });
        }
      }
    }

    // Yeni track ID oluştur
    const newTrack = Date.now().toString();
    await env.FCE_KV.put(kvKey, newTrack, { expirationTtl: 180 });

    // Dispatch
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
          track: newTrack
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
