import { useDb } from '../../../db/client'
import { listIdeas, listMessages } from '../../../lib/outreach'
import { prospectDetail } from '../../../lib/prospects'

export default defineEventHandler((event) => {
  try {
    const db = useDb()
    const detail = prospectDetail(db, idParam(event))
    return { ...detail, ideas: listIdeas(db, detail.prospect.id), messages: listMessages(db, { prospectId: detail.prospect.id }) }
  }
  catch (err) {
    toHttpError(err)
  }
})
