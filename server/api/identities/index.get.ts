import { useDb } from '../../db/client'
import { listIdentities } from '../../lib/outreach'

export default defineEventHandler(() => listIdentities(useDb()))
