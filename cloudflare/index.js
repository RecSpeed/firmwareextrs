export default {
  async fetch(request, env) {
    try {
      // URL validasyonu
      const url = new URL(request.url);
      if (url.pathname !== '/') {
        return createResponse(404, { error: 'Not Found' });
      }

      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');

      // Gelişmiş validasyon
      if (!['boot', 'recovery', 'modem'].includes(imageType)) {
        return createResponse(400, { 
          error: 'Invalid type', 
          valid_types: ['boot', 'recovery', 'modem'] 
        });
      }

      if (!firmwareUrl || !firmwareUrl.match(/^https?:\/\/.+\..+\.zip($|\?)/i)) {
        return createResponse(400, { 
          error: 'Invalid URL', 
          example: 'https://example.com/firmware.zip' 
        });
      }

      // URL normalizasyonu
      const cleanUrl = firmwareUrl.split('?')[0].replace(/%20/g, ' ');
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // KV check (basitleştirilmiş)
      const existing = await env.FCE_KV.get(kvKey);
      if (existing) {
        return createResponse(200, {
          status: 'processing',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions'
        });
      }

      // Release kontrolü
      try {
        const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
        if (asset) {
          return createResponse(200, {
            status: 'ready',
            download_url: asset.browser_download_url,
            file_name: asset.name
          });
        }
      } catch (e) {
        console.warn('Release check error:', e);
      }

      // Yeni işlem
      const trackId = `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 3600 });

      // GitHub Action tetikleme
      const dispatchResp = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatchResp.ok) {
        await env.FCE_KV.delete(kvKey);
        const error = await dispatchResp.text();
        console.error('Dispatch failed:', error);
        return createResponse(502, { 
          error: 'Workflow trigger failed',
          details: error.slice(0, 200) 
        });
      }

      return createResponse(200, {
        status: 'processing',
        tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
        track_id: trackId
      });

    } catch (error) {
      console.error('Critical error:', error);
      return createResponse(500, { 
        error: 'Internal Server Error',
        request_id: request.headers.get('cf-ray') 
      });
    }
  }
};

// Helper functions
async function checkReleaseAsset(token, imageType, firmwareName) {
  const response = await fetch(
    `https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker',
        'Accept': 'application/vnd.github+json'
      }
    }
  );

  if (!response.ok) return null;
  
  const { assets } = await response.json();
  return assets.find(a => a.name === `${imageType}_${firmwareName}.zip`);
}

async function triggerWorkflow(token, inputs) {
  return fetch(
    'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'FCE-Worker',
        'Accept': 'application/vnd.github+json'
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
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
