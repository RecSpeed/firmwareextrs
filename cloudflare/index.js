export default {
  async fetch(request, env) {
    try {
      // Input validation
      const { searchParams } = new URL(request.url);
      const imageType = searchParams.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = searchParams.get('url');
      
      if (!['boot', 'recovery', 'modem'].includes(imageType)) {
        return jsonResponse(400, { error: 'Invalid image type' });
      }

      if (!firmwareUrl?.match(/\.zip($|\?)/i)) {
        return jsonResponse(400, { error: 'Invalid firmware URL' });
      }

      // Process request
      const normalizedUrl = firmwareUrl.split('.zip')[0] + '.zip';
      const firmwareName = normalizedUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // Check existing processing
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const isActive = await checkGitHubRun(env.GTKK, existingTrack);
        if (!isActive) await env.FCE_KV.delete(kvKey);
        return jsonResponse(isActive ? 200 : 404, {
          status: isActive ? 'processing' : 'retry',
          tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions'
        });
      }

      // Check existing release
      const asset = await checkGitHubRelease(env.GTKK, imageType, firmwareName);
      if (asset) {
        return jsonResponse(200, {
          status: 'ready',
          download_url: asset.browser_download_url
        });
      }

      // Start new process
      const trackId = Date.now().toString();
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 1800 });

      const dispatch = await triggerGitHubAction(env.GTKK, {
        url: normalizedUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatch.ok) {
        await env.FCE_KV.delete(kvKey);
        return jsonResponse(500, { error: 'Failed to start process' });
      }

      return jsonResponse(200, {
        status: 'processing',
        tracking_url: 'https://github.com/RecSpeed/firmwareextrs/actions'
      });

    } catch (error) {
      return jsonResponse(500, { error: error.message });
    }
  }
};

// Helper functions
async function checkGitHubRun(token, trackId) {
  const res = await fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs?status=in_progress', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { workflow_runs } = await res.json();
  return workflow_runs.some(run => run.inputs?.track === trackId);
}

async function checkGitHubRelease(token, imageType, firmwareName) {
  const res = await fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { assets } = await res.json();
  return assets.find(a => a.name === `${imageType}_${firmwareName}.zip`);
}

async function triggerGitHubAction(token, inputs) {
  return fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ref: 'main', inputs })
  });
}

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { 
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
