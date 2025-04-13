export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
      return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
    }

    // CDN dönüştürme
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

    // 🔁 Önceden başlatılmış track varsa onu kontrol et
    const lastRunId = await env.FCE_KV.get(kvKey);
    if (lastRunId) {
      const runCheck = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs/${lastRunId}`, {
        headers: {
          Authorization: `token ${env.GTKK}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (runCheck.ok) {
        const runData = await runCheck.json();
        if (runData.status === "completed") {
          if (runData.conclusion === "failure") {
            return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
          } else if (runData.conclusion === "success") {
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

            // fallback kontrolü
            const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
            if (vjson.ok) {
              const data = await vjson.json();
              const values = data[name];
              if (values && values[`${get}_zip`] === "false") {
                return new Response(`❌ Requested image (${get}) not found`, { status: 404 });
              }
            }
          }
        } else {
          return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${lastRunId}`, {
            status: 202
          });
        }
      }
    }

    // Yeni task başlat
    const track = Date.now().toString();
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

    if (!dispatchRes.ok) {
      const err = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // Track ID'yi KV'ye kaydetmek için birkaç saniye bekle
    await new Promise(r => setTimeout(r, 5000));

    const runsRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (runsRes.ok) {
      const data = await runsRes.json();
      const matched = data.workflow_runs.find(run => run.head_branch === "main" && run.name === track);
      if (matched) {
        await env.FCE_KV.put(kvKey, matched.id.toString(), { expirationTtl: 300 });
        return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${matched.id}`, {
          status: 202
        });
      }
    }

    return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
      status: 202
    });
  }
};
