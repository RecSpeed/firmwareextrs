export default {
  async fetch(req, env) {
    const urlParams = new URL(req.url).searchParams;
    const get = urlParams.get("get");
    let url = urlParams.get("url");

    if (!url || !get) {
  return new Response("Missing 'get' or 'url' parameter.", { status: 400 });
}

// 🌐 CDN düzeltme
const domains = [
  "ultimateota.d.miui.com", "superota.d.miui.com", "bigota.d.miui.com", "cdnorg.d.miui.com",
  "bn.d.miui.com", "hugeota.d.miui.com", "cdn-ota.azureedge.net", "airtel.bigota.d.miui.com"
];
for (const domain of domains) {
  if (url.includes(domain)) {
    url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
    break;
  }
}

if (!url.includes(".zip")) {
  return new Response("Only .zip URLs are supported.", { status: 400 });
}

url = url.split(".zip")[0] + ".zip";
const name = url.split("/").pop().replace(".zip", "");
const kvKey = `${get}:${name}`;

// 1️⃣ KV: Eğer önceki track varsa en son ID'yi KV'den al
const lastTrack = await env.FCE_KV.get(kvKey);

// 2️⃣ Eğer release varsa direkt link ver
const releaseRes = await fetch("https://api.github.com/repos/RecSpeed/firmwareextrs/releases/tags/auto", {
  headers: {
    Authorization: `token ${env.GTKK}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "FCE Worker"
  }
});

if (releaseRes.ok) {
  const release = await releaseRes.json();
  const expectedName = `${get}_${name}.zip`;
  const asset = release.assets.find(a => a.name === expectedName);
  if (asset) {
    return new Response(`link: ${asset.browser_download_url}`, { status: 200 });
  }
}

// 2.5️⃣ v.json: daha önce "false" olarak işaretlenmiş mi?
try {
  const vjson = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
  if (vjson.ok) {
    const data = await vjson.json();
    const match = Object.entries(data).find(([k]) => k.startsWith(name));
    if (match) {
      const [, values] = match;
      if (values[`${get}_zip`] === "false") {
        return new Response(`❌ Requested image (${get}) not found`, { status: 404 });
      }
    }
  }
} catch (_) {}

// 3️⃣ Eğer önceki track varsa kontrol et (başarısız olmuş olabilir)
if (lastTrack) {
  const runsRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/runs`, {
    headers: {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "FCE Worker"
    }
  });

  if (runsRes.ok) {
    const runsData = await runsRes.json();
    const relatedRun = runsData.workflow_runs.find(run =>
      run.head_branch === "main" && run.name === lastTrack
    );

    if (relatedRun && relatedRun.status === "completed") {
      if (relatedRun.conclusion === "failure") {
        return new Response(`❌ Requested image (${get}) not found.`, { status: 404 });
      } else if (relatedRun.conclusion === "success") {
        // Worker zaten kontrol etti, release geç düştüyse kullanıcı kendisi tekrar deneyebilir
        return new Response(`Track complete. Check release.`, { status: 200 });
      }
    }

    return new Response(`Track progress: https://github.com/RecSpeed/firmwareextrs/actions/runs/${relatedRun.id}`, { status: 202 });
  }
}

// 4️⃣ Yeni job başlat
const newTrack = Date.now().toString();
await env.FCE_KV.put(kvKey, newTrack, { expirationTtl: 180 });

const dispatchRes = await fetch(`https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml/dispatches`, {
  method: "POST",
  headers: {
    Authorization: `token ${env.GTKK}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
    "User-Agent": "FCE Worker"
  },
  body: JSON.stringify({
    ref: "main",
    inputs: {
      url,
      get,
      track: newTrack
    }
  })
});

if (dispatchRes.ok) {
  return new Response(`✅ Build started for ${name} [${get}]\nTrack progress: https://github.com/RecSpeed/firmwareextrs/actions`, {
    status: 202
  });
}

const err = await dispatchRes.text();
return new Response(`GitHub Dispatch Error: ${err}`, { status: 500 });

