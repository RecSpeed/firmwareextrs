export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    let url = urlParams.get("url");
    const get = "boot_img"; // Sadece boot_img destekleniyor

    if (!url || !url.includes(".zip")) {
      return new Response("Missing or invalid 'url' parameter.", { status: 400 });
    }

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

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const fileName = `boot_img_${name}.zip`;

    // 1️⃣ Önce Release kontrolü
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === fileName);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 2️⃣ Yeni görev başlat
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

    // 3️⃣ Polling: FCE tamamlanana kadar bekle
    const pollingUrl = "https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs";
    for (let i = 0; i < 24; i++) { // ~2 dakika bekleme
      await new Promise(r => setTimeout(r, 5000));
      const runsRes = await fetch(pollingUrl, {
        headers: {
          Authorization: `token ${env.GTKK}`,
          Accept: "application/vnd.github.v3+json"
        }
      });

      if (runsRes.ok) {
        const runs = await runsRes.json();
        const run = runs.workflow_runs.find(r => r.name === track);
        if (run && run.status === "completed") {
          if (run.conclusion === "success") {
            // Yeniden Release kontrolü
            const reReleaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
              headers: {
                Authorization: `token ${env.GTKK}`,
                Accept: "application/vnd.github.v3+json"
              }
            });

            if (reReleaseRes.ok) {
              const rel = await reReleaseRes.json();
              const asset = rel.assets.find(a => a.name === fileName);
              if (asset) {
                return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
              }
            }

            return new Response("Build completed but file not found in release.", { status: 404 });
          } else {
            return new Response("❌ Requested image not found or build failed.", { status: 404 });
          }
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 504 });
  }
}
