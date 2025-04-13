export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url, "https://dummy.url").searchParams;
    let url = urlParams.get("url");
    let get = urlParams.get("get") || "boot_img";

if (!url || !url.includes(".zip")) {
  return new Response("❌ Missing or invalid 'url' parameter (.zip required).", { status: 400 });
}

url = url.split(".zip")[0] + ".zip";
const fileName = url.split("/").pop();
const name = fileName.replace(".zip", "");
const kvKey = `${get}:${name}`;

const cdnDomains = [
  "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com",
  "cdnorg.d.miui.com", "bn.d.miui.com", "hugeota.d.miui.com",
  "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
];
for (const domain of cdnDomains) {
  if (url.includes(domain)) {
    url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
    break;
  }
}

const headers = {
  Authorization: `Bearer ${env.GTKK}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "FCE Worker"
};

const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
  headers
});

if (releaseRes.ok) {
  const release = await releaseRes.json();
  const asset = release.assets.find(a => a.name === `${get}_${name}.zip`);
  if (asset) {
    return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
  }
}

const existingTrack = await env.FCE_KV.get(kvKey);
if (existingTrack) {
  const runStatusRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs/${existingTrack}`, {
    headers
  });

  if (runStatusRes.ok) {
    const runData = await runStatusRes.json();
    if (runData.status === "completed") {
      if (runData.conclusion === "success") {
        const refreshRelease = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
          headers
        });
        if (refreshRelease.ok) {
          const rel = await refreshRelease.json();
          const ready = rel.assets.find(a => a.name === `${get}_${name}.zip`);
          if (ready) {
            return new Response(`link: ${ready.browser_download_url}`, { status: 200 });
          }
        }
        return new Response("✅ Build done, release not yet updated.", { status: 202 });
      } else {
        return new Response("❌ Build failed or payload missing.", { status: 404 });
      }
    }
  }
}

const track = Date.now().toString();
await env.FCE_KV.put(kvKey, track, { expirationTtl: 180 });

const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
  method: "POST",
  headers: {
    ...headers,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    ref: "main",
    inputs: { url, get, track }
  })
});

if (!dispatchRes.ok) {
  const errText = await dispatchRes.text();
  return new Response(`GitHub Dispatch Error: ${errText}`, { status: 500 });
}

// 30x5s = 150s boyunca bekleyip release kontrolü yap
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000));

  const statusRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, { headers });
  if (statusRes.ok) {
    const data = await statusRes.json();
    const run = data.workflow_runs.find(w => w.name === track && w.head_branch === "main");

    if (run && run.status === "completed") {
      if (run.conclusion === "success") {
        const rel = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
          headers
        });
        if (rel.ok) {
          const release = await rel.json();
          const asset = release.assets.find(a => a.name === `${get}_${name}.zip`);
          if (asset) {
            return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
          }
        }
      } else {
        return new Response("❌ Build failed during execution.", { status: 404 });
      }
    }
  }
}

return new Response("⏳ Timeout: Process did not complete in time.", { status: 202 });

  }
};
