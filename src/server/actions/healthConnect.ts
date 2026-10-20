"use server";
// Settings › Data source › Phone: pair (create the endpoint and show its code), show the code again, rotate the
// secret, unpair. The secret and the pairing QR reach the browser only on these calls, never in a page render.
import QRCode from "qrcode";
import { revalidatePath } from "next/cache";
import { currentUser, SIGNED_OUT } from "@/server/auth";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import { createEndpoint, endpointOf, ingestUrl, pairingLink, removeEndpoint, revealSecret, rotateSecret } from "@/server/sources/healthConnect/endpoint";
import type { ActionResult } from "./journal";

export type Pairing = {
  url: string;
  secret: string;
  /** The link the app's "Scan a pairing code" reads. */
  link: string;
  /** That link as a QR code, a PNG data URL. */
  qr: string;
};

const NO_APP_URL = "Set APP_URL on the server (the address your phone can reach), then try again.";
const NO_SECRET = "Set BETTER_AUTH_SECRET on the server first: it seals the phone’s secret.";

async function pairing(publicId: string, secret: string): Promise<ActionResult<Pairing>> {
  const { appUrl } = getConfig();
  if (!appUrl) return { ok: false, error: NO_APP_URL };
  const url = ingestUrl(appUrl, publicId);
  const link = pairingLink(url, secret);
  const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, errorCorrectionLevel: "M" });
  return { ok: true, data: { url, secret, link, qr } };
}

function gate() {
  const cfg = getConfig();
  if (cfg.demo) return "Not available on a demo instance";
  if (!cfg.authSecret) return NO_SECRET;
  if (!cfg.appUrl) return NO_APP_URL;
  return null;
}

/** Creates (or replaces) the user's endpoint and returns its pairing code. */
export async function createIngestEndpoint(): Promise<ActionResult<Pairing>> {
  const user = await currentUser();
  if (!user) return SIGNED_OUT;
  const blocked = gate();
  if (blocked) return { ok: false, error: blocked };
  const { publicId, secret } = await createEndpoint(getDb(), user.userId);
  revalidatePath("/", "layout");
  return pairing(publicId, secret);
}

/** The existing endpoint's pairing code again (a second phone, a reinstall). */
export async function revealIngestPairing(): Promise<ActionResult<Pairing>> {
  const user = await currentUser();
  if (!user) return SIGNED_OUT;
  const blocked = gate();
  if (blocked) return { ok: false, error: blocked };
  const db = getDb();
  const ep = await endpointOf(db, user.userId);
  const secret = ep && (await revealSecret(db, user.userId));
  if (!ep || !secret) return { ok: false, error: "The phone’s secret can’t be read (BETTER_AUTH_SECRET changed?). Pair again to make a new one." };
  return pairing(ep.publicId, secret);
}

/** A new secret on the same URL; the phone must scan the new code. */
export async function rotateIngestSecret(): Promise<ActionResult<Pairing>> {
  const user = await currentUser();
  if (!user) return SIGNED_OUT;
  const blocked = gate();
  if (blocked) return { ok: false, error: blocked };
  const db = getDb();
  const ep = await endpointOf(db, user.userId);
  const secret = ep && (await rotateSecret(db, user.userId));
  if (!ep || !secret) return { ok: false, error: "No phone is paired." };
  revalidatePath("/", "layout");
  return pairing(ep.publicId, secret);
}

/** Forgets the endpoint: the URL stops answering. What the phone sent stays. */
export async function removeIngestEndpoint(): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return SIGNED_OUT;
  await removeEndpoint(getDb(), user.userId);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
