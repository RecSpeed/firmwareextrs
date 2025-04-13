export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    let url = urlParams.get("url");
    const get = "boot_img"; // sadece boot_img destekleniyor, sabit kalmalı

    if (!url || !url.includes(".zip")) {
      return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
    }

    // Normalize URL
    url = url.split(".zip")[0] + ".zip";
    const fileName = url.split("/").pop();
    const name = fileName.replace(".zip", "");
    
    // CDN override
    const cdnDomains = [
      "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com",
      "cdnorg.d.miui.com", "bn.d.miui.com", "hugeota.d.miui.com",
      "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
    ];
    for (const domain of cdnDomains) {
      if (url.includes(domain)) {
        url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === `boot_img_${name}.zip`);
      if (asset) {
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    const kvKey = `${get}:${name}`;
    const existingTrack = await env.FCE_KV.get(kvKey);
    if (existingTrack) {
      const runStatusRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (runStatusRes.ok) {
        const data = await runStatusRes.json();
        const found = data.workflow_runs.find(w => w.name === existingTrack && w.head_branch === "main");
        if (found && found.status === "completed") {
          if (found.conclusion === "success") {
            const rel = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
              headers: {
                Authorization: `Bearer ${env.GTKK}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "FCE Worker"
              }
            });
            if (rel.ok) {
              const json = await rel.json();
              const ready = json.assets.find(a => a.name === `boot_img_${name}.zip`);
              if (ready) {
                return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
              }
            }
            return new Response("✅ Build done, release not yet ready.", { status: 202 });
          } else {
            return new Response("❌ Build failed or file not found.", { status: 404 });
          }
        }
      }
    }

    // Yeni job tetikle
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, track, { expirationTtl: 180 });

    const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { url, get, track }
      })
    });

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${errText}`, { status: 500 });
    }

    // Build başlatıldı, bekleniyor
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (pollRes.ok) {
        const rel = await pollRes.json();
        const ready = rel.assets.find(a => a.name === `boot_img_${name}.zip`);
        if (ready) {
          return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
