import { useDb } from '../db/client'
import { getDailyTokenCap } from '../lib/settings'

export default defineEventHandler(() => ({
  dailyTokenCap: getDailyTokenCap(useDb()),
  defaultCwd: process.cwd(),
}))
