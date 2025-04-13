export default {
  async fetch(req, env) {
    try {
      const urlParams = new URL(req.url, "https://dummy.url").searchParams;
      let url = urlParams.get("url");
      const imageType = urlParams.get("type") || "boot"; // boot, recovery, modem

      // Geçerli image tiplerini kontrol et
      const validTypes = ["boot", "recovery", "modem"];
      if (!validTypes.includes(imageType)) {
        return jsonResponse(400, {
          status: "error",
          message: `Invalid 'type' parameter. Use: ${validTypes.join(", ")}`
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

      // CDN domain replacement
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

      // Check existing release
      const releaseRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`, {
        headers: {
          Authorization: `Bearer ${env.GTKK}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "FCE Worker"
        }
      });

      if (releaseRes.ok) {
        const release = await releaseRes.json();
        const asset = release.assets.find(a => a.name === `${imageType}_${name}.zip`);
        if (asset) {
          return jsonResponse(200, {
            status: "ready",
            download_url: asset.browser_download_url,
            filename: `${imageType}_${name}.zip`,
            image_type: imageType
          });
        }
      }

      const kvKey = `${imageType}:${name}`;
      const existingTrack = await env.FCE_KV.get(kvKey);

      if (existingTrack) {
        return jsonResponse(200, {
          status: "processing",
          tracking_url: `https://github.com/RecSpeed/firmwareextrs/actions`,
          message: `Already processing ${imageType} image`,
          image_type: imageType
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
            image_type: imageType
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
        message: `Started processing ${imageType} image`,
        image_type: imageType
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
