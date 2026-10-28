import { useDb } from '../../../db/client'
import { enqueueIdeas } from '../../../lib/outreach'

export default defineEventHandler((event) => {
  try {
    const [job] = enqueueIdeas(useDb(), [idParam(event)], 'dashboard')
    return { id: job!.id, title: job!.title }
  }
  catch (err) {
    toHttpError(err)
  }
})
