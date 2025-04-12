export default {
  async fetch(req, env) {
    const urlParams = new URLSearchParams(req.url.split("?")[1]);
    const get = urlParams.get("get");
    let url = urlParams.get("url");

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

    // ⚠️ Parametre kontrolü
    if (!url || !get) {
      return new Response(
        "\nMissing parameters!\nUsage:\n?get=boot_img&url=<firmware_url>\n",
        { status: 400 }
      );
    }

    // Sadece .zip desteklenir
    if (!url.includes(".zip")) {
      return new Response("\nOnly .zip URLs are supported.\n", { status: 400 });
    }

    // Domain rewrite
    for (const domain of domains) {
      if (url.includes(domain)) {
        url = url.replace(
          domain,
          "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com"
        );
        break;
      }
    }

    // URL geçerli mi kontrol et
    const headCheck = await fetch(url, { method: "HEAD" });
    if (!headCheck.ok) {
      return new Response("\nThe provided URL is not accessible.\n", { status: 400 });
    }

    const fileName = url.split("/").pop();
    const romKey = fileName.replace(".zip", "");

    // 🔁 KV: Önce var mı kontrol et (Release varsa dön)
    const existing = await env.FCE_KV.get(`${get}:${romKey}`);
    if (existing) {
      return new Response(`link: ${existing}`, { status: 200 });
    }

    // ⏳ Track süresi içinde mi?
    const pending = await env.FCE_KV.get(`pending:${get}:${romKey}`);
    if (pending) {
      return new Response(`\nAlready processing...\n${pending}`, { status: 200 });
    }

    // 🔄 GitHub Actions trigger
    const trackId = Date.now().toString();
    await env.FCE_KV.put(`pending:${get}:${romKey}`, `Tracking: ${trackId}`, { expirationTtl: 180 });

    const githubDispatchUrl =
      "https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches";

    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Cloudflare Worker",
    };

    const body = {
      ref: "main",
      inputs: { url, get, track: trackId }
    };

    const dispatch = await fetch(githubDispatchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!dispatch.ok) {
      const errorText = await dispatch.text();
      return new Response(`GitHub Response Error: ${errorText}`, { status: 500 });
    }

    return new Response(`\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions\n`, {
      status: 200,
    });
  },
};
