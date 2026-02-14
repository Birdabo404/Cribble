export type ActivityDay = {
  date: string
  score: number
}

const toDateKeyUtc = (date: Date) => date.toISOString().split('T')[0]

const addDaysUtc = (dateKey: string, deltaDays: number) => {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return toDateKeyUtc(date)
}

export const calculateStreak = (
  activity: ActivityDay[],
  todayKey: string = toDateKeyUtc(new Date())
) => {
  const activeDates = new Set(
    activity.filter((day) => day.score > 0).map((day) => day.date)
  )

  let streak = 0
  let cursor = todayKey

  while (activeDates.has(cursor)) {
    streak += 1
    cursor = addDaysUtc(cursor, -1)
  }

  return streak
}
