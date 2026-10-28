import { useDb } from '../../db/client'
import { listCampaigns } from '../../lib/outreach'

export default defineEventHandler(() => listCampaigns(useDb()))
