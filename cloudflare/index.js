export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url, "https://dummy.url").searchParams;
    let url = urlParams.get("url");
    let get = urlParams.get("get") || "boot_img";

    if (!url || !url.includes(".zip")) {
      return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
    }

    url = url.split(".zip")[0] + ".zip";
    const name = url.split("/").pop().replace(".zip", "");
    const kvKey = `${get}:${name}`;

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

    // 🎯 Release'te var mı
    const release = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
      headers: {
        Authorization: `Bearer ${env.GTKK}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "FCE Worker"
      }
    });

    if (release.ok) {
      const data = await release.json();
      const found = data.assets.find(a => a.name === `${get}_${name}.zip`);
      if (found) {
        return new Response(`link: ${found.browser_download_url}`, { status: 200 });
      }
    }

    // 🔍 Önceki build varsa kontrol et
    const oldTrack = await env.FCE_KV.get(kvKey);
    if (oldTrack) {
      const run = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (run.ok) {
        const json = await run.json();
        const job = json.workflow_runs.find(r => r.name === oldTrack && r.head_branch === "main");

        if (job && job.status === "completed") {
          if (job.conclusion === "failure") {
            return new Response("❌ Build failed (payload.bin not found).", { status: 404 });
          }
        }
      }
    }

    // ⚙️ Yeni build tetikle
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
      const msg = await dispatch.text();
      return new Response(`GitHub Dispatch Error:\n${msg}`, { status: 500 });
    }

    // ⏳ Polling: max 150 saniye
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const pollRelease = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (pollRelease.ok) {
        const json = await pollRelease.json();
        const done = json.assets.find(a => a.name === `${get}_${name}.zip`);
        if (done) {
          return new Response(`link: ${done.browser_download_url}`, { status: 200 });
        }
      }

      const checkRun = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (checkRun.ok) {
        const data = await checkRun.json();
        const failed = data.workflow_runs.find(r => r.name === track && r.status === "completed" && r.conclusion === "failure");
        if (failed) {
          return new Response("❌ Build failed during polling phase.", { status: 404 });
        }
      }
    }

    return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });
  }
};
