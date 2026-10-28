import { useDb } from '../../../db/client'
import { enqueueDrafts } from '../../../lib/outreach'

export default defineEventHandler((event) => {
  try {
    return enqueueDrafts(useDb(), idParam(event), 'dashboard').map(j => ({ id: j.id, title: j.title }))
  }
  catch (err) {
    toHttpError(err)
  }
})
