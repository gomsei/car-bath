import { fetchAvailability, parseAvailabilityParams } from "../../src/availability";

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const date = url.searchParams.get("date");

  try {
    const params = parseAvailabilityParams(date);
    const data = await fetchAvailability(params.start);
    return jsonResponse(200, data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "조회에 실패했습니다.";
    const status = message.includes("YYYY-MM-DD") ? 400 : 502;
    return jsonResponse(status, { error: message });
  }
};
