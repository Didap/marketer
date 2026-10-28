import { z } from 'zod'
import { useDb } from '../../../db/client'
import { PORTFOLIO_STATUSES } from '../../../db/schema'
import { setPortfolioStatus } from '../../../lib/portfolio'

const body = z.object({ status: z.enum(PORTFOLIO_STATUSES) })

export default defineEventHandler(async (event) => {
  try {
    return setPortfolioStatus(useDb(), idParam(event), body.parse(await readBody(event)).status)
  }
  catch (err) {
    toHttpError(err)
  }
})
