import Papa from 'papaparse'
import { parseSheetDate } from './sheetDates.js'
import { workDateKey } from './workCalendar.js'

// Pure sheet-reading logic with no Firebase or browser-only dependencies, so the
// browser dashboard and the scheduled Cloud Function (functions/index.js, which gets a
// copy of this file on deploy) read the calls sheet through exactly the same code.

export const DEFAULT_SHEET_NAMES = ['ORA', 'ALA', 'AMA', 'BUT', 'CAL', 'COL', 'CC', 'DN', 'ED', 'FRE', 'GLE', 'HUM', 'IMP', 'INY', 'KER', 'KIN', 'LAK', 'LAS', 'LA', 'MEN', 'MER', 'VEN', 'YOL', 'YUB']

export function extractSpreadsheetId(rawUrl) {
  const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) throw new Error('That does not look like a Google Sheets URL.')
  return idMatch[1]
}

function sheetCsvUrl(spreadsheetId, sheetName) {
  // The cache-busting param defeats Google's own response caching for this
  // endpoint, which otherwise sometimes keeps serving a stale/wrong tab's
  // content for a name it briefly failed to resolve (see fetchHandlerCounts).
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// Reads the closed-appointment tabs (see the Calls sheet settings), which are lists of
// booked appointments rather than call logs, so they're kept out of fetchHandlerCounts.
// Columns are found by header text, wherever the header row sits; rows with no practice
// name (the empty bordered rows the sheet ships with) are dropped.
export async function fetchClosedAppointments(rawUrl, tabNames) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  const names = (tabNames || []).map((name) => name.trim()).filter(Boolean)
  const appointments = []
  await Promise.all(names.map(async (name) => {
    const response = await fetch(sheetCsvUrl(spreadsheetId, name), { cache: 'no-store' })
    const csvText = await response.text()
    if (!response.ok || csvText.trim().startsWith('<')) throw new Error(`Could not read the "${name}" tab.`)
    const { data: rows } = Papa.parse(csvText, { skipEmptyLines: true })
    const lower = (cell) => (cell || '').trim().toLowerCase()
    const headerIndex = rows.findIndex((row) => row.some((cell) => lower(cell).startsWith('name of practice')))
    if (headerIndex === -1) return
    const header = rows[headerIndex]
    const column = (needle) => header.findIndex((cell) => lower(cell).startsWith(needle))
    const cols = {
      practice: column('name of practice'),
      location: column('location'),
      pocName: column('poc name'),
      pocPosition: column('poc position'),
      handler: column('handler'),
      dateClosed: column('date closed'),
      appointment: column('appointment'),
    }
    const read = (row, index) => (index === -1 ? '' : (row[index] || '').trim())
    rows.slice(headerIndex + 1).forEach((row, order) => {
      const practice = read(row, cols.practice)
      if (!practice || practice === '-') return
      appointments.push({
        tab: name,
        order,
        practice,
        location: read(row, cols.location),
        pocName: read(row, cols.pocName),
        pocPosition: read(row, cols.pocPosition),
        handler: read(row, cols.handler),
        dateClosed: read(row, cols.dateClosed),
        appointment: read(row, cols.appointment),
      })
    })
  }))
  // Newest first: by the closed date, falling back to sheet order (later rows are newer).
  return appointments.sort((a, b) => (Date.parse(b.dateClosed) || 0) - (Date.parse(a.dateClosed) || 0) || b.order - a.order)
}

export async function fetchHandlerCounts(rawUrl, sheetNames, { handlerHeader = 'Handler', validHandlers, availableLabels, excludeTabs } = {}) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  const excluded = new Set((excludeTabs || []).map((name) => name.trim()))
  const names = (sheetNames?.length ? sheetNames : DEFAULT_SHEET_NAMES).map((name) => name.trim()).filter((name) => name && !excluded.has(name))
  if (!names.length) throw new Error('No sheet tabs to scan were configured.')
  const headerNeedle = (handlerHeader || 'Handler').trim().toLowerCase()
  const allowedHandlers = validHandlers?.length ? new Set(validHandlers) : null
  const availableLabelSet = new Set((availableLabels?.length ? availableLabels : ['Available to Call']).map((label) => label.trim().toLowerCase()))

  // Multi-word values (available labels, plus any multi-word employee names), longest
  // first so the most specific phrase wins when scanning the jammed header cell.
  const knownPhrases = [...(availableLabels?.length ? availableLabels : ['Available to Call']), ...(validHandlers || [])]
    .map((text) => text.trim())
    .filter((text) => /\s/.test(text))
    .map((text) => ({ text, words: text.toLowerCase().split(/\s+/) }))
    .sort((a, b) => b.words.length - a.words.length)

  async function fetchTab(name) {
    try {
      const response = await fetch(sheetCsvUrl(spreadsheetId, name), { cache: 'no-store' })
      const csvText = await response.text()
      if (!response.ok || csvText.trim().startsWith('<')) return { name, error: 'tab was not found' }
      return { name, csvText }
    } catch (err) {
      return { name, error: err.message }
    }
  }

  // Capped rather than a single Promise.all of every tab: firing 20+ requests at Google's
  // export endpoint at once is exactly the kind of burst that trips its undocumented rate
  // limiting, which shows up either as an outright failed response or (worse, silently) as
  // one tab's request coming back with another tab's content instead of erroring.
  let fetched = await mapWithConcurrency(names, 6, (name) => fetchTab(name))

  // Whatever still failed outright, or whose text exactly matches an already-accepted
  // tab's (that silent wrong-tab fallback), gets a few spaced-out retries — each one away
  // from a fresh burst — before it's finally treated as a real failure/duplicate rather
  // than reported with different tabs missing on every refresh.
  for (let attempt = 0; attempt < 3; attempt++) {
    const seenSoFar = new Set()
    const retryIndexes = []
    for (let index = 0; index < fetched.length; index++) {
      const item = fetched[index]
      if (item.error) { retryIndexes.push(index); continue }
      if (seenSoFar.has(item.csvText)) retryIndexes.push(index)
      else seenSoFar.add(item.csvText)
    }
    if (!retryIndexes.length) break
    await sleep(500 * (attempt + 1))
    const retried = await mapWithConcurrency(retryIndexes, 3, (index) => fetchTab(names[index]))
    retryIndexes.forEach((index, position) => { fetched[index] = retried[position] })
  }

  const merged = new Map()
  // Calls per work day per handler, from each row's DATE cell: { 'YYYY-MM-DD': { handler: n } }.
  // A handled row with no date (or one that isn't a readable date) still counts toward the
  // totals above, but there's no day to put it on, so it's left out of this.
  const daily = {}
  const todayKey = workDateKey()
  const scanned = []
  const skipped = []
  const seenTexts = new Set()
  const perTab = []
  const allHandlerNames = new Set()

  for (const item of fetched) {
    if (item.error) {
      skipped.push({ name: item.name, reason: item.error })
      continue
    }
    if (seenTexts.has(item.csvText)) {
      skipped.push({ name: item.name, reason: "tab not found (server returned another tab's data)" })
      continue
    }
    seenTexts.add(item.csvText)

    const { data: parsedRows } = Papa.parse(item.csvText, { skipEmptyLines: true })
    // skipEmptyLines only drops rows where every cell is exactly "" — a trailing
    // row with a single stray space (a common Google Sheets export artifact) slips
    // through as "data" and gets miscounted as an available/blank-handler row, so
    // rows that are blank once each cell is trimmed are dropped here too. A lone
    // "-" is treated the same way: sheets that use "-" as their own "no data"
    // placeholder (seen throughout real sheets, e.g. blank emails) sometimes end
    // with a trailing row that's just "-" in one column and blank everywhere
    // else — not a real record, but it would otherwise survive this filter and
    // get miscounted as one more unassigned "available" row.
    const isBlankCell = (cell) => ['', '-'].includes((cell || '').trim())
    const rows = parsedRows.filter((row) => row.some((cell) => !isBlankCell(cell)))
    if (!rows.length) {
      scanned.push(item.name)
      perTab.push({ name: item.name, total: 0, available: 0, availableRows: [], counts: [], statusByHandler: {} })
      continue
    }

    // The "Handler" header isn't always row 1, or column A — banner rows and
    // leading summary columns are common, so scan every cell of every row for
    // wherever it actually is rather than assuming a fixed position. Matched
    // with startsWith (not exact equality): Google's CSV export sometimes jams
    // a whole batch of a column's row values onto the header cell itself
    // (seen with collapsed/grouped rows), e.g. "Handler Kyla Kyla Kyla ...".
    const headerRowIndex = rows.findIndex((row) => row.some((cell) => (cell || '').trim().toLowerCase().startsWith(headerNeedle)))
    if (headerRowIndex === -1) {
      skipped.push({ name: item.name, reason: `no "${handlerHeader}" column` })
      continue
    }
    const handlerColIndex = rows[headerRowIndex].findIndex((cell) => (cell || '').trim().toLowerCase().startsWith(headerNeedle))
    // Same header row as Handler, found the same way — a handler's status breakdown
    // (below) needs to know which rows had which status, so this looks for a column
    // literally headed "Status" rather than requiring an admin to configure it, since
    // that's the fixed name this feature expects in the sheet.
    const statusColIndex = rows[headerRowIndex].findIndex((cell) => (cell || '').trim().toLowerCase().startsWith('status'))
    // The column the call's date is logged in; not every tab has one.
    const dateColIndex = rows[headerRowIndex].findIndex((cell) => (cell || '').trim().toLowerCase().startsWith('date'))

    scanned.push(item.name)
    const tabCounts = new Map()
    const statusByHandler = new Map()
    let available = 0
    const availableRows = []

    // Recover the values Google's export jammed onto the header cell itself (see
    // above) — everything after the leading header word is a real handler
    // value for one of the rows that got squashed in, not part of the header.
    // Values are space-joined, so a multi-word value ("Available to Call") must be matched
    // as a whole phrase against the known multi-word labels/names rather than split into
    // one fake handler per word.
    const headerCellTokens = (rows[headerRowIndex][handlerColIndex] || '').trim().split(/\s+/)
    const jammedValues = []
    for (let index = 1; index < headerCellTokens.length;) {
      const phrase = knownPhrases.find((candidate) => candidate.words.length <= headerCellTokens.length - index
        && candidate.words.every((word, offset) => headerCellTokens[index + offset].toLowerCase() === word))
      if (phrase) {
        jammedValues.push(phrase.text)
        index += phrase.words.length
      } else {
        jammedValues.push(headerCellTokens[index])
        index += 1
      }
    }
    for (const rawName of jammedValues) {
      if (availableLabelSet.has(rawName.toLowerCase())) {
        allHandlerNames.add(rawName)
        continue
      }
      allHandlerNames.add(rawName)
      if (allowedHandlers && !allowedHandlers.has(rawName)) continue
      merged.set(rawName, (merged.get(rawName) || 0) + 1)
      tabCounts.set(rawName, (tabCounts.get(rawName) || 0) + 1)
    }

    for (const row of rows.slice(headerRowIndex + 1)) {
      const rawName = (row[handlerColIndex] || '').trim()
      // A stray repeated header row (e.g. a frozen header Google's export sometimes
      // emits again below a banner row that itself matched headerNeedle first) would
      // otherwise read as a real, blank-adjacent value here and fall straight into
      // the "available" bucket below — skip it outright instead of counting it
      // either as a handler or as an open slot.
      if (rawName.toLowerCase() === headerNeedle) continue
      if (rawName) allHandlerNames.add(rawName)
      // Blank cells, a lone "-" (this sheet's own "no data" placeholder), and
      // whichever value is configured to mean "unassigned" (e.g. "Available to
      // Call") all mean the slot is open — none of them are a real handler name.
      if (!rawName || rawName === '-' || availableLabelSet.has(rawName.toLowerCase())) {
        // A leftover row isn't a real open slot unless it has real data in more than
        // one other column — a genuine record has a name, phone, etc.; a leftover
        // row with nothing but a single stray note (e.g. "email brochure sent" typed
        // into an otherwise empty row) doesn't represent an actual unassigned call.
        const realCellCount = row.filter((cell, index) => index !== handlerColIndex && !isBlankCell(cell)).length
        if (realCellCount < 2) continue
        available += 1
        // A short, human-recognizable preview of the row (from its other columns)
        // so an admin who believes every row is handled can find the actual row in
        // Sheets — e.g. one hidden by a filter view or a collapsed group, which
        // still appears in this raw CSV export even though it's not visible there.
        const preview = row
          .filter((_, index) => index !== handlerColIndex)
          .map((cell) => (cell || '').trim())
          .filter((cell) => cell && cell !== '-')
          .slice(0, 3)
          .join(' · ')
        availableRows.push(preview || 'Blank row')
        continue
      }
      if (allowedHandlers && !allowedHandlers.has(rawName)) continue
      merged.set(rawName, (merged.get(rawName) || 0) + 1)
      tabCounts.set(rawName, (tabCounts.get(rawName) || 0) + 1)
      const callDate = dateColIndex !== -1 ? parseSheetDate(row[dateColIndex], todayKey) : null
      if (callDate) {
        const dayCounts = daily[callDate] || (daily[callDate] = {})
        dayCounts[rawName] = (dayCounts[rawName] || 0) + 1
      }
      if (statusColIndex !== -1) {
        const statusValue = (row[statusColIndex] || '').trim() || 'No status'
        const handlerStatuses = statusByHandler.get(rawName) || new Map()
        handlerStatuses.set(statusValue, (handlerStatuses.get(statusValue) || 0) + 1)
        statusByHandler.set(rawName, handlerStatuses)
      }
    }
    const tabCountList = [...tabCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    const statusByHandlerObj = Object.fromEntries([...statusByHandler.entries()].map(([name, statusMap]) => [
      name,
      [...statusMap.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    ]))
    perTab.push({ name: item.name, total: tabCountList.reduce((sum, entry) => sum + entry.count, 0), available, availableRows, counts: tabCountList, statusByHandler: statusByHandlerObj })
  }

  if (!scanned.length) throw new Error('None of the configured sheet tabs could be read. Check the tab names and the sheet\'s sharing settings.')

  const counts = [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  // Numbers changing between refreshes is otherwise invisible — this makes it possible to
  // tell, from the browser console, whether a given refresh actually failed to read some
  // tabs (skipped.length > 0) versus successfully reading all of them but still landing on
  // different totals (which would point to the sheet's data itself changing, not a fetch
  // problem).
  if (skipped.length) console.warn(`[callsSheet] ${skipped.length}/${names.length} tab(s) skipped`, skipped)
  else console.info(`[callsSheet] all ${scanned.length} tab(s) scanned OK, total calls counted: ${counts.reduce((sum, item) => sum + item.count, 0)}`)

  return { counts, daily, scanned, skipped, perTab, allHandlerNames: [...allHandlerNames].sort() }
}
