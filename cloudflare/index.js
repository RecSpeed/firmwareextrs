export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const params = url.searchParams;
      
      // Input validation
      const imageType = params.get('type')?.toLowerCase() || 'boot';
      const validTypes = ['boot', 'recovery', 'modem'];
      if (!validTypes.includes(imageType)) {
        return jsonResponse(400, { status: 'error', message: `Invalid type. Use: ${validTypes.join(', ')}` });
      }

      let firmwareUrl = params.get('url');
      if (!firmwareUrl || !firmwareUrl.includes('.zip')) {
        return jsonResponse(400, { status: 'error', message: 'Valid .zip URL required' });
      }

      // Normalize URL
      firmwareUrl = firmwareUrl.split('.zip')[0] + '.zip';
      const firmwareName = firmwareUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // Check existing processing
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const activeRun = await checkActiveRun(env.GTKK, existingTrack);
        if (!activeRun) {
          await env.FCE_KV.delete(kvKey);
          return jsonResponse(404, { status: 'retry', message: 'Stale process cleared' });
        }
        return jsonResponse(200, {
          status: 'processing',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
          image_type: imageType
        });
      }

      // Check existing release
      const existingAsset = await checkExistingRelease(env.GTKK, imageType, firmwareName);
      if (existingAsset) {
        return jsonResponse(200, {
          status: 'ready',
          download_url: existingAsset.browser_download_url,
          image_type: imageType
        });
      }

      // Start new process
      const trackId = Date.now().toString();
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 1800 }); // 30 minutes

      const dispatchResult = await triggerWorkflow(env.GTKK, {
        url: firmwareUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatchResult.ok) {
        await env.FCE_KV.delete(kvKey);
        const error = await dispatchResult.text();
        return jsonResponse(500, { status: 'error', message: `Dispatch failed: ${error}` });
      }

      return jsonResponse(200, {
        status: 'processing',
        tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions',
        image_type: imageType
      });

    } catch (error) {
      return jsonResponse(500, { status: 'error', message: error.message });
    }
  }
};

// Helper functions
async function checkActiveRun(token, trackId) {
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
  return workflow_runs.some(run => 
    run.name === 'Firmware Extraction' && 
    run.status === 'in_progress' &&
    run.inputs?.track === trackId
  );
}

async function checkExistingRelease(token, imageType, firmwareName) {
  const response = await fetch(
    'https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto',
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker'
      }
    }
  );
  
  if (!response.ok) return null;
  
  const { assets } = await response.json();
  return assets.find(asset => asset.name === `${imageType}_${firmwareName}.zip`);
}

async function triggerWorkflow(token, inputs) {
  return fetch(
    'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
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

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
