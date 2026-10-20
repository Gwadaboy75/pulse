import { cache } from "react"
import { notFound, redirect } from "next/navigation"
import { isAdmin } from "@/server/admin"
import { currentUser } from "@/server/auth"
import { getConfig } from "@/server/config"
import { getDb } from "@/server/db"

/**
 * The admin dashboard's gate, for the layout and every page: signed in (else sign-in), an admin of a Google
 * instance (else 404, so the dashboard's existence isn't advertised). Server Actions check again themselves.
 */
export const adminGate = cache(async () => {
  const user = await currentUser()
  if (!user) redirect("/login")
  const db = getDb()
  if (getConfig().demo || !(await isAdmin(db, user.userId))) notFound()
  return { db, user }
})
