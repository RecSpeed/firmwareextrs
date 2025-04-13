// ✅ Final Cloudflare Worker (sadece boot_img destekli, PCE bitene kadar bekler)
export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    let url = urlParams.get("url");

    if (!url || !url.includes(".zip")) {
      return new Response("Missing or invalid 'url' parameter.", { status: 400 });
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

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const expectedName = `boot_img_${name}.zip`;
    const releaseUrl = `https://github.com/RecSpeed/firmwareextrs/releases/download/auto/${expectedName}`;

    // 1. Release kontrolü
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `token ${env.GTKK}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === expectedName);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 2. v.json kontrolü
    try {
      const vjsonRes = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjsonRes.ok) {
        const data = await vjsonRes.json();
        const entry = data[name];
        if (entry) {
          if (entry.boot_img_zip === "false") {
            return new Response("❌ Requested image (boot_img) not found.", { status: 404 });
          }
        }
      }
    } catch (_) {}

    // 3. GitHub Dispatch
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
          get: "boot_img",
          track
        }
      })
    });

    if (!dispatchRes.ok) {
      const err = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // 4. Polling (tamamlanana kadar bekleme)
    const trackUrl = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`;
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "FCE Worker"
    };

    const maxWait = 30; // 30 x 5s = 150 saniye
    for (let i = 0; i < maxWait; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const runsRes = await fetch(trackUrl, { headers });
      if (runsRes.ok) {
        const data = await runsRes.json();
        const matchedRun = data.workflow_runs.find(run => run.name === track);
        if (matchedRun && matchedRun.status === "completed") {
          if (matchedRun.conclusion === "failure") {
            return new Response("❌ Requested image (boot_img) failed.", { status: 404 });
          } else {
            return new Response(`link: ${releaseUrl}`, { status: 200 });
          }
        }
      }
    }

    return new Response("Timeout. Firmware process did not finish in time.", { status: 408 });
  }
};
