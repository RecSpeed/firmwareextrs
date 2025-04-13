export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url, "https://dummy.url").searchParams;
    const url = urlParams.get("url");
    const get = "boot_img";

    if (!url || !url.includes(".zip")) {
      return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
    }

    const fileName = url.split("/").pop().split(".zip")[0];
    const normalizedName = fileName;
    const kvKey = `${get}:${normalizedName}`;

    // CDN düzeltmesi
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

    // 1. Daha önce başarısız olarak işaretlendiyse direkt döndür
    const existingStatus = await env.FCE_KV.get(kvKey);
    if (existingStatus === "fail") {
      return new Response("❌ This firmware failed previously.", { status: 404 });
    }

    // 2. Release'de dosya zaten varsa direkt ver
    const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (releaseRes.ok) {
      const release = await releaseRes.json();
      const asset = release.assets.find(a => a.name === `${get}_${normalizedName}.zip`);
      if (asset) {
        await env.FCE_KV.put(kvKey, "done", { expirationTtl: 604800 });
        return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
      }
    }

    // 3. Daha önce başlatıldıysa kontrol et
    if (existingStatus && existingStatus !== "fail" && existingStatus !== "done") {
      const runs = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs", {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });
      if (runs.ok) {
        const runData = await runs.json();
        const match = runData.workflow_runs.find(r => r.name === existingStatus && r.head_branch === "main");
        if (match?.status === "completed") {
          if (match.conclusion === "failure") {
            await env.FCE_KV.put(kvKey, "fail", { expirationTtl: 86400 });
            return new Response("❌ Build failed previously.", { status: 404 });
          } else {
            // başarılıysa ama release geç düştüyse polling yap
          }
        } else {
          return new Response("⏳ Process already running. Please wait.", { status: 202 });
        }
      }
    }

    // 4. Yeni job başlat
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
      await env.FCE_KV.put(kvKey, "fail", { expirationTtl: 86400 });
      const text = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${text}`, { status: 500 });
    }

    // 5. Polling başlat
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const poll = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (poll.ok) {
        const json = await poll.json();
        const asset = json.assets.find(a => a.name === `${get}_${normalizedName}.zip`);
        if (asset) {
          await env.FCE_KV.put(kvKey, "done", { expirationTtl: 604800 });
          return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
