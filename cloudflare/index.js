export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) return new Response("Missing 'get' or 'url' parameter.", { status: 400 });

    // CDN yönlendirme
    const domains = ["ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com", "cdnorg.d.miui.com", "bn.d.miui.com", "hugeota.d.miui.com", "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"];
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
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "FCE Worker"
    };

    const tracking = await env.FCE_KV.get(kvKey);
    if (tracking) {
      const runsRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", { headers });
      if (runsRes.ok) {
        const { workflow_runs } = await runsRes.json();
        const run = workflow_runs.find(r => r.head_branch === "main" && r.display_title?.includes(name));
        if (run) {
          if (run.status === "completed") {
            if (run.conclusion === "failure") {
              return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
            }
            if (run.conclusion === "success") {
              const expectedName = `${get}_${name}.zip`;
              const rel = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", { headers });
              if (rel.ok) {
                const rjson = await rel.json();
                const asset = rjson.assets.find(a => a.name === expectedName);
                if (asset) return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
              }
              return new Response("✅ Process finished but no link found.", { status: 500 });
            }
          }
        }
      }
      return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions`, { status: 202 });
    }

    // Yeni görev tetikleniyor
    await env.FCE_KV.put(kvKey, "processing", { expirationTtl: 120 });

    const dispatch = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { url, get, track: Date.now().toString() } })
    });

    if (dispatch.ok) {
      return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
        status: 200
      });
    }

    const err = await dispatch.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
