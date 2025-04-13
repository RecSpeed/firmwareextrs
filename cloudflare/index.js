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

    // Check CDN domains and replace if needed
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

    // First check if the file already exists in releases
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
      if (asset) return Response.redirect(asset.browser_download_url, 302);
    }

    const kvKey = `${get}:${name}`;
    const existingTrack = await env.FCE_KV.get(kvKey);

    // If there's an existing process, return tracking info
    if (existingTrack) {
      const trackingUrl = `https://github.com/RecSpeed/firmwareextrs/actions?query=workflow%3AFCE+is%3Arunning`;
      return new Response(
        `⏳ This firmware is already being processed. Track progress: ${trackingUrl}\n\n` +
        `When complete, your download will be available at: https://github.com/RecSpeed/firmwareextrs/releases/tag/auto`,
        { status: 200 }
      );
    }

    // Start new process
    const track = Date.now().toString();
    await env.FCE_KV.put(kvKey, track, { expirationTtl: 1800 }); // 30 minutes expiration

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
        inputs: { url, track }
      })
    });

    if (!dispatch.ok) {
      const err = await dispatch.text();
      return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });
    }

    const trackingUrl = `https://github.com/RecSpeed/firmwareextrs/actions?query=workflow%3AFCE+is%3Arunning`;
    return new Response(
      `🚀 Processing started for ${name}. Track progress: ${trackingUrl}\n\n` +
      `When complete, your download will be available at: https://github.com/RecSpeed/firmwareextrs/releases/tag/auto`,
      { status: 200 }
    );
  }
};
