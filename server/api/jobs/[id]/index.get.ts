import { useDb } from '../../../db/client'
import { getJob } from '../../../lib/jobs'

export default defineEventHandler((event) => {
  try {
    return getJob(useDb(), idParam(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
