import { z } from 'zod'
import { useDb } from '../../../db/client'
import { ignoreSource } from '../../../lib/portfolio'

const body = z.object({ path: z.string().trim().min(1).max(1024), reason: z.string().trim().max(300).default('') })

export default defineEventHandler(async (event) => {
  try {
    const { path, reason } = body.parse(await readBody(event))
    ignoreSource(useDb(), path, reason || 'Ignorata da William', null)
    return { ok: true }
  }
  catch (err) {
    toHttpError(err)
  }
})
