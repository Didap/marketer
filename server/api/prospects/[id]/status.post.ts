import { z } from 'zod'
import { useDb } from '../../../db/client'
import { PROSPECT_STATUSES } from '../../../db/schema'
import { setProspectStatus } from '../../../lib/prospects'

const body = z.object({ status: z.enum(PROSPECT_STATUSES) })

export default defineEventHandler(async (event) => {
  try {
    return setProspectStatus(useDb(), idParam(event), body.parse(await readBody(event)).status)
  }
  catch (err) {
    toHttpError(err)
  }
})
