export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url, "https://dummy.url").searchParams;
    const url = urlParams.get("url");
    const get = "boot_img";

    if (!url || !url.includes(".zip")) {
      return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
    }

    const normalizedUrl = url.split(".zip")[0] + ".zip";
    const name = normalizedUrl.split("/").pop().replace(".zip", "");

    const cdnDomains = [
      "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com",
      "cdnorg.d.miui.com", "bn.d.miui.com", "hugeota.d.miui.com",
      "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
    ];
    for (const domain of cdnDomains) {
      if (normalizedUrl.includes(domain)) {
        normalizedUrl = normalizedUrl.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    const headers = {
      Authorization: `Bearer ${env.GTKK}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "FCE Worker"
    };

    // Önceden çıkarılmışsa release linki döndür
    const rel = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, { headers });
    if (rel.ok) {
      const relJson = await rel.json();
      const asset = relJson.assets.find(a => a.name === `${get}_${name}.zip`);
      if (asset) return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
    }

    const kvKey = `${get}:${name}`;
    const track = Date.now().toString();
    const existing = await env.FCE_KV.get(kvKey);

    if (!existing) await env.FCE_KV.put(kvKey, track, { expirationTtl: 180 });

    // İşlem başlatılmamışsa başlat
    if (!existing) {
      const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ref: "main", inputs: { url, get, track } })
      });

      if (!dispatchRes.ok) {
        const err = await dispatchRes.text();
        return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
      }
    }

    // Polling 30 x 5 = 150 saniye (2.5 dakika)
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const runsRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, { headers });
      if (!runsRes.ok) continue;

      const data = await runsRes.json();
      const run = data.workflow_runs.find(w => w.name === track && w.head_branch === "main");

      if (run && run.status === "completed") {
        if (run.conclusion === "success") {
          const rel = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, { headers });
          if (rel.ok) {
            const relJson = await rel.json();
            const ready = relJson.assets.find(a => a.name === `${get}_${name}.zip`);
            if (ready) return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
          }
          return new Response("✅ Build completed. Waiting release upload.", { status: 202 });
        } else {
          return new Response("❌ Build failed or image not found.", { status: 404 });
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
