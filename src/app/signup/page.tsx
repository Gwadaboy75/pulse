import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { redirect } from "next/navigation"
import { inviteValid, signupMode, userCount } from "@/server/admin"
import { currentUser } from "@/server/auth"
import { getConfig } from "@/server/config"
import { getDb } from "@/server/db"
import { SignupForm } from "@/components/auth/AuthForm"
import { AUTH_FOOTNOTE, AUTH_LINK } from "@/components/auth/AuthHero"
import { AuthShell } from "@/components/shells/AuthShell"

// The invite token is in this page's URL: never send it on as a Referer.
export const metadata: Metadata = { title: "Create account", referrer: "no-referrer" }

/**
 * Create an account `/signup`. Closed on a demo instance. Otherwise by the sign-up mode (admin panel, else SIGNUP):
 * open shows the form; invite-only needs `?invite=` from an admin's link; closed goes back to sign-in. A new server
 * (no accounts yet) shows the form for its owner, whose ADMIN_EMAILS address needs no invite then, and only then
 * (auth.ts checks it).
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  await connection()
  if (await currentUser()) redirect("/")
  const { demo, adminEmails } = getConfig()
  if (demo) redirect("/login")
  const db = getDb()
  const [mode, first, { invite }] = await Promise.all([signupMode(db), userCount(db).then((n) => n === 0), searchParams])
  const valid = mode === "invite" && !!invite && (await inviteValid(db, invite))

  const signIn = (
    <p className={AUTH_FOOTNOTE}>
      Already have an account?{" "}
      <Link href="/login" className={AUTH_LINK}>
        Sign in
      </Link>
    </p>
  )
  // No hero: on a phone the four fields and the button fit above the keyboard's fold.
  const heading = (title: string, body: string) => (
    <>
      <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em] text-balance">{title}</h1>
      <p className="mt-2 text-[16px] leading-6 text-pretty text-foreground-secondary">{body}</p>
    </>
  )
  const notice = (title: string, body: string) => (
    <AuthShell align="top">
      {heading(title, body)}
      <div className="mt-7">{signIn}</div>
    </AuthShell>
  )

  if (first && mode !== "open" && adminEmails.length === 0)
    return notice("Set up an admin first", "Add your email to ADMIN_EMAILS in this server’s .env and restart it, then create your account here.")
  if (!first && mode === "closed") redirect("/login")
  if (!first && mode === "invite" && !valid)
    return invite
      ? notice("This invite has expired", "The link was already used, has expired or was revoked. Ask whoever runs this server for a new one.")
      : notice("Pulse here is invite-only", "Ask whoever runs this server for an invite link.")

  return (
    <AuthShell align="top">
      {heading(
        "Create your account",
        first && mode !== "open" ? "This server has no accounts yet. Use the admin email set in ADMIN_EMAILS." : "Your data stays on this server, visible only to you.",
      )}
      <div className="mt-7 space-y-5 pb-[max(env(safe-area-inset-bottom),24px)]">
        <SignupForm invite={valid ? invite : undefined} />
        {signIn}
      </div>
    </AuthShell>
  )
}
