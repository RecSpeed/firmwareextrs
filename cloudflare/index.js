export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const params = url.searchParams;
      const imageType = params.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = params.get('url');

      // Validasyonlar...
      
      const normalizedUrl = firmwareUrl.split('.zip')[0] + '.zip';
      const firmwareName = normalizedUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // Mevcut işlemi kontrol et (GÜNCELLENDİ)
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const runStatus = await checkGitHubRun(env.GTKK, existingTrack);
        
        // Eğer run aktif değilse KV'yi temizle
        if (runStatus === 'not_found') {
          await env.FCE_KV.delete(kvKey);
          return jsonResponse(200, { status: 'retry' });
        }
        
        // Eğer run aktifse
        if (runStatus === 'active') {
          return jsonResponse(200, { 
            status: 'processing',
            track_id: existingTrack
          });
        }
      }

      // Yeni işlem başlat
      const trackId = Date.now().toString();
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 1800 });

      const dispatch = await triggerGitHubAction(env.GTKK, {
        url: normalizedUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatch.ok) {
        await env.FCE_KV.delete(kvKey);
        return jsonResponse(500, { error: 'Dispatch failed' });
      }

      return jsonResponse(200, { 
        status: 'processing',
        track_id: trackId
      });

    } catch (error) {
      return jsonResponse(500, { error: error.message });
    }
  }
};

// Yeni fonksiyon: Run durumunu daha detaylı kontrol
async function checkGitHubRun(token, trackId) {
  const response = await fetch(
    `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs?head_sha=${trackId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker'
      }
    }
  );

  if (!response.ok) return 'error';

  const { workflow_runs } = await response.json();
  if (workflow_runs.length === 0) return 'not_found';
  
  const latestRun = workflow_runs[0];
  return latestRun.status === 'completed' ? 'not_found' : 'active';
}
