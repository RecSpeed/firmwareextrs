export default {
  async fetch(req, env) {
    const urlParams = new URLSearchParams(req.url.split("?")[1]);
    let url = urlParams.get("url");

    const domains = [
      "ultimateota.d.miui.com",
      "superota.d.miui.com",
      "bigota.d.miui.com",
      "cdnorg.d.miui.com",
      "bn.d.miui.com",
      "hugeota.d.miui.com",
      "cdn-ota.azureedge.net",
      "airtel.bigota.d.miui.com",
    ];

    if (url) {
      if (url.includes(".zip")) {
        url = url.split(".zip")[0] + ".zip";
      } else {
        return new Response("Only .zip URLs are supported.", { status: 400 });
      }

      for (const domain of domains) {
        if (url.includes(domain)) {
          url = url.replace(domain, "bkt-sgp-miui-ota-update-alisgp.oss-ap-southeast-1.aliyuncs.com");
          break;
        }
      }
    } else {
      return new Response(
        "Missing parameters!\n\nUsage:\ncurl fce.gmrec72.workers.dev?url=<url>\n\nExample:\ncurl fce.gmrec72.workers.dev?url=https://example.com/rom.zip",
        { status: 400 }
      );
    }

    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return new Response("The provided URL is not accessible.", { status: 400 });
    }

    const fileName = url.split("/").pop();
    const Name = fileName.split(".zip")[0];

    try {
      const vJsonResponse = await fetch("https://raw.githubusercontent.com/RecSpeed/firmwareextrs/main/v.json");
if (vJsonResponse.ok) {
  const data = await vJsonResponse.json();
  for (const key in data) {
    if (key.startsWith(Name)) {
      const values = data[key];

      if (values.boot_img_zip === "true" && values.boot_img_link) {
        return new Response(`link: ${values.boot_img_link}`, { status: 200 });
      }

      // Bu firmware için daha önce bir işlem başlatılmış ama henüz tamamlanmamış olabilir
      return new Response("Track progress: already running for this firmware", { status: 202 });
    }
  }
}
    } catch (error) {
      return new Response(`Error parsing v.json: ${error}`, { status: 500 });
    }

    // Yeni istek tetiklenmesi gerekiyorsa (ilk defa bu URL geliyor)
    const headers = {
      Authorization: `token ${env.GTKK}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      "User-Agent": "Cloudflare Worker",
    };

    const workflowApi = "https://api.github.com/repos/RecSpeed/firmwareextrs/actions/workflows/FCE.yml";
    const githubDispatchUrl = `${workflowApi}/dispatches`;
    const TRACK_URL = `${workflowApi}/runs`;

    const track = Date.now().toString();
    const data = { ref: "main", inputs: { url, track } };

    try {
      const githubResponse = await fetch(githubDispatchUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (githubResponse.ok) {
        while (true) {
          const trackResponse = await fetch(TRACK_URL, { method: "GET", headers });
          if (trackResponse.ok) {
            const workflowRuns = await trackResponse.json();
            for (const run of workflowRuns.workflow_runs) {
              const jobUrl = `${run.url}/jobs`;
              const jobResponse = await fetch(jobUrl, { method: "GET", headers });
              if (jobResponse.ok) {
                const jobData = await jobResponse.json();
                const job = jobData.jobs.find((job) => job.name === track);
                if (job) {
                  return new Response(`Track progress: ${job.html_url}`, { status: 200 });
                }
              }
            }
          }
        }
      } else {
        const errorText = await githubResponse.text();
        return new Response(`GitHub Response Error: ${errorText}`, { status: 500 });
      }
    } catch (error) {
      return new Response(`Dispatch Error: ${error.message}`, { status: 500 });
    }
  },
};
