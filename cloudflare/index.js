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
    const expectedFile = `boot_img_${name}.zip`;

    // 1️⃣ Release kontrolü
    const release = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        "User-Agent": "firmware-checker",
        Accept: "application/vnd.github+json"
      }
    });

    if (release.ok) {
      const relData = await release.json();
      const found = relData.assets.find(a => a.name === expectedFile);
      if (found) {
        return new Response(`link: ${found.browser_download_url}`, { status: 200 });
      }
    }

    // 2️⃣ v.json kontrolü
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const entry = Object.entries(data).find(([key]) => key.startsWith(name));
        if (entry) {
          const [_, values] = entry;
          if (values.boot_img_zip === "false") {
            return new Response("❌ boot.img not found in previous extraction.", { status: 404 });
          }
        }
      }
    } catch (_) {}

    // 3️⃣ GitHub Actions Dispatch & Track
    const track = Date.now().toString();
    const headers = {
      Authorization: `Bearer ${env.GTKK}`,
      "User-Agent": "firmware-worker",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    };

    const dispatch = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: "main",
        inputs: {
          url,
          track,
          get: "boot_img"
        }
      })
    });

    if (!dispatch.ok) {
      const err = await dispatch.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // 4️⃣ Track sonucu bekleniyor
    const trackUrl = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`;
    for (let i = 0; i < 50; i++) {
      await new Promise(res => setTimeout(res, 5000)); // 5 saniye bekle

      const runsRes = await fetch(trackUrl, { headers });
      if (runsRes.ok) {
        const runs = await runsRes.json();
        const found = runs.workflow_runs.find(run => run.name === track && run.head_branch === "main");
        if (found && found.status === "completed") {
          if (found.conclusion === "success") {
            // Bitmiş, release tekrar kontrol
            const newRelease = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, { headers });
            if (newRelease.ok) {
              const rel = await newRelease.json();
              const asset = rel.assets.find(a => a.name === expectedFile);
              if (asset) {
                return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
              }
            }
            return new Response("✅ Completed, but no link found in release.", { status: 200 });
          } else {
            return new Response("❌ Process failed. boot.img not found.", { status: 404 });
          }
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
