export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    let url = urlParams.get("url");

    if (!url) {
      return new Response("Missing 'url' parameter.", { status: 400 });
    }

    // Sadece .zip destekleniyor
    if (!url.includes(".zip")) {
      return new Response("Only .zip URLs are supported.", { status: 400 });
    }

    // CDN yönlendirme
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

    const filename = url.split("/").pop();
    const romName = filename.replace(".zip", "");
    const get = "boot_img";
    const expectedAsset = `${get}_${romName}.zip`;

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
      const asset = release.assets.find(a => a.name === expectedAsset);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 2️⃣ Yeni görev tetikle
    const track = Date.now().toString();
    const dispatchRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches", {
      method: "POST",
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json"
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

    if (!dispatchRes.ok) {
      const err = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // 3️⃣ Polling başlasın (bekle)
    const runsApi = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`;
    const pollingLimit = 18; // 90 saniye
    for (let i = 0; i < pollingLimit; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const trackRes = await fetch(runsApi, {
        headers: {
          Authorization: `token ${env.GTKK}`,
          Accept: "application/vnd.github.v3+json"
        }
      });
      if (!trackRes.ok) continue;

      const data = await trackRes.json();
      const run = data.workflow_runs.find(w => w.head_branch === "main" && w.name === track);
      if (!run) continue;

      if (run.status === "completed") {
        if (run.conclusion === "success") {
          const latestRelease = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
            headers: {
              Authorization: `token ${env.GTKK}`,
              Accept: "application/vnd.github.v3+json"
            }
          });
          if (latestRelease.ok) {
            const rel = await latestRelease.json();
            const asset = rel.assets.find(a => a.name === expectedAsset);
            if (asset) {
              return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
            }
          }
        } else {
          return new Response("❌ Build failed or requested image not found.", { status: 404 });
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 408 });
  }
};
