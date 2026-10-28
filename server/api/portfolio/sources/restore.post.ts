import { z } from 'zod'
import { useDb } from '../../../db/client'
import { restoreSource } from '../../../lib/portfolio'

const body = z.object({ path: z.string().trim().min(1).max(1024) })

export default defineEventHandler(async (event) => {
  try {
    restoreSource(useDb(), body.parse(await readBody(event)).path)
    return { ok: true }
  }
  catch (err) {
    toHttpError(err)
  }
})
