import { z } from 'zod'
import { useDb } from '../../db/client'
import { enqueuePortfolioImport } from '../../lib/portfolio'

const body = z.object({ paths: z.array(z.string().trim().min(1).max(1024)).max(100).optional() })

export default defineEventHandler(async (event) => {
  try {
    const { paths } = body.parse((await readBody(event)) ?? {})
    return enqueuePortfolioImport(useDb(), paths, 'dashboard').map(j => ({ id: j.id, title: j.title }))
  }
  catch (err) {
    toHttpError(err)
  }
})
