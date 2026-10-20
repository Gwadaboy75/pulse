// The phone's webhook (Life Dashboard Companion -> Pulse). Open to the internet, so it trusts nothing but the HMAC
// signature over the raw body with the endpoint's own secret (receive.ts); the proxy leaves api/ingest/ alone. The
// payload is archived and answered at once (the app gives up after 10 s), then the worker applies it.
import { getDb } from "@/server/db";
import { receive } from "@/server/sources/healthConnect/receive";
import { requestSync } from "@/server/worker";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = new Uint8Array(await req.arrayBuffer());
  const r = await receive(getDb(), { publicId: id, body, signature: req.headers.get("x-signature") });
  if (r.status === 202) requestSync({ userId: r.userId, force: true });
  return new Response(null, { status: r.status, headers: { "cache-control": "no-store" } });
}
