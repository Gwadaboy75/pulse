// Where uploaded documents live: `<DOCUMENTS_DIR>/<userId>/<documentId>.<ext>`. The database row names the file by
// that relative path; the id is random, so a path never says what a document is, and the extension only what kind
// of file. Nothing outside the directory is ever read or written.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config";

/** What the upload accepts: PDFs and the photo formats phones take. */
export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const documentsDir = () => path.resolve(process.cwd(), getConfig().documents.dir);
export const maxDocumentBytes = () => getConfig().documents.maxBytes;

/** The absolute path of a stored document; refuses a relative path that would leave the directory. */
export function documentPath(relative: string): string {
  const root = documentsDir();
  const abs = path.resolve(root, relative);
  if (!abs.startsWith(root + path.sep)) throw new Error("bad_path");
  return abs;
}

/** Makes the directory at boot (instrumentation) so a missing volume fails early and loudly. */
export async function ensureDocumentsDir(): Promise<void> {
  await fs.mkdir(documentsDir(), { recursive: true });
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Writes a new document file and returns its id and relative path. */
export async function storeDocument(userId: number, bytes: Uint8Array, mime: string): Promise<{ id: string; filePath: string }> {
  const ext = DOCUMENT_TYPES[mime];
  if (!ext) throw new Error("bad_type");
  const id = randomUUID();
  const filePath = path.posix.join(String(userId), `${id}.${ext}`);
  const abs = documentPath(filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, bytes, { flag: "wx" });
  return { id, filePath };
}

export const readDocument = (filePath: string) => fs.readFile(documentPath(filePath));

/** Removes a document's file; a file already gone is fine. */
export async function removeDocumentFile(filePath: string): Promise<void> {
  await fs.rm(documentPath(filePath), { force: true });
}
