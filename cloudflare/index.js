// Helper function for JSON responses
function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// GitHub action trigger function
async function triggerGitHubAction(token, inputs) {
  const response = await fetch(
    'https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/firmware-extraction.yml/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'FCE-Worker',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs
      })
    }
  );

  // Handle response properly
  const responseText = await response.text().catch(() => 'Unable to read response');
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: responseText
  };
}

// Check GitHub run status
async function checkGitHubRun(token, trackId) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'FCE-Worker',
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!response.ok) return 'error';

    const { workflow_runs } = await response.json();
    const relevantRuns = workflow_runs.filter(run => 
      (run.inputs && run.inputs.track === trackId)
    );

    if (relevantRuns.length === 0) return 'not_found';
    
    const latestRun = relevantRuns[0];
    return ['in_progress', 'queued', 'pending', 'requested'].includes(latestRun.status) 
      ? 'active' 
      : 'not_found';
  } catch (error) {
    console.error('GitHub API error:', error);
    return 'error';
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const params = url.searchParams;
      
      // Validate required parameters
      const imageType = params.get('type')?.toLowerCase() || 'boot';
      const firmwareUrl = params.get('url');

      if (!firmwareUrl) {
        return jsonResponse(400, { error: 'Missing URL parameter' });
      }

      if (!['boot', 'recovery', 'modem'].includes(imageType)) {
        return jsonResponse(400, { error: 'Invalid image type. Must be boot, recovery, or modem' });
      }

      // Normalize URL
      const normalizedUrl = firmwareUrl.split('.zip')[0] + '.zip';
      const firmwareName = normalizedUrl.split('/').pop().replace('.zip', '');
      const kvKey = `${imageType}:${firmwareName}`;

      // Check existing processing
      const existingTrack = await env.FCE_KV.get(kvKey);
      if (existingTrack) {
        const runStatus = await checkGitHubRun(env.GTKK, existingTrack);
        
        if (runStatus === 'error') {
          return jsonResponse(500, { error: 'Failed to check run status' });
        }
        
        if (runStatus === 'not_found') {
          await env.FCE_KV.delete(kvKey);
          return jsonResponse(200, { status: 'retry' });
        }
        
        return jsonResponse(200, { 
          status: 'processing',
          track_id: existingTrack
        });
      }

      // Start new processing
      const trackId = Date.now().toString();
      await env.FCE_KV.put(kvKey, trackId, { expirationTtl: 1800 });

      const dispatch = await triggerGitHubAction(env.GTKK, {
        url: normalizedUrl,
        track: trackId,
        image_type: imageType
      });

      if (!dispatch.ok) {
        await env.FCE_KV.delete(kvKey);
        return jsonResponse(500, { 
          error: 'Dispatch failed',
          details: `${dispatch.status} ${dispatch.statusText}`,
          api_response: dispatch.body
        });
      }

      return jsonResponse(200, { 
        status: 'processing',
        track_id: trackId,
        image_type: imageType,
        url: normalizedUrl
      });

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(500, { 
        error: 'Internal server error',
        details: error.message 
      });
    }
  }
}
