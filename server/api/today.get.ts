import { desc, eq, gte } from 'drizzle-orm'
import { useDb } from '../db/client'
import { activity, jobs } from '../db/schema'
import { overview } from '../lib/jobs'
import { pendingCount } from '../lib/outreach'

export default defineEventHandler(() => {
  const db = useDb()
  const base = overview(db)
  const since = new Date(Date.now() - 24 * 3600_000)
  return {
    ...base,
    pendingMessages: pendingCount(db),
    jobsToday: db.select({
      id: jobs.id,
      title: jobs.title,
      status: jobs.status,
      startedAt: jobs.startedAt,
      finishedAt: jobs.finishedAt,
      weightedTokens: jobs.weightedTokens,
      costUsd: jobs.costUsd,
    }).from(jobs).where(eq(jobs.day, base.guard.day)).orderBy(desc(jobs.id)).limit(50).all(),
    activity: db.select().from(activity).where(gte(activity.at, since)).orderBy(desc(activity.id)).limit(50).all(),
  }
})
