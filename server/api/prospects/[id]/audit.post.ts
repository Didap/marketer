import { useDb } from '../../../db/client'
import { enqueueAudit } from '../../../lib/prospects'

export default defineEventHandler((event) => {
  try {
    const audit = enqueueAudit(useDb(), idParam(event))
    return { id: audit.id, status: audit.status }
  }
  catch (err) {
    toHttpError(err)
  }
})
