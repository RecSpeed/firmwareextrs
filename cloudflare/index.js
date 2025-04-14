export default {
  async fetch(request, env) {
    try {
      // 1. URL ve parametre kontrolü
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');
      // İsteğe ek track parametresi varsa alalım
      const incomingTrack = url.searchParams.get('track');

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
      
      // 3. URL normalizasyonu ve firmware adının belirlenmesi
      const cleanUrl = firmwareUrl.split('?')[0];
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;
      
      // 4. Eğer firmware hazırsa, asset kontrolü önce
      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }
      
      // 5. KV’de saklı track_id kontrolü
      const savedTrack = await env.FCE_KV.get(kvKey);
      if (incomingTrack && savedTrack && savedTrack === incomingTrack) {
        // Eğer gelen track parametresi KV’dekiyle uyumlu ise, yeni workflow tetiklenmeden mevcut değeri döndür
        return createResponse(200, {
          status: 'processing',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
          track_id: incomingTrack
        });
      }
      
      // KV’de hali hazırda bir track varsa, bunu döndür
      if (savedTrack) {
        return createResponse(200, {
          status: 'processing',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
          track_id: savedTrack
        });
      }
      
      // 6. Henüz track yoksa, yeni track oluştur ve workflow tetikle
      const trackId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 300 });
      
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

// GitHub Release kontrolü
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

// Yeni workflow tetiklemek için kullanacağımız fonksiyon
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
