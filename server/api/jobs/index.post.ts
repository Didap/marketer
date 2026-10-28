import { useDb } from '../../db/client'
import { enqueueJob } from '../../lib/jobs'

export default defineEventHandler(async (event) => {
  try {
    return enqueueJob(useDb(), await readBody(event), 'dashboard')
  }
  catch (err) {
    toHttpError(err)
  }
})
