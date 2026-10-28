import { z } from 'zod'
import { useDb } from '../../db/client'
import { PROSPECT_STATUSES } from '../../db/schema'
import { listProspects } from '../../lib/prospects'

const query = z.object({
  segmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(PROSPECT_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
})

export default defineEventHandler((event) => {
  try {
    return listProspects(useDb(), query.parse(getQuery(event)))
  }
  catch (err) {
    toHttpError(err)
  }
})
