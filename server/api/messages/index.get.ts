import { useDb } from '../../db/client'
import { approvalQueue } from '../../lib/outreach'

export default defineEventHandler(() => approvalQueue(useDb()))
