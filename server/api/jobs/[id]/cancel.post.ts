import { useDb } from '../../../db/client'
import { cancelJob } from '../../../lib/jobs'

export default defineEventHandler((event) => {
  try {
    return cancelJob(useDb(), idParam(event))
  }
  catch (err) {
    toHttpError(err)
  }
})
