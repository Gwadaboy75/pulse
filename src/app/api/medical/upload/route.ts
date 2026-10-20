// Document upload (/medical/documents). A route handler, not a Server Action: actions are capped at 2 MB and a
// photographed prescription is bigger. The file goes to the documents volume, the row is made, and the extraction
// runs after the response. Same-origin only: a cross-site form post has no session cookie anyway, but a stray
// Origin is refused outright so an upload can never be made from another site.
import { after } from "next/server";
import { requestUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { medicalDocuments } from "@/server/db/schema";
import { extractDocument } from "@/server/medical/extract";
import { DOCUMENT_TYPES, maxDocumentBytes, sha256, storeDocument } from "@/server/medical/storage";
import { DOCUMENT_KINDS } from "@/server/medical/extraction";

const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const user = await requestUser(req);
  if (!user) return fail(401, "Signed out. Sign in again.");
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail(403, "forbidden");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return fail(400, "Choose a file");
  if (!DOCUMENT_TYPES[file.type]) return fail(415, "Use a PDF, or a JPEG, PNG or WebP photo");
  if (file.size > maxDocumentBytes()) return fail(413, `Use a file under ${Math.round(maxDocumentBytes() / 1024 / 1024)} MB`);
  const kindRaw = form?.get("kind");
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(String(kindRaw)) ? (kindRaw as (typeof DOCUMENT_KINDS)[number]) : "other";
  const titleRaw = form?.get("title");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const db = getDb();
  const { id, filePath } = await storeDocument(user.userId, bytes, file.type);
  const now = Math.floor(Date.now() / 1000);
  const fallbackTitle = filePath.split("/").at(-1)!;
  await db.insert(medicalDocuments).values({
    userId: user.userId,
    id,
    kind,
    title: typeof titleRaw === "string" && titleRaw.trim() ? titleRaw.trim().slice(0, 120) : fallbackTitle,
    filePath,
    mime: file.type,
    bytes: file.size,
    sha256: sha256(bytes),
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
  });
  after(() => extractDocument(db, user.userId, id));
  return Response.json({ ok: true, data: { id } }, { headers: { "cache-control": "no-store" } });
}
