import { z } from 'zod'
import { useDb } from '../../../db/client'
import { resolveProposal } from '../../../lib/portfolio'

const body = z.object({ action: z.enum(['apply', 'discard']) })

export default defineEventHandler(async (event) => {
  try {
    return resolveProposal(useDb(), idParam(event), body.parse(await readBody(event)).action)
  }
  catch (err) {
    toHttpError(err)
  }
})
