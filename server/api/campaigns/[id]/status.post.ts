import { z } from 'zod'
import { useDb } from '../../../db/client'
import { CAMPAIGN_STATUSES } from '../../../db/schema'
import { setCampaignStatus } from '../../../lib/outreach'

const body = z.object({ status: z.enum(CAMPAIGN_STATUSES) })

export default defineEventHandler(async (event) => {
  try {
    return setCampaignStatus(useDb(), idParam(event), body.parse(await readBody(event)).status)
  }
  catch (err) {
    toHttpError(err)
  }
})
