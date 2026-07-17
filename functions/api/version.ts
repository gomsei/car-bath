function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

interface Env {
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

async function resolveBuildTime(env: Env, request: Request): Promise<string> {
  const assetUrl = new URL("/.build-time", request.url);
  if (env.ASSETS) {
    try {
      const res = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text) {
          return text;
        }
      }
    } catch {
      // ASSETS 실패 시 origin 직접 조회
    }
  }
  try {
    const res = await fetch(assetUrl.toString(), { cf: { cacheTtl: 0 } });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text) {
        return text;
      }
    }
  } catch {
    // 네트워크 오류
  }
  return new Date(0).toISOString();
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const v = await resolveBuildTime(context.env, context.request);
  return json({ v });
};
