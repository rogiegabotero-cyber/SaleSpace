const BLUE = '2F6FED'
const BLUE_SOFT = 'E8EFFE'
const GREY = 'F3F5F8'
const BORDER = { style: 'thin', color: { argb: 'FFD9DEE5' } }

function drawBarChart(rows, title) {
  const barWidth = 44
  const slot = 86
  const left = 60
  const top = 70
  const plotHeight = 300
  const bottom = 90
  const width = Math.max(760, left + rows.length * slot + 40)
  const height = top + plotHeight + bottom
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#1b2430'
  ctx.font = 'bold 20px Arial'
  ctx.textAlign = 'left'
  ctx.fillText(title, left, 36)

  const max = Math.max(1, ...rows.map((row) => row.count))
  // Round the axis ceiling up to a tidy number so gridlines land on whole values.
  const step = Math.pow(10, Math.floor(Math.log10(max)))
  const niceMax = Math.ceil(max / step) * step
  ctx.font = '12px Arial'
  ctx.textAlign = 'right'
  for (let tick = 0; tick <= 4; tick++) {
    const value = (niceMax / 4) * tick
    const y = top + plotHeight - (value / niceMax) * plotHeight
    ctx.strokeStyle = '#e3e7ed'
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(width - 20, y)
    ctx.stroke()
    ctx.fillStyle = '#6b7685'
    ctx.fillText(String(Math.round(value)), left - 8, y + 4)
  }

  rows.forEach((row, index) => {
    const x = left + index * slot + (slot - barWidth) / 2
    const barHeight = (row.count / niceMax) * plotHeight
    const y = top + plotHeight - barHeight
    ctx.fillStyle = `#${BLUE}`
    ctx.fillRect(x, y, barWidth, barHeight)
    ctx.textAlign = 'center'
    ctx.fillStyle = '#1b2430'
    ctx.font = 'bold 13px Arial'
    ctx.fillText(String(row.count), x + barWidth / 2, y - 6)
    ctx.font = '12px Arial'
    ctx.fillStyle = '#4a5565'
    const label = row.name.length > 12 ? `${row.name.slice(0, 11)}…` : row.name
    ctx.save()
    ctx.translate(x + barWidth / 2, top + plotHeight + 14)
    ctx.rotate(Math.PI / 6)
    ctx.textAlign = 'left'
    ctx.fillText(label, 0, 0)
    ctx.restore()
  })

  return { base64: canvas.toDataURL('image/png'), width, height }
}

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.alignment = { vertical: 'middle', horizontal: 'center' }
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE}` } }
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
  })
}

function styleBodyRow(row, { bold = false, fill = null } = {}) {
  row.eachCell((cell, colNumber) => {
    cell.border = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER }
    if (colNumber > 1) cell.alignment = { horizontal: 'center' }
    if (bold) cell.font = { bold: true }
    if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } }
  })
}

function addTitle(sheet, title, subtitle, columnCount) {
  sheet.mergeCells(1, 1, 1, Math.max(2, columnCount))
  sheet.getCell(1, 1).value = title
  sheet.getCell(1, 1).font = { bold: true, size: 15 }
  sheet.mergeCells(2, 1, 2, Math.max(2, columnCount))
  sheet.getCell(2, 1).value = subtitle
  sheet.getCell(2, 1).font = { italic: true, color: { argb: 'FF6B7685' } }
}

// Builds a single .xlsx for the selected month: a calls-per-employee table, its
// bar chart on its own tab, then the daily and weekly breakdowns each on their
// own tab. exceljs is imported on demand so it stays out of the main bundle.
export async function exportCallsReport({ monthLabel, sourceNote, callsPerEmployee, dailyRows, days, weeks, dailyByDate }) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.created = new Date()

  const grandTotal = callsPerEmployee.reduce((sum, row) => sum + row.count, 0)

  // 1 · Calls per employee (table)
  const perEmployee = workbook.addWorksheet('Calls per employee')
  addTitle(perEmployee, `Calls per employee · ${monthLabel}`, sourceNote, 4)
  perEmployee.columns = [{ width: 30 }, { width: 14 }, { width: 14 }, { width: 14 }]
  const perEmployeeHead = perEmployee.getRow(4)
  perEmployeeHead.values = ['Employee', 'Calls', '% of total', 'Rank']
  styleHeaderRow(perEmployeeHead)
  callsPerEmployee.forEach((row, index) => {
    const added = perEmployee.addRow([row.name, row.count, grandTotal ? row.count / grandTotal : 0, index + 1])
    added.getCell(3).numFmt = '0.0%'
    styleBodyRow(added)
  })
  const perEmployeeTotal = perEmployee.addRow(['Total', grandTotal, grandTotal ? 1 : 0, ''])
  perEmployeeTotal.getCell(3).numFmt = '0.0%'
  styleBodyRow(perEmployeeTotal, { bold: true, fill: GREY })

  // 2 · Chart on its own tab
  const chartSheet = workbook.addWorksheet('Calls per employee (chart)', { views: [{ showGridLines: false }] })
  if (callsPerEmployee.length) {
    const chart = drawBarChart(callsPerEmployee, `Calls per employee · ${monthLabel}`)
    const imageId = workbook.addImage({ base64: chart.base64, extension: 'png' })
    chartSheet.addImage(imageId, { tl: { col: 0.2, row: 0.5 }, ext: { width: chart.width, height: chart.height } })
  } else {
    chartSheet.getCell(1, 1).value = 'No handler data for this month.'
  }

  // 3 · Daily calls
  const daily = workbook.addWorksheet('Daily calls', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] })
  addTitle(daily, `Daily calls · ${monthLabel}`, 'Calls taken per employee per day', days.length + 2)
  daily.getColumn(1).width = 30
  for (let col = 2; col <= days.length + 1; col++) daily.getColumn(col).width = 5
  daily.getColumn(days.length + 2).width = 10
  const weekdayRow = daily.getRow(3)
  weekdayRow.values = ['', ...days.map((day) => day.weekday), '']
  weekdayRow.font = { size: 9, color: { argb: 'FF6B7685' } }
  weekdayRow.alignment = { horizontal: 'center' }
  const dailyHead = daily.getRow(4)
  dailyHead.values = ['Employee', ...days.map((day) => day.label), 'Total']
  styleHeaderRow(dailyHead)
  const dayTotals = days.map(() => 0)
  dailyRows.forEach((employee) => {
    const counts = days.map((day) => dailyByDate[day.key]?.[employee.key] || 0)
    counts.forEach((count, index) => { dayTotals[index] += count })
    const added = daily.addRow([employee.name, ...counts.map((count) => count || ''), counts.reduce((a, b) => a + b, 0)])
    styleBodyRow(added)
    days.forEach((day, index) => {
      if (day.weekend) added.getCell(index + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${GREY}` } }
      if (counts[index]) added.getCell(index + 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${BLUE_SOFT}` } }
    })
    added.getCell(days.length + 2).font = { bold: true }
  })
  const dailyTotalRow = daily.addRow(['Team total', ...dayTotals.map((count) => count || ''), dayTotals.reduce((a, b) => a + b, 0)])
  styleBodyRow(dailyTotalRow, { bold: true, fill: GREY })

  // 4 · Weekly calls
  const weekly = workbook.addWorksheet('Weekly calls', { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] })
  addTitle(weekly, `Weekly calls · ${monthLabel}`, 'Calls taken per employee, week by week (Sunday–Saturday)', weeks.length + 2)
  weekly.getColumn(1).width = 30
  for (let col = 2; col <= weeks.length + 1; col++) weekly.getColumn(col).width = 18
  weekly.getColumn(weeks.length + 2).width = 10
  const weeklyHead = weekly.getRow(3)
  weeklyHead.values = ['Employee', ...weeks.map((week) => week.label), 'Total']
  styleHeaderRow(weeklyHead)
  const weekTotals = weeks.map(() => 0)
  dailyRows.forEach((employee) => {
    const counts = weeks.map((week) => {
      let sum = 0
      for (const [date, byEmployee] of Object.entries(dailyByDate)) {
        if (date >= week.startKey && date <= week.endKey) sum += byEmployee[employee.key] || 0
      }
      return sum
    })
    counts.forEach((count, index) => { weekTotals[index] += count })
    const added = weekly.addRow([employee.name, ...counts, counts.reduce((a, b) => a + b, 0)])
    styleBodyRow(added)
    added.getCell(weeks.length + 2).font = { bold: true }
  })
  const weeklyTotalRow = weekly.addRow(['Team total', ...weekTotals, weekTotals.reduce((a, b) => a + b, 0)])
  styleBodyRow(weeklyTotalRow, { bold: true, fill: GREY })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `Calls-Report-${monthLabel.replace(/\s+/g, '-')}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const PDF_MARGIN = 12
const PDF_ROW_HEIGHT = 6.4

function pdfText(value) {
  return String(value ?? '').replace(/[–—]/g, '-')
}

// Draws a table that flows onto new pages as needed, repeating the header row.
// jsPDF has no built-in table support, so column widths are given in mm.
function drawPdfTable(doc, { startY, title, head, rows, colWidths, footRowCount = 0, shadeCell }) {
  const pageHeight = doc.internal.pageSize.getHeight()
  let y = startY
  const drawHead = () => {
    let x = PDF_MARGIN
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    head.forEach((label, index) => {
      doc.setFillColor(47, 111, 237)
      doc.rect(x, y, colWidths[index], PDF_ROW_HEIGHT, 'F')
      doc.setTextColor(255, 255, 255)
      if (index === 0) doc.text(pdfText(label), x + 2, y + 4.4)
      else doc.text(pdfText(label), x + colWidths[index] / 2, y + 4.4, { align: 'center' })
      x += colWidths[index]
    })
    y += PDF_ROW_HEIGHT
  }
  if (title) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(27, 36, 48)
    doc.text(pdfText(title), PDF_MARGIN, y)
    y += 5
  }
  drawHead()
  rows.forEach((row, rowIndex) => {
    if (y + PDF_ROW_HEIGHT > pageHeight - PDF_MARGIN) {
      doc.addPage()
      y = PDF_MARGIN
      drawHead()
    }
    const isFoot = rowIndex >= rows.length - footRowCount
    let x = PDF_MARGIN
    row.forEach((cell, index) => {
      const shade = isFoot ? [243, 245, 248] : shadeCell?.(rowIndex, index, cell)
      if (shade) {
        doc.setFillColor(...shade)
        doc.rect(x, y, colWidths[index], PDF_ROW_HEIGHT, 'F')
      }
      doc.setDrawColor(217, 222, 229)
      doc.rect(x, y, colWidths[index], PDF_ROW_HEIGHT, 'S')
      doc.setFont('helvetica', isFoot || index === 0 ? 'bold' : 'normal')
      doc.setFontSize(8)
      doc.setTextColor(27, 36, 48)
      const text = pdfText(cell)
      if (index === 0) {
        const fitted = doc.splitTextToSize(text, colWidths[index] - 3)[0] || ''
        doc.text(fitted, x + 2, y + 4.4)
      } else {
        doc.text(text, x + colWidths[index] / 2, y + 4.4, { align: 'center' })
      }
      x += colWidths[index]
    })
    y += PDF_ROW_HEIGHT
  })
  return y
}

function pdfPageTitle(doc, title, subtitle) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(27, 36, 48)
  doc.text(pdfText(title), PDF_MARGIN, PDF_MARGIN + 5)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(107, 118, 133)
  doc.text(pdfText(subtitle), PDF_MARGIN, PDF_MARGIN + 11)
  return PDF_MARGIN + 18
}

// Same content as the Excel report, laid out as PDF pages: calls per employee
// (table), its chart, then the daily and weekly breakdowns, each on its own page.
export async function exportCallsReportPdf({ monthLabel, sourceNote, callsPerEmployee, dailyRows, days, weeks, dailyByDate }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const usableWidth = pageWidth - PDF_MARGIN * 2
  const grandTotal = callsPerEmployee.reduce((sum, row) => sum + row.count, 0)

  // 1 · Calls per employee (table)
  let y = pdfPageTitle(doc, `Calls per employee - ${monthLabel}`, sourceNote)
  drawPdfTable(doc, {
    startY: y,
    head: ['Employee', 'Calls', '% of total', 'Rank'],
    rows: [
      ...callsPerEmployee.map((row, index) => [row.name, row.count, `${grandTotal ? ((row.count / grandTotal) * 100).toFixed(1) : '0.0'}%`, index + 1]),
      ['Total', grandTotal, grandTotal ? '100.0%' : '0.0%', ''],
    ],
    colWidths: [90, 40, 40, 30],
    footRowCount: 1,
  })

  // 2 · Chart
  doc.addPage()
  y = pdfPageTitle(doc, `Calls per employee (chart) - ${monthLabel}`, sourceNote)
  if (callsPerEmployee.length) {
    const chart = drawBarChart(callsPerEmployee, `Calls per employee - ${monthLabel}`)
    const maxHeight = doc.internal.pageSize.getHeight() - y - PDF_MARGIN
    const scale = Math.min(usableWidth / chart.width, maxHeight / chart.height)
    doc.addImage(chart.base64, 'PNG', PDF_MARGIN, y, chart.width * scale, chart.height * scale)
  } else {
    doc.setFontSize(10)
    doc.text('No handler data for this month.', PDF_MARGIN, y + 4)
  }

  // 3 · Daily calls
  doc.addPage()
  y = pdfPageTitle(doc, `Daily calls - ${monthLabel}`, 'Calls taken per employee per day')
  const nameWidth = 42
  const totalWidth = 13
  const dayWidth = (usableWidth - nameWidth - totalWidth) / days.length
  const dayTotals = days.map(() => 0)
  const dailyBody = dailyRows.map((employee) => {
    const counts = days.map((day) => dailyByDate[day.key]?.[employee.key] || 0)
    counts.forEach((count, index) => { dayTotals[index] += count })
    return [employee.name, ...counts.map((count) => count || ''), counts.reduce((a, b) => a + b, 0)]
  })
  dailyBody.push(['Team total', ...dayTotals.map((count) => count || ''), dayTotals.reduce((a, b) => a + b, 0)])
  drawPdfTable(doc, {
    startY: y,
    head: ['Employee', ...days.map((day) => String(day.label)), 'Total'],
    rows: dailyBody,
    colWidths: [nameWidth, ...days.map(() => dayWidth), totalWidth],
    footRowCount: 1,
    shadeCell: (rowIndex, colIndex, cell) => (colIndex > 0 && colIndex <= days.length && cell ? [232, 239, 254] : null),
  })

  // 4 · Weekly calls
  doc.addPage()
  y = pdfPageTitle(doc, `Weekly calls - ${monthLabel}`, 'Calls taken per employee, week by week (Sunday-Saturday)')
  const weekWidth = Math.min(40, (usableWidth - 70 - 20) / Math.max(1, weeks.length))
  const weekTotals = weeks.map(() => 0)
  const weeklyBody = dailyRows.map((employee) => {
    const counts = weeks.map((week) => {
      let sum = 0
      for (const [date, byEmployee] of Object.entries(dailyByDate)) {
        if (date >= week.startKey && date <= week.endKey) sum += byEmployee[employee.key] || 0
      }
      return sum
    })
    counts.forEach((count, index) => { weekTotals[index] += count })
    return [employee.name, ...counts, counts.reduce((a, b) => a + b, 0)]
  })
  weeklyBody.push(['Team total', ...weekTotals, weekTotals.reduce((a, b) => a + b, 0)])
  drawPdfTable(doc, {
    startY: y,
    head: ['Employee', ...weeks.map((week) => week.label), 'Total'],
    rows: weeklyBody,
    colWidths: [70, ...weeks.map(() => weekWidth), 20],
    footRowCount: 1,
  })

  doc.save(`Calls-Report-${monthLabel.replace(/\s+/g, '-')}.pdf`)
}
