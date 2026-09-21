import Papa from 'papaparse'
import { strFromU8, unzipSync } from 'fflate'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'

const callsSheetsCollection = collection(db, 'callsSheets')
const selectionDoc = doc(db, 'settings', 'callsSheetSelection')

export const DEFAULT_SHEET_NAMES = ['ORA', 'ALA', 'AMA', 'BUT', 'CAL', 'COL', 'CC', 'DN', 'ED', 'FRE', 'GLE', 'HUM', 'IMP', 'INY', 'KER', 'KIN', 'LAK', 'LAS', 'LA', 'MEN', 'MER', 'VEN', 'YOL', 'YUB']

export function callsSheetDocument(id) {
  return doc(callsSheetsCollection, id)
}

export function subscribeToCallsSheets(onChange, onError) {
  return onSnapshot(
    callsSheetsCollection,
    (snapshot) => onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
    onError,
  )
}

export async function saveCallsSheet({ id, url, sheetNames, title, updatedBy, tabGids, handlerHeader, validHandlers, availableLabels }) {
  const ref = id ? callsSheetDocument(id) : doc(callsSheetsCollection)
  await setDoc(ref, {
    url,
    sheetNames,
    title,
    updatedBy,
    tabGids: tabGids || {},
    handlerHeader: handlerHeader || 'Handler',
    validHandlers: validHandlers || [],
    availableLabels: availableLabels || [],
    updatedAt: new Date().toISOString(),
  }, { merge: true })
  return ref.id
}

export async function deleteCallsSheet(id) {
  await deleteDoc(callsSheetDocument(id))
}

export function subscribeToCallsSheetSelection(onChange, onError) {
  return onSnapshot(selectionDoc, (snapshot) => onChange(snapshot.exists() ? snapshot.data().selectedId : null), onError)
}

export async function setCallsSheetSelection(selectedId) {
  await setDoc(selectionDoc, { selectedId }, { merge: true })
}

function extractSpreadsheetId(rawUrl) {
  const idMatch = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!idMatch) throw new Error('That does not look like a Google Sheets URL.')
  return idMatch[1]
}

// Google Sheets addresses tabs by a numeric gid in the URL fragment, not by name,
// and that gid isn't recoverable from the CSV export this app reads (see
// fetchHandlerCounts) — so it comes from whatever an admin entered in Calls Sheet
// settings. Falls back to the plain spreadsheet link when a tab has none saved.
export function googleSheetTabUrl(rawUrl, gid) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  return gid ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}` : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
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

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseTitleFromContentDisposition(disposition) {
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const rawValue = utf8Match ? utf8Match[1] : (disposition.match(/filename="?([^";]+)"?/i) || [])[1]
  if (!rawValue) return null
  try {
    return decodeURIComponent(rawValue).replace(/\.xlsx$/i, '').trim() || null
  } catch {
    return null
  }
}

const SHEETS_API_KEY = import.meta.env.VITE_GOOGLE_SHEETS_API_KEY

// Real tab gids (needed to deep-link to an exact tab — see googleSheetTabUrl) aren't
// present anywhere in the CSV/xlsx export this app otherwise relies on, so this is the
// one place that calls the real Sheets API instead. Best-effort: an admin can still
// paste gids in manually in Calls Sheet settings, so any failure here (missing key,
// quota, sheet not accessible to the key) just means an empty map, not a broken save.
async function fetchTabGids(spreadsheetId) {
  if (!SHEETS_API_KEY) return {}
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${SHEETS_API_KEY}&fields=sheets.properties`)
    if (!response.ok) return {}
    const data = await response.json()
    return Object.fromEntries((data.sheets || []).map((sheet) => [sheet.properties.title, String(sheet.properties.sheetId)]))
  } catch {
    return {}
  }
}

// Reads the real document title and tab names straight from the spreadsheet, rather
// than the caller guessing or typing them. Google's public CSV-export endpoint can
// only fetch one already-named tab at a time — it can't list what tabs exist, and it
// has no title — so instead this downloads the whole workbook as .xlsx (works for any
// "anyone with the link can view" sheet, no API key needed): the real title comes back
// in the Content-Disposition response header (Google exposes it for cross-origin
// reads), and the tab list comes from xl/workbook.xml inside the file (an .xlsx is
// just a zip archive). Tab gids, when a Sheets API key is configured, come from the
// real API alongside this — see fetchTabGids.
export async function fetchSheetMetadata(rawUrl) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`)
  if (!response.ok) throw new Error('Could not read that sheet. Check the link and that it\'s shared as "Anyone with the link can view".')
  const title = parseTitleFromContentDisposition(response.headers.get('content-disposition') || '') || 'Untitled sheet'
  const buffer = new Uint8Array(await response.arrayBuffer())
  const files = unzipSync(buffer, { filter: (file) => file.name === 'xl/workbook.xml' })
  const xml = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const tabNames = [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXmlEntities(match[1]))
  if (!tabNames.length) throw new Error('Could not find any tabs in that sheet.')
  const tabGids = await fetchTabGids(spreadsheetId)
  return { title, tabNames, tabGids }
}

export async function fetchHandlerCounts(rawUrl, sheetNames, { handlerHeader = 'Handler', validHandlers, availableLabels } = {}) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  const names = (sheetNames?.length ? sheetNames : DEFAULT_SHEET_NAMES).map((name) => name.trim()).filter(Boolean)
  if (!names.length) throw new Error('No sheet tabs to scan were configured.')
  const headerNeedle = (handlerHeader || 'Handler').trim().toLowerCase()
  const allowedHandlers = validHandlers?.length ? new Set(validHandlers) : null
  const availableLabelSet = new Set((availableLabels?.length ? availableLabels : ['Available to Call']).map((label) => label.trim().toLowerCase()))

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
      perTab.push({ name: item.name, total: 0, available: 0, availableRows: [], counts: [] })
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

    scanned.push(item.name)
    const tabCounts = new Map()
    let available = 0
    const availableRows = []

    // Recover the values Google's export jammed onto the header cell itself (see
    // above) — everything after the leading header word is a real handler
    // value for one of the rows that got squashed in, not part of the header.
    const headerCellTokens = (rows[headerRowIndex][handlerColIndex] || '').trim().split(/\s+/)
    for (const rawName of headerCellTokens.slice(1)) {
      allHandlerNames.add(rawName)
      if (allowedHandlers && !allowedHandlers.has(rawName)) continue
      merged.set(rawName, (merged.get(rawName) || 0) + 1)
      tabCounts.set(rawName, (tabCounts.get(rawName) || 0) + 1)
    }

    for (const row of rows.slice(headerRowIndex + 1)) {
      const rawName = (row[handlerColIndex] || '').trim()
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
    }
    const tabCountList = [...tabCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    perTab.push({ name: item.name, total: tabCountList.reduce((sum, entry) => sum + entry.count, 0), available, availableRows, counts: tabCountList })
  }

  if (!scanned.length) throw new Error('None of the configured sheet tabs could be read. Check the tab names and the sheet\'s sharing settings.')

  const counts = [...merged.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  return { counts, scanned, skipped, perTab, allHandlerNames: [...allHandlerNames].sort() }
}
