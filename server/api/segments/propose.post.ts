import { z } from 'zod'
import { useDb } from '../../db/client'
import { MARKETS } from '../../db/schema'
import { enqueueSegmentProposal } from '../../lib/prospects'

const body = z.object({ market: z.enum(MARKETS).optional() })

export default defineEventHandler(async (event) => {
  try {
    const { market } = body.parse((await readBody(event)) ?? {})
    const job = enqueueSegmentProposal(useDb(), market, 'dashboard')
    return { id: job.id, title: job.title }
  }
  catch (err) {
    toHttpError(err)
  }
})
