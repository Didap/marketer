import { z } from 'zod'
import { useDb } from '../../../db/client'
import { SEGMENT_STATUSES } from '../../../db/schema'
import { setSegmentStatus } from '../../../lib/prospects'

const body = z.object({ status: z.enum(SEGMENT_STATUSES) })

export default defineEventHandler(async (event) => {
  try {
    return setSegmentStatus(useDb(), idParam(event), body.parse(await readBody(event)).status)
  }
  catch (err) {
    toHttpError(err)
  }
})
