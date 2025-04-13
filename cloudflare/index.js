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
    const kvKey = `${get}:${name}`;
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "FCE Worker"
    };

    // 1️⃣ Release kontrolü
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", { headers });
    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const expectedName = `${get}_${name}.zip`;
      const asset = release.assets.find(a => a.name === expectedName);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 2️⃣ Daha önce başarısız olarak işaretlenmiş mi?
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const entry = data[name];
        if (entry && entry[`${get}_zip`] === "false") {
          return new Response(`❌ Requested image (${get}) not found`, { status: 404 });
        }
      }
    } catch (_) {}

    // 3️⃣ Daha önce başlatılmış bir işlem var mı?
    const cached = await env.FCE_KV.get(kvKey);
    if (cached) {
      try {
        const { run_id } = JSON.parse(cached);
        const runRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs/${run_id}`, { headers });
        if (runRes.ok) {
          const run = await runRes.json();
          if (run.status === "completed") {
            if (run.conclusion === "failure") {
              return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
            } else if (run.conclusion === "success") {
              return new Response(`Track complete. Check release.`, { status: 200 });
            }
          } else {
            return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${run.id}`, { status: 202 });
          }
        }
      } catch (_) {}
    }

    // 4️⃣ Yeni işlem başlat
    const track = Date.now().toString();
    const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { url, track, get }
      })
    });

    if (dispatchRes.ok) {
      const runsRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", { headers });
      if (runsRes.ok) {
        const runsData = await runsRes.json();
        const matched = runsData.workflow_runs.find(r => r.head_branch === "main" && r.name === track);
        if (matched) {
          await env.FCE_KV.put(kvKey, JSON.stringify({ run_id: matched.id }), { expirationTtl: 300 });
          return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${matched.id}`, { status: 202 });
        }
      }
      return new Response(`✅ Build dispatched for ${name} [${get}]`, { status: 202 });
    }

    const err = await dispatchRes.text();
    return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
  }
};
