import { z } from 'zod'
import { useDb } from '../../../db/client'
import { decideMessage } from '../../../lib/outreach'

const body = z.object({ decision: z.enum(['approve', 'discard']) })

export default defineEventHandler(async (event) => {
  try {
    return decideMessage(useDb(), idParam(event), body.parse(await readBody(event)).decision, 'dashboard')
  }
  catch (err) {
    toHttpError(err)
  }
})
