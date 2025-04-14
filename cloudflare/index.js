export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');

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
      // KV anahtarı: imageType ve firmware adını birlikte kullanıyoruz
      const kvKey = `${imageType}:${firmwareName}`;
      
      // İlk olarak, releasede dosya hazır mı kontrol edelim
      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }
      
      // KV'de bu firmware için bir kayıt var mı?
      const kvValue = await env.FCE_KV.get(kvKey);
      if (kvValue) {
        // KV değerini parse edip mevcut durumu kontrol edelim
        try {
          const record = JSON.parse(kvValue);
          // Eğer mevcut kayıt "processing" ya da "failed" durumunda ise,
          // aynı firmware için yeni işlem başlatılmasına gerek yok.
          if (record.state === "processing") {
            return createResponse(200, {
              status: "processing",
              tracking_url: "https://github.com/RecSpeed/firmwareextrs/actions",
              track_id: kvKey  // KV anahtarını track_id olarak kullanıyoruz
            });
          } else if (record.state === "failed") {
            return createResponse(500, {
              error: "Workflow failed",
              message: record.error || "Extraction process failed. Please retry."
            });
          }
        } catch (e) {
          // Parse edilemezse, kaydı yokmuş gibi davranıp yeni işlem başlatabilirsiniz.
        }
      }
      
      // KV kaydı yoksa; yani bu firmware için işlem henüz başlamamış
      // KV'ye "processing" durumunu yazıyoruz. TTL 5 dakika (300 saniye) olarak ayarlanıyor.
      const newRecord = { state: "processing", timestamp: new Date().toISOString(), error: null };
      await env.FCE_KV.put(kvKey, JSON.stringify(newRecord), { expirationTtl: 300 });
      
      // Yeni workflow tetikleme: Yeni işlem başlatılıyor.
      const dispatchResp = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        // track olarak KV key'ini (örn. imageType:firmwareName) gönderiyoruz,
        // böylece workflow bu kaydı güncelleyebilir.
        track: kvKey,
        image_type: imageType,
        firmware_name: firmwareName
      });
      
      if (!dispatchResp.ok) {
        // Eğer dispatch başarısız olursa, KV kaydını silebilir veya güncelleyebilirsiniz.
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
