import { strFromU8, unzipSync } from 'fflate'
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { DEFAULT_SHEET_NAMES, extractSpreadsheetId, fetchClosedAppointments, fetchHandlerCounts } from '../shared/handlerCounts'

const callsSheetsCollection = collection(db, 'callsSheets')
const selectionDoc = doc(db, 'settings', 'callsSheetSelection')

export { DEFAULT_SHEET_NAMES, fetchClosedAppointments, fetchHandlerCounts }

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

export async function saveCallsSheet({ id, url, sheetNames, title, updatedBy, tabGids, handlerHeader, validHandlers, availableLabels, closedAppointmentTabs }) {
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
    closedAppointmentTabs: closedAppointmentTabs || [],
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

// Google Sheets addresses tabs by a numeric gid in the URL fragment, not by name,
// and that gid isn't recoverable from the CSV export this app reads (see
// fetchHandlerCounts) — so it comes from whatever an admin entered in Calls Sheet
// settings. Falls back to the plain spreadsheet link when a tab has none saved.
export function googleSheetTabUrl(rawUrl, gid) {
  const spreadsheetId = extractSpreadsheetId(rawUrl)
  return gid ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}` : `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
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
// quota, sheet not accessible to the key) just means an empty map, not a broken save —
// but the reason is logged (not swallowed silently) so a stuck admin can actually debug it.
async function fetchTabGids(spreadsheetId) {
  if (!SHEETS_API_KEY) {
    return { gids: {}, warning: '' }
  }
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${SHEETS_API_KEY}&fields=sheets.properties`)
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      // Seen in practice: a spreadsheet that's really an uploaded Excel file opened in
      // Google's Office-compatibility mode (not "converted" to a native Google Sheet).
      // The gviz CSV/xlsx export this app otherwise relies on doesn't care, but the
      // real Sheets API refuses to read those documents at all — no gid will ever be
      // fetchable for it until the file is converted to a native Google Sheet.
      const isOfficeFile = body?.error?.message?.includes('Office file')
      const reason = isOfficeFile
        ? 'This sheet is an uploaded Excel file opened in Google\'s compatibility mode — the Sheets API can\'t read tab IDs from it. Convert it to a native Google Sheet (File → Save as Google Sheets) to enable auto-fill, or enter gids manually below.'
        : `Could not auto-fetch tab IDs (Sheets API responded ${response.status}). Enter gids manually below.`
      console.warn(`[callsSheet] tab gid auto-fill failed: Sheets API responded ${response.status}`, body)
      return { gids: {}, warning: reason }
    }
    const data = await response.json()
    // Trimmed so the key always matches the trimmed tab name used everywhere else in
    // the UI/save path (sheetNames, tabGidsInput lookups) — a tab title with stray
    // leading/trailing whitespace (common — easy to type by accident) would otherwise
    // fetch its gid successfully here but never actually show up in the input box.
    const gids = Object.fromEntries((data.sheets || []).map((sheet) => [sheet.properties.title.trim(), String(sheet.properties.sheetId)]))
    return { gids, warning: '' }
  } catch (err) {
    console.warn('[callsSheet] tab gid auto-fill failed:', err.message)
    return { gids: {}, warning: `Could not auto-fetch tab IDs: ${err.message}. Enter gids manually below.` }
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
  const tabNames = [...xml.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((match) => decodeXmlEntities(match[1]).trim())
  if (!tabNames.length) throw new Error('Could not find any tabs in that sheet.')
  const { gids: tabGids, warning: tabGidWarning } = await fetchTabGids(spreadsheetId)
  return { title, tabNames, tabGids, tabGidWarning }
}

