export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');

      if (!['boot', 'modem', 'preloader'].includes(imageType)) {
        return createResponse(400, {
          error: 'Invalid type',
          valid_types: ['boot', 'modem', 'preloader']
        });
      }
      if (!firmwareUrl || !firmwareUrl.match(/^https?:\/\/.+\..+\.zip($|\?)/i)) {
        return createResponse(400, {
          error: 'Invalid URL format',
          example: 'https://example.com/firmware.zip'
        });
      }

      const cleanUrl = firmwareUrl.split('?')[0];
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        const record = {
          state: "complete",
          timestamp: new Date().toISOString(),
          error: null,
          file: asset.browser_download_url
        };
        await env.FCE_KV.put(kvKey, JSON.stringify(record), { expirationTtl: 3600 });
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }

      const kvValue = await env.FCE_KV.get(kvKey);
      if (kvValue) {
        try {
          const record = JSON.parse(kvValue);
          const age = (Date.now() - new Date(record.timestamp).getTime()) / 1000;

          if (record.state === "failed" && age <= 3600) {
            return createResponse(500, {
              status: "error",
              error: "Workflow failed",
              message: record.error || "Extraction process failed. Please retry.",
              tracking_url: record.tracking_url || "https://github.com/RecSpeed/firmwareextrs/actions",
              track_id: kvKey
            });
          } else if (record.state === "processing" && age <= 300) {
            return createResponse(200, {
              status: "processing",
              tracking_url: "https://github.com/RecSpeed/firmwareextrs/actions",
              track_id: kvKey
            });
          }
        } catch (e) {
          console.warn("KV record parse failed, continuing...");
        }
      }

      const newRecord = {
        state: "processing",
        timestamp: new Date().toISOString(),
        error: null
      };
      await env.FCE_KV.put(kvKey, JSON.stringify(newRecord), { expirationTtl: 300 });

      const dispatchResp = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        track: kvKey,
        image_type: imageType,
        firmware_name: firmwareName
      });

      if (!dispatchResp.ok) {
        await env.FCE_KV.put(kvKey, JSON.stringify({
          state: "failed",
          timestamp: new Date().toISOString(),
          error: "Dispatch failed",
          tracking_url: "https://github.com/RecSpeed/firmwareextrs/actions"
        }), { expirationTtl: 3600 });

        const error = await dispatchResp.text();
        return createResponse(500, {
          error: 'Workflow dispatch failed',
          details: error.slice(0, 200)
        });
      }

      return createResponse(200, {
        status: 'processing',
        tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
        track_id: kvKey
      });

    } catch (error) {
      console.error('Unhandled error:', error);
      return createResponse(500, {
        error: 'Internal server error',
        request_id: request.headers.get('cf-ray')
      });
    }
  }
};

async function checkReleaseAsset(token, imageType, firmwareName) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'FCE-Worker'
        }
      }
    );
    if (!response.ok) return null;
    const { assets } = await response.json();
    return assets.find(a => a.name === `${imageType}_${firmwareName}.zip`);
  } catch (e) {
    console.error('Release check error:', e);
    return null;
  }
}

async function triggerWorkflow(token, inputs) {
  return fetch(
    'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'FCE-Worker'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs
      })
    }
  );
}

function createResponse(status, data) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
