export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');
      const incomingTrack = url.searchParams.get('track');

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
      
      const cleanUrl = firmwareUrl.split('?')[0];
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;
      
      // Önce, hazır asset kontrolü (dosya üretilmişse)
      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }
      
      // KV'de saklı track_id var mı kontrol edelim
      const savedTrack = await env.FCE_KV.get(kvKey);
      if (savedTrack) {
        if (await checkActiveRun(env.GTKK, savedTrack)) {
          // Eğer aktif run varsa, mevcut track_id üzerinden "processing" yanıtı döndür.
          return createResponse(200, {
            status: 'processing',
            tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
            track_id: savedTrack
          });
        } else {
          // Run artık aktif değil, yani workflow tamamlanmış (başarısız ya da başka bir sonuçla) demektir.
          // Bu durumda KV kaydını temizleyip hata döndürüyoruz.
          await env.FCE_KV.delete(kvKey);
          return createResponse(500, {
            error: 'Workflow failed',
            message: 'Extraction process failed. Please retry.'
          });
        }
      }
      
      // KV'de kayıt yoksa, yeni bir workflow tetikleyelim
      const trackId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 300 }); // TTL 5dk olarak ayarlanabilir
      
      const dispatchResp = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        track: trackId,
        image_type: imageType,
        firmware_name: firmwareName
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
      'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs?per_page=100',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'FCE-Worker'
        }
      }
    );
    if (!response.ok) return false;
    const { workflow_runs } = await response.json();
    // Sadece 'in_progress' ve 'queued' durumlarını aktif olarak kabul ediyoruz.
    return workflow_runs.some(run => {
      const status = run.status;
      return (status === 'in_progress' || status === 'queued') &&
             run.inputs?.track === trackId;
    });
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
