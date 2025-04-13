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
    let cdnUrl = normalizedUrl;
    for (const domain of cdnDomains) {
      if (cdnUrl.includes(domain)) {
        cdnUrl = cdnUrl.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    // Check if release already available
    const release = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (release.ok) {
      const json = await release.json();
      const asset = json.assets.find(a => a.name === `${get}_${name}.zip`);
      if (asset) return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
    }

    // KV kontrolü
    const kvKey = `${get}:${name}`;
    const existingTrack = await env.FCE_KV.get(kvKey);
    if (existingTrack) {
      const statusCheck = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });
      if (statusCheck.ok) {
        const data = await statusCheck.json();
        const run = data.workflow_runs.find(w => w.name === existingTrack && w.head_branch === "main");
        if (run && run.status === "completed") {
          if (run.conclusion === "success") {
            return new Response("✅ Build finished but release not yet ready.", { status: 202 });
          } else {
            return new Response("❌ Build failed during processing.", { status: 404 });
          }
        }
      }
    }

    // Yeni işlem başlat
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, track, { expirationTtl: 180 });

    const dispatch = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "FCE Worker"
      },
      body: JSON.stringify({ ref: "main", inputs: { url, track } })
    });

    if (!dispatch.ok) {
      const err = await dispatch.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // ✅ Polling kısmı — build süreci kontrolü
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const check = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (check.ok) {
        const list = await check.json();
        const run = list.workflow_runs.find(w => w.name === track && w.head_branch === "main");

        if (run && run.status === "completed") {
          if (run.conclusion === "success") {
            const rel = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
              headers: {
                Authorization: `Bearer ${env.GTKK}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "FCE Worker"
              }
            });
            if (rel.ok) {
              const json = await rel.json();
              const ready = json.assets.find(a => a.name === `${get}_${name}.zip`);
              if (ready) return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
            }
            return new Response("✅ Build succeeded, but no release asset yet.", { status: 202 });
          } else {
            return new Response("❌ Build failed — no asset will be available.", { status: 404 });
          }
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
