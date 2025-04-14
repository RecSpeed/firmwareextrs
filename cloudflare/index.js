export default {
  async fetch(request, env) {
    try {
      // Debug headers
      const headers = Object.fromEntries(request.headers);
      console.log('Request headers:', JSON.stringify(headers));

      // Validate request
      const url = new URL(request.url);
      const imageType = url.searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = url.searchParams.get('url');
      
      if (!['boot', 'recovery', 'modem'].includes(imageType)) {
        return createResponse(400, { error: 'Invalid type. Use boot/recovery/modem' });
      }

      if (!firmwareUrl?.match(/\.zip($|\?)/i)) {
        return createResponse(400, { error: 'URL must end with .zip' });
      }

      // Normalize URL
      const cleanUrl = firmwareUrl.split('.zip')[0] + '.zip';
      const firmwareName = cleanUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // Check KV for existing process - Basitleştirilmiş versiyon
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        return createResponse(200, {
          status: 'processing',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions'
        });
      }

      // Check existing release
      const asset = await checkReleaseAsset(env.GTKK, imageType, firmwareName);
      if (asset) {
        return createResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url,
          file_name: asset.name
        });
      }

      // Start new process
      const trackId = Date.now().toString();
      
      // Önce KV'ye yaz
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 3600 }); // 1 saat

      // Sonra işlemi başlat
      const dispatch = await triggerWorkflow(env.GTKK, {
        url: cleanUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatch.ok) {
        await env.FCE_KV.delete(kvKey);
        const errorText = await dispatch.text();
        console.error('Dispatch failed:', errorText);
        return createResponse(500, { error: 'Workflow dispatch failed' });
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
        details: error.message 
      });
    }
  }
};

// Helper functions (Aynı kalıyor)
async function checkActiveRun(token, trackId) {
  // ... mevcut implementasyon ...
}

async function checkReleaseAsset(token, imageType, firmwareName) {
  // ... mevcut implementasyon ...
}

async function triggerWorkflow(token, inputs) {
  // ... mevcut implementasyon ...
}

function createResponse(status, data) {
  // ... mevcut implementasyon ...
}
