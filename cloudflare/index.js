export default {
  async fetch(req, env) {
    const urlParams = new URLSearchParams(req.url.split("?")[1]);
    const url = urlParams.get("url");
    const get = urlParams.get("get"); // boot_img veya recovery_img

    if (!url || !get || !["boot_img", "recovery_img"].includes(get)) {
      return new Response(
        "\nMissing or invalid parameters!\n\nUsage:\n?get=boot_img&url=<firmware_url>\n",
        { status: 400 }
      );
    }

    // .zip kontrolü
    if (!url.includes(".zip")) {
      return new Response("Only .zip URLs are supported.", { status: 400 });
    }

    // Desteklenen domain rewrite
    const domains = [
      "ultimateota.d.miui.com",
      "superota.d.miui.com",
      "bigota.d.miui.com",
      "cdnorg.d.miui.com",
      "bn.d.miui.com",
      "hugeota.d.miui.com",
      "cdn-ota.azureedge.net",
      "airtel.bigota.d.miui.com",
    ];
    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(
          domain,
          "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com"
        );
        break;
      }
    }

    const fileName = url.split("/").pop();
    const baseName = fileName.split(".zip")[0];
    const assetName = `${get}_${baseName}.zip`;
    const releaseUrl = `https://github.com/RecSpeed/firmwareextrs/releases/download/latest/${assetName}`;

    // ✅ 1. Release'de var mı kontrol et
    const releaseCheck = await fetch(releaseUrl, { method: "HEAD" });
    if (releaseCheck.ok) {
      return new Response(`link: ${releaseUrl}`, { status: 200 });
    }

    // 🔁 2. Daha önce başlatılmış mı kontrol et (3 dakika cache)
    const key = btoa(`${get}|${url}`);
    const activeTrack = await env.FCE_KV.get(key);
    if (activeTrack) {
      return new Response(`Track progress: ${activeTrack}`, { status: 200 });
    }

    // 🧠 3. Yoksa yeni GitHub Action tetikle
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Cloudflare Worker",
    };

    const trackId = Date.now().toString();
    const dispatchUrl = `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`;
    const trackLink = `https://github.com/RecSpeed/firmwareextrs/actions/runs`;

    const body = {
      ref: "main",
      inputs: { url, track: trackId, get },
    };

    const ghRes = await fetch(dispatchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (ghRes.ok) {
      // Yeni track’i cache’le (180 saniye = 3 dakika)
      await env.FCE_KV.put(key, trackLink, { expirationTtl: 180 });
      return new Response(`Track progress: ${trackLink}`, { status: 200 });
    } else {
      const errText = await ghRes.text();
      return new Response(`GitHub Error: ${errText}`, { status: 500 });
    }
  },
};
