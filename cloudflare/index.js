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

      // Check KV for existing process
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const isActive = await checkActiveRun(env.GTKK, existingTrack);
        if (!isActive) await env.FCE_KV.delete(kvKey);
        return createResponse(isActive ? 200 : 404, {
          status: isActive ? 'processing' : 'retry',
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
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 1800 });

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

// Helper functions
async function checkActiveRun(token, trackId) {
  try {
    const response = await fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs?status=in_progress', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker',
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const { workflow_runs } = await response.json();
    return workflow_runs.some(run => run.inputs?.track === trackId);
  } catch (error) {
    console.error('Failed to check active runs:', error);
    return false;
  }
}

async function checkReleaseAsset(token, imageType, firmwareName) {
  try {
    const response = await fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker',
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${error}`);
    }

    const { assets } = await response.json();
    return assets.find(a => a.name === `${imageType}_${firmwareName}.zip`);
  } catch (error) {
    console.error('Failed to check release:', error);
    return null;
  }
}

async function triggerWorkflow(token, inputs) {
  return fetch('https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches', {
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
  });
}

function createResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
