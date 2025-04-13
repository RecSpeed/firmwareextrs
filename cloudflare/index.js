export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url, "https://dummy.url").searchParams;
    let url = urlParams.get("url");
    const get = "boot_img";

    if (!url || !url.includes(".zip")) {
      return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
    }

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");

    // CDN düzeltme
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

    const releaseRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === `${get}_${name}.zip`);
      if (asset) return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
    }

    const kvKey = `${get}:${name}`;
    const existingTrack = await env.FCE_KV.get(kvKey);

    if (existingTrack) {
      const runsRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (runsRes.ok) {
        const data = await runsRes.json();
        const found = data.workflow_runs.find(w => w.name === existingTrack && w.head_branch === "main");
        if (found) {
          if (found.status === "completed") {
            if (found.conclusion === "success") {
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
              return new Response("✅ Build success but release not yet updated.", { status: 202 });
            } else {
              return new Response("❌ Build failed. No image extracted.", { status: 404 });
            }
          }
        }
      }
    }

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
      body: JSON.stringify({
        ref: "main",
        inputs: { url, get, track }
      })
    });

    if (!dispatch.ok) {
      const err = await dispatch.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    // Bekleme süreci (Polling)
// Bekleme süreci (Polling)
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000));
  const statusCheck = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", {
    headers: {
      Authorization: `Bearer ${env.GTKK}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "FCE Worker"
    }
  });

  if (statusCheck.ok) {
    const checkData = await statusCheck.json();
    const run = checkData.workflow_runs.find(w => w.name === track && w.head_branch === "main");

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
          if (ready) {
            return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
          }
        }

        return new Response("✅ Build completed. Waiting release upload.", { status: 202 });
      } else {
        // 🛑 Build başarısızsa beklemeye devam etmeden anında 404 dön
        return new Response("❌ Build failed during processing.", { status: 404 });
      }
    }
  }
}



    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
