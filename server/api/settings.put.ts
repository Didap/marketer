import { useDb } from '../db/client'
import { getDailyTokenCap, setDailyTokenCap, settingsInput } from '../lib/settings'

export default defineEventHandler(async (event) => {
  const db = useDb()
  try {
    const input = settingsInput.parse(await readBody(event))
    if (input.dailyTokenCap !== undefined) setDailyTokenCap(db, input.dailyTokenCap)
  }
  catch (err) {
    toHttpError(err)
  }
  return { dailyTokenCap: getDailyTokenCap(db) }
})
