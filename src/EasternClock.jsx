import { useEffect, useState } from 'react'
import './easternClock.css'
import { Icon } from './PortalShell'
import { WORK_TIME_ZONE } from './shared/workCalendar'

// A live clock in the team's work time zone (Eastern), the one the work day and the calls sheet
// are counted in, whatever zone the person looking is in. The zone name follows the season:
// EST in winter, EDT while daylight saving time is in effect.
const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: WORK_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: WORK_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric' })

export default function EasternClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const parts = timeFormat.formatToParts(now)
  const time = parts.filter((part) => part.type !== 'timeZoneName').map((part) => part.value).join('').trim()
  const zone = parts.find((part) => part.type === 'timeZoneName')?.value || 'ET'

  return <div className="eastern-clock" role="timer" aria-label={`Eastern time, ${time} ${zone}`}>
    <Icon name="clock" size={15} />
    <span className="eastern-clock-time">{time}</span>
    <span className="eastern-clock-zone">{zone}</span>
    <span className="eastern-clock-date">{dateFormat.format(now)}</span>
  </div>
}
