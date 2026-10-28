import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db/client'
import { jobs, prospects } from '../../../db/schema'
import { campaignLegalPreview, DRAFTS_JOB_KIND, getCampaign, listMessages, messageContext } from '../../../lib/outreach'

export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const campaign = getCampaign(db, idParam(event))
    const qualified = db.select({ n: sql<number>`count(*)` }).from(prospects)
      .where(and(eq(prospects.segmentId, campaign.segmentId), eq(prospects.status, 'qualified'))).get()?.n ?? 0
    const drafting = db.select({ id: jobs.id, status: jobs.status }).from(jobs)
      .where(and(eq(jobs.kind, DRAFTS_JOB_KIND), sql`${jobs.title} like ${`Bozze: ${campaign.name}%`}`, sql`${jobs.status} in ('queued', 'running')`)).get() ?? null
    return {
      campaign,
      legal: campaignLegalPreview(db, campaign),
      qualified,
      drafting,
      messages: listMessages(db, { campaignId: campaign.id }).map(m => messageContext(db, m)),
    }
  }
  catch (err) {
    toHttpError(err)
  }
})
