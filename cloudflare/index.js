export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const urlRaw = urlParams.get("url");
    const get = "boot_img"; // sadece boot_img destekleniyor

    if (!urlRaw || !urlRaw.endsWith(".zip")) {
      return new Response("Missing or invalid ?url= parameter (.zip required)", { status: 400 });
    }

    // ✅ CDN düzeltmesi
    const domains = [
      "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com", "cdnorg.d.miui.com",
      "bn.d.miui.com", "hugeota.d.miui.com", "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
    ];

    let url = urlRaw;
    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
        break;
      }
    }

    const name = url.split("/").pop().replace(".zip", "");
    const expectedAssetName = `boot_img_${name}.zip`;

    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "FCE Worker"
    };

    // 1️⃣ Daha önce çıkartıldı mı → Release'e bak
    const releaseCheck = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, { headers });
    if (releaseCheck.ok) {
      const rel = await releaseCheck.json();
      const existing = rel.assets.find(a => a.name === expectedAssetName);
      if (existing) {
        return new Response(`link: ${existing.browser_download_url}`, { status: 200 });
      }
    }

    // 2️⃣ v.json'da başarısız olarak işaretlendi mi?
    try {
      const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
      if (vjson.ok) {
        const data = await vjson.json();
        const found = Object.entries(data).find(([key]) => key.startsWith(name));
        if (found) {
          const [, values] = found;
          if (values["boot_img_zip"] === "false") {
            return new Response(`❌ boot.img not available for this firmware.`, { status: 404 });
          }
        }
      }
    } catch (e) {}

    // 3️⃣ GitHub Actions tetikle
    const track = Date.now().toString();
    const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
      method: "POST",
      headers,
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
      const errText = await dispatchRes.text();
      return new Response(`GitHub Dispatch Error: ${errText}`, { status: 500 });
    }

    // 4️⃣ Track sonucu bekle (max 3 dakika)
    const runCheckUrl = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`;
    const pollingLimit = 36; // 36 x 5s = 180s

    for (let i = 0; i < pollingLimit; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const runsRes = await fetch(runCheckUrl, { headers });
      if (!runsRes.ok) continue;

      const data = await runsRes.json();
      const run = data.workflow_runs.find(r => r.name === track);
      if (!run) continue;

      if (run.status === "completed") {
        if (run.conclusion === "failure") {
          return new Response(`❌ Build failed for ${name}`, { status: 404 });
        }
        if (run.conclusion === "success") {
          const finalRelease = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, { headers });
          if (finalRelease.ok) {
            const rel = await finalRelease.json();
            const asset = rel.assets.find(a => a.name === expectedAssetName);
            if (asset) {
              return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
            } else {
              return new Response(`✅ Build complete, but asset missing.`, { status: 500 });
            }
          }
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 504 });
  }
};
