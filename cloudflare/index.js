export default {
  async fetch(req, env) {
    const urlParams = new URLSearchParams(req.url.split("?")[1]);
    let url = urlParams.get("url");
    let get = urlParams.get("get");

    // 🧪 Log parametreler
    console.log("Incoming Request → URL:", url);
    console.log("Incoming Request → GET:", get);

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

    if (url) {
      if (url.includes(".zip")) {
        url = url.split(".zip")[0] + ".zip";
      } else {
        return new Response("\nOnly .zip URLs are supported.\n", { status: 400 });
      }

      for (const domain of domains) {
        if (url.includes(domain)) {
          url = url.replace(
            domain,
            "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com"
          );
          break;
        }
      }
    } else {
      return new Response(
        "\nMissing parameters!\n\nUsage:\ncurl fce.gmrec72.workers.dev?get=boot_img&url=<url>\n\nExample:\ncurl fce.gmrec72.workers.dev?get=boot_img&url=https://example.com/rom.zip\n\n",
        { status: 400 }
      );
    }

    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return new Response("\nThe provided URL is not accessible.\n", { status: 400 });
    }

    const fileName = url.split("/").pop();
    const romName = fileName.split(".zip")[0];

    // KV ile check et
    const trackKey = `processing_${romName}_${get}`;
    const existingTrack = await env.FCE_KV.get(trackKey);

    if (existingTrack) {
      console.log("⚠️ Existing task found in KV:", existingTrack);
      return new Response(`\n⚙️ Already processing...\nTrack progress: ${existingTrack}`, { status: 200 });
    }

    // GitHub tetikleme
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Cloudflare Worker",
    };

    const BaseUrl = "https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml";
    const githubDispatchUrl = `${BaseUrl}/dispatches`;
    const TRACK_URL = `${BaseUrl}/runs`;

    const track = Date.now().toString();
    const data = {
      ref: "main",
      inputs: {
        url,
        track,
        get
      }
    };

    // 🧪 Log GitHub’a yollanacak veri
    console.log("Dispatch Data →", JSON.stringify(data));

    try {
      const githubResponse = await fetch(githubDispatchUrl, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(data),
      });

      if (githubResponse.ok) {
        // ✔️ Görev başarılı tetiklendi, KV’ye yaz
        await env.FCE_KV.put(trackKey, `${BaseUrl}/runs`, { expirationTtl: 180 }); // 3 dakika beklesin

        return new Response(`\n✅ Build started for ${romName} [${get}]\nTrack progress: ${BaseUrl}/runs\n`, {
          status: 200,
        });
      } else {
        const githubResponseText = await githubResponse.text();
        return new Response(`GitHub Response Error: ${githubResponseText}`, {
          status: 500,
        });
      }
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  },
};
