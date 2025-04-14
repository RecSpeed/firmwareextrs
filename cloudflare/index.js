export default {
  async fetch(request, env) {
    try {
      // 1. URL ve parametre kontrolü
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');

      // 2. Parametre validasyonu
      if (!['boot', 'recovery', 'modem'].includes(imageType)) {
        return createResponse(400, { 
          error: 'Invalid type', 
          valid_types: ['boot', 'recovery', 'modem']
        });
      }

      if (!firmwareUrl || !firmwareUrl.match(/^https?:\/\/.+\..+\.zip($|\?)/i)) {
        return createResponse(400, { 
          error: 'Invalid URL format',
          example: 'https://example.com/firmware.zip'
        });
      }

      // 3. URL normalizasyonu
      const cleanUrl = firmwareUrl.split('?')[0];
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // 4. Önce GitHub'daki hazır dosyayı kontrol et
      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }

      // 5. Aktif işlem kontrolü
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const isActive = await checkActiveRun(env.GTKK, existingTrack);
        if (isActive) {
          return createResponse(200, {
            status: 'processing',
            tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions'
          });
        } else {
          await env.FCE_KV.delete(kvKey);
        }
      }

      // 6. Yeni işlem başlat
      const trackId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 3600 });

      // 7. GitHub Action tetikle
      const dispatchResp = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatchResp.ok) {
        await env.FCE_KV.delete(kvKey);
        const error = await dispatchResp.text();
        console.error('Dispatch failed:', error);
        return createResponse(500, { 
          error: 'Workflow dispatch failed',
          details: error.slice(0, 200)
        });
      }

      return createResponse(200, {
        status: 'processing',
        tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
        track_id: trackId
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

// Helper functions
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

async function checkActiveRun(token, trackId) {
  try {
    const response = await fetch(
      'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs?status=in_progress',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'FCE-Worker'
        }
      }
    );
    if (!response.ok) return false;
    const { workflow_runs } = await response.json();
    return workflow_runs.some(run => run.inputs?.track === trackId);
  } catch (e) {
    console.error('Active run check error:', e);
    return false;
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
