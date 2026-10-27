// Narrows a calls-sheet result (what fetchHandlerCounts returns) to the handlers `allowed`
// accepts, so every chart built from it — per-employee bars, daily and weekly tables, the
// trend, totals, exports — only ever sees the people in charge of calls. `allowed` takes the
// handler name as it is written in the sheet.
export function filterCallsResult(result, allowed) {
  if (!result) return result

  const counts = (result.counts || []).filter((item) => allowed(item.name))

  const daily = {}
  for (const [date, dayCounts] of Object.entries(result.daily || {})) {
    const kept = Object.fromEntries(Object.entries(dayCounts).filter(([name]) => allowed(name)))
    if (Object.keys(kept).length) daily[date] = kept
  }

  const perTab = (result.perTab || []).map((tab) => {
    const tabCounts = (tab.counts || []).filter((item) => allowed(item.name))
    return {
      ...tab,
      counts: tabCounts,
      total: tabCounts.reduce((sum, item) => sum + item.count, 0),
      statusByHandler: Object.fromEntries(Object.entries(tab.statusByHandler || {}).filter(([name]) => allowed(name))),
    }
  })

  return { ...result, counts, daily, perTab }
}
