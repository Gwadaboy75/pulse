// Serves one of the signed-in user's documents from the documents volume (the viewer on /medical/documents/[id]).
// Private, never cached by a shared cache, shown inline.
import { and, eq } from "drizzle-orm";
import { requestUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { medicalDocuments } from "@/server/db/schema";
import { readDocument } from "@/server/medical/storage";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requestUser(req);
  if (!user) return new Response(null, { status: 401 });
  const { id } = await params;
  const [doc] = await getDb()
    .select({ filePath: medicalDocuments.filePath, mime: medicalDocuments.mime, title: medicalDocuments.title })
    .from(medicalDocuments)
    .where(and(eq(medicalDocuments.userId, user.userId), eq(medicalDocuments.id, id)));
  if (!doc) return new Response(null, { status: 404 });
  const bytes = await readDocument(doc.filePath).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": doc.mime,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.title.replace(/[\r\n"]/g, "") || "document")}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
