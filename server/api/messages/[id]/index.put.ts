import { useDb } from '../../../db/client'
import { editMessage, messageContext } from '../../../lib/outreach'

export default defineEventHandler(async (event) => {
  try {
    const db = useDb()
    return messageContext(db, editMessage(db, idParam(event), await readBody(event)))
  }
  catch (err) {
    toHttpError(err)
  }
})
