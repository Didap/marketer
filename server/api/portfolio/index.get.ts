import { z } from 'zod'
import { useDb } from '../../db/client'
import { PORTFOLIO_KINDS, PORTFOLIO_STATUSES } from '../../db/schema'
import { listPortfolio } from '../../lib/portfolio'

const query = z.object({
  kind: z.enum(PORTFOLIO_KINDS).optional(),
  status: z.enum(PORTFOLIO_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
})

export default defineEventHandler((event) => {
  try {
    return listPortfolio(useDb(), query.parse(getQuery(event)))
  }
  catch (err) {
    toHttpError(err)
  }
})
