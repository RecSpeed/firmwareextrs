export default {
  async fetch(req, env) {
    try {
      const urlParams = new URL(req.url, "https://dummy.url").searchParams;
      let url = urlParams.get("url");
      const get = urlParams.get("get") || "boot_img"; // Varsayılan: boot_img

      // Geçerli image tiplerini kontrol et
      if (get !== "boot_img" && get !== "recovery_img") {
        return jsonResponse(400, {
          status: "error",
          message: "Invalid 'get' parameter. Use boot_img or recovery_img"
        });
      }

      if (!url || !url.includes(".zip")) {
        return jsonResponse(400, {
          status: "error",
          message: "Missing or invalid 'url' parameter (.zip required)"
        });
      }

      url = url.split(".zip")[0] + ".zip";
      const name = url.split("/").pop().replace(".zip", "");

      // CDN domain replacement logic...
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

      // Check for existing release
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
        if (asset) {
          return jsonResponse(200, {
            status: "ready",
            download_url: asset.browser_download_url,
            filename: `${get}_${name}.zip`,
            image_type: get
          });
        }
      }

      const kvKey = `${get}:${name}`;
      const existingTrack = await env.FCE_KV.get(kvKey);

      if (existingTrack) {
        return jsonResponse(200, {
          status: "processing",
          tracking_url: `https://github.com/RecSpeed/firmwareextrs/actions`,
          message: `This firmware is already being processed for ${get.replace('_', '.')}`,
          image_type: get
        });
      }

      // Start new process
      const track = Date.now().toString();
      await env.FCE_KV.put(kvKey, track, { expirationTtl: 1800 });

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
          inputs: { 
            url, 
            track,
            image_type: get // Yeni parametre
          }
        })
      });

      if (!dispatch.ok) {
        const err = await dispatch.text();
        return jsonResponse(500, {
          status: "error",
          message: `GitHub Dispatch Error: ${err}`
        });
      }

      return jsonResponse(200, {
        status: "processing",
        tracking_url: `https://github.com/RecSpeed/firmwareextrs/actions`,
        message: `Processing started for ${get.replace('_', '.')}`,
        image_type: get
      });

    } catch (error) {
      return jsonResponse(500, {
        status: "error",
        message: `Internal server error: ${error.message}`
      });
    }
  }
};

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
