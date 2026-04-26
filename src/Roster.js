import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

function getPeriodStart(view, baseDate = new Date()) {
  const d = new Date(baseDate)
  d.setHours(0, 0, 0, 0)
  if (view === 'week' || view === '4weeks') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  } else if (view === 'month' || view === '3month') {
    d.setDate(1)
  } else if (view === 'year') {
    d.setMonth(0, 1)
  }
  return d
}

function getDateRange(view, periodStart) {
  const dates = []
  const start = new Date(periodStart)
  let end
  if (view === 'week')   { end = new Date(start); end.setDate(start.getDate() + 7) }
  if (view === '4weeks') { end = new Date(start); end.setDate(start.getDate() + 28) }
  if (view === 'month')  { end = new Date(start.getFullYear(), start.getMonth() + 1, 1) }
  if (view === '3month') { end = new Date(start.getFullYear(), start.getMonth() + 3, 1) }
  if (view === 'year')   { end = new Date(start.getFullYear() + 1, 0, 1) }
  const cur = new Date(start)
  while (cur < end) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
  return dates
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

function isToday(date) {
  return formatDate(date) === formatDate(new Date())
}

const DAY_LETTERS = ['S','M','T','W','T','F','S']

function formatHeader(date, view) {
  if (view === 'week') return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const dayLetter = DAY_LETTERS[date.getDay()]
  return <><span className="th-day-letter">{dayLetter}</span><span className="th-day-num">{date.getDate()}</span></>
}

function getMonthGroups(dateRange) {
  const groups = []
  dateRange.forEach(d => {
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!groups.length || groups[groups.length - 1].key !== key) {
      groups.push({ key, label: d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }), count: 1 })
    } else {
      groups[groups.length - 1].count++
    }
  })
  return groups
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

function getPeriodLabel(view, periodStart, dateRange) {
  if (!dateRange.length) return ''
  const end = dateRange[dateRange.length - 1]
  if (view === 'week') {
    const wk = getISOWeek(periodStart)
    const s = periodStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    return `Wk ${wk} — ${s} to ${e}`
  }
  if (view === '4weeks') {
    const wk1 = getISOWeek(periodStart)
    const wk2 = getISOWeek(end)
    const s = periodStart.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    const e = end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    return `Wk ${wk1}–${wk2} — ${s} to ${e}`
  }
  if (view === 'month')  return periodStart.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  if (view === '3month') return `${periodStart.toLocaleDateString('en-AU', { month: 'short' })} – ${end.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}`
  if (view === 'year')   return String(periodStart.getFullYear())
  return ''
}

const TEAM_ORDER  = ['MOC Manager', 'Duty Managers', 'ATR Crew', 'DHC Crew', 'MOC Support']
const CODE_TO_NAME = { E: 'Earlies', L: 'Lates', D: 'Days', C: 'Cover' }
const SHORT_CODES  = {
  'Earlies': 'E', 'Lates': 'L', 'Days': 'D', 'Cover': 'C',
  'Sick': 'S', 'Overtime': 'OT', 'Overtime Earlies': 'OE', 'Overtime Lates': 'OL',
  'Leave Request': 'LR', 'Approved Leave': 'AL', 'Training': 'T',
}

const WORKING_SHIFTS = new Set(['Earlies', 'Lates', 'Days', 'Cover', 'Overtime', 'Overtime Earlies', 'Overtime Lates'])
const EARLY_SHIFTS   = new Set(['Earlies', 'Overtime Earlies'])
const LATE_SHIFTS    = new Set(['Lates', 'Overtime Lates'])
const ABSENCE_SHIFTS = new Set(['Sick', 'Leave Request', 'Approved Leave', 'Training'])


function getPatternShift(staffId, patternEntries, date) {
  const entries = patternEntries.filter(e => e.staff_id === staffId)
  if (!entries.length) return null
  const pattern = entries[0].patterns
  if (!pattern) return null

  // Compare calendar dates in UTC to avoid timezone/DST shifting week boundaries
  const [sy, sm, sd] = pattern.start_date.split('-').map(Number)
  const startUTC = Date.UTC(sy, sm - 1, sd)
  const dateUTC  = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())

  const weeksElapsed = Math.floor((dateUTC - startUTC) / (7 * 24 * 60 * 60 * 1000))
  const weekNumber = ((weeksElapsed % pattern.cycle_weeks) + pattern.cycle_weeks) % pattern.cycle_weeks + 1
  const dayOfWeek = (date.getDay() + 6) % 7

  const entry = entries.find(e => e.week_number === weekNumber && e.day_of_week === dayOfWeek)
  return entry ? { name: CODE_TO_NAME[entry.shift_code] || entry.shift_code, isPattern: true } : null
}

export default function Roster() {
  const [view, setView]               = useState('week')
  const [periodStart, setPeriodStart] = useState(() => getPeriodStart('week'))
  const [teams, setTeams]             = useState([])
  const [staff, setStaff]             = useState([])
  const [shiftTypes, setShiftTypes]   = useState([])
  const [patternEntries, setPatternEntries] = useState([])
  const [manualShifts, setManualShifts]     = useState([])
  const [loading, setLoading]         = useState(true)
  const [activeCell, setActiveCell]   = useState(null) // { staffId, teamId, dateStr }

  const dateRange = useMemo(() => getDateRange(view, periodStart), [view, periodStart])

  const manpowerByDate = useMemo(() => {
    if (!teams.length || !staff.length || !shiftTypes.length) return {}
    const dmTeam  = teams.find(t => t.name === 'Duty Managers')
    const atrTeam = teams.find(t => t.name === 'ATR Crew')
    const dhcTeam = teams.find(t => t.name === 'DHC Crew')
    const campbell = staff.find(s => s.name.toLowerCase().includes('campbell'))
    const dmStaff  = staff.filter(s => s.team_id === dmTeam?.id)
    const atrStaff = staff.filter(s => s.team_id === atrTeam?.id)
    const dhcStaff = staff.filter(s => s.team_id === dhcTeam?.id)
    // deduplicated pool for shift-bucket counts
    const mocPool = [...new Map(
      [...atrStaff, ...dhcStaff, ...dmStaff, ...(campbell ? [campbell] : [])].map(s => [s.id, s])
    ).values()]

    const result = {}
    dateRange.forEach(d => {
      const dateStr = formatDate(d)
      const getShiftName = (staffId) => {
        const manual = manualShifts.find(s => s.staff_id === staffId && s.date === dateStr)
        if (manual) return shiftTypes.find(t => t.id === manual.shift_type_id)?.name || null
        return getPatternShift(staffId, patternEntries, d)?.name || null
      }
      const working = (s) => { const n = getShiftName(s.id); return !!(n && WORKING_SHIFTS.has(n)) }

      const dmWorking  = dmStaff.filter(working).length
      const atrWorking = atrStaff.filter(working).length
      const dhcWorking = dhcStaff.filter(working).length
      const campbellWorking = campbell ? working(campbell) : false

      const subs        = dmWorking + (campbellWorking ? 1 : 0)
      const subsForAtr  = Math.min(subs, Math.max(0, 2 - atrWorking))
      const subsForDhc  = Math.min(subs - subsForAtr, Math.max(0, 2 - dhcWorking))

      let earlyCount = 0, lateCount = 0
      mocPool.forEach(s => {
        const n = getShiftName(s.id)
        if (!n) return
        if (EARLY_SHIFTS.has(n)) earlyCount++
        if (LATE_SHIFTS.has(n)) lateCount++
      })

      result[dateStr] = {
        dmCount: dmWorking,     dmOk: dmWorking >= 1,
        atrCount: atrWorking,   atrEffective: atrWorking + subsForAtr,  atrOk: atrWorking + subsForAtr >= 2,
        dhcCount: dhcWorking,   dhcEffective: dhcWorking + subsForDhc,  dhcOk: dhcWorking + subsForDhc >= 2,
        earlyCount,             earlyOk: earlyCount >= 2,
        lateCount,              lateOk: lateCount >= 2,
      }
    })
    return result
  }, [dateRange, manualShifts, patternEntries, staff, teams, shiftTypes])

  const absencesByStaff = useMemo(() => {
    const result = {}
    staff.forEach(s => {
      const typeCounts = {}
      dateRange.forEach(d => {
        const dateStr = formatDate(d)
        const manual = manualShifts.find(ms => ms.staff_id === s.id && ms.date === dateStr)
        const shiftName = manual
          ? shiftTypes.find(t => t.id === manual.shift_type_id)?.name
          : getPatternShift(s.id, patternEntries, d)?.name
        if (!shiftName || !ABSENCE_SHIFTS.has(shiftName)) return
        // Ignore training on a rostered rest day
        if (shiftName === 'Training' && !getPatternShift(s.id, patternEntries, d)) return
        typeCounts[shiftName] = (typeCounts[shiftName] || 0) + 1
      })
      if (Object.keys(typeCounts).length) result[s.id] = typeCounts
    })
    return result
  }, [dateRange, manualShifts, patternEntries, staff, shiftTypes])

  useEffect(() => {
    async function loadStatic() {
      const [teamsRes, staffRes, shiftTypesRes, patternRes] = await Promise.all([
        supabase.from('teams').select('*'),
        supabase.from('staff').select('*'),
        supabase.from('shift_types').select('*'),
        supabase.from('pattern_entries').select('*, patterns(cycle_weeks, start_date)'),
      ])
      setTeams(teamsRes.data || [])
      setStaff(staffRes.data || [])
      setShiftTypes(shiftTypesRes.data || [])
      setPatternEntries(patternRes.data || [])
      setLoading(false)
    }
    loadStatic()
  }, [])

  useEffect(() => {
    if (!dateRange.length) return
    async function loadShifts() {
      const start = formatDate(dateRange[0])
      const end   = formatDate(dateRange[dateRange.length - 1])
      const { data } = await supabase.from('shifts').select('*').gte('date', start).lte('date', end)
      setManualShifts(data || [])
    }
    loadShifts()
  }, [dateRange])

  function handleViewChange(newView) {
    setPeriodStart(getPeriodStart(newView, periodStart))
    setView(newView)
  }

  function navigate(direction) {
    const d = new Date(periodStart)
    if (view === 'week')   d.setDate(d.getDate() + direction * 7)
    if (view === '4weeks') d.setDate(d.getDate() + direction * 28)
    if (view === 'month')  d.setMonth(d.getMonth() + direction)
    if (view === '3month') d.setMonth(d.getMonth() + direction * 3)
    if (view === 'year')   d.setFullYear(d.getFullYear() + direction)
    setPeriodStart(d)
  }

  function getShift(staffId, date) {
    const manual = manualShifts.find(s => s.staff_id === staffId && s.date === formatDate(date))
    if (manual) {
      const shiftType = shiftTypes.find(t => t.id === manual.shift_type_id)
      return shiftType ? { name: shiftType.name, manualId: manual.id, isManual: true } : null
    }
    return getPatternShift(staffId, patternEntries, date)
  }

  async function selectShift(staffId, teamId, dateStr, shiftTypeId) {
    setActiveCell(null)
    const existing = manualShifts.find(s => s.staff_id === staffId && s.date === dateStr)

    if (!shiftTypeId) {
      if (existing) {
        await supabase.from('shifts').delete().eq('id', existing.id)
        setManualShifts(prev => prev.filter(s => s.id !== existing.id))
      }
      return
    }

    if (existing) {
      await supabase.from('shifts').update({ shift_type_id: shiftTypeId }).eq('id', existing.id)
      setManualShifts(prev => prev.map(s => s.id === existing.id ? { ...s, shift_type_id: shiftTypeId } : s))
    } else {
      const { data } = await supabase.from('shifts').insert({ staff_id: staffId, shift_type_id: shiftTypeId, date: dateStr }).select().single()
      setManualShifts(prev => [...prev, data])
    }
  }

  if (loading) return <p className="loading">Loading roster...</p>

  const sortedTeams = [...teams].sort((a, b) => TEAM_ORDER.indexOf(a.name) - TEAM_ORDER.indexOf(b.name))

  return (
    <div className="roster-wrapper">
      <div className="roster-controls">
        <div className="view-selector">
          {[
            { key: 'week',   label: 'Week' },
            { key: '4weeks', label: '4 Weeks' },
            { key: 'month',  label: 'Month' },
            { key: '3month', label: '3 Months' },
            { key: 'year',   label: 'Year' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`view-btn${view === key ? ' active' : ''}`}
              onClick={() => handleViewChange(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="nav-controls">
          <button className="nav-btn" onClick={() => navigate(-1)}>‹</button>

          {(view === 'week' || view === '4weeks') && (
            <span className="period-label">{getPeriodLabel(view, periodStart, dateRange)}</span>
          )}

          {(view === 'month' || view === '3month') && (
            <>
              <select
                className="period-select"
                value={periodStart.getMonth()}
                onChange={e => { const d = new Date(periodStart); d.setMonth(+e.target.value); d.setDate(1); setPeriodStart(d) }}
              >
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
              <select
                className="period-select"
                value={periodStart.getFullYear()}
                onChange={e => { const d = new Date(periodStart); d.setFullYear(+e.target.value); setPeriodStart(d) }}
              >
                {Array.from({ length: 10 }, (_, i) => 2025 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </>
          )}

          {view === 'year' && (
            <select
              className="period-select"
              value={periodStart.getFullYear()}
              onChange={e => setPeriodStart(new Date(+e.target.value, 0, 1))}
            >
              {Array.from({ length: 10 }, (_, i) => 2025 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}

          <button className="nav-btn" onClick={() => navigate(1)}>›</button>
        </div>
      </div>

      <div className="roster-scroll">
        <table className={`roster-table view-${view}`}>
          <thead>
            {view !== 'week' && (
              <tr>
                <th className="name-col"></th>
                {getMonthGroups(dateRange).map(g => (
                  <th key={g.key} colSpan={g.count} className="month-group-header">{g.label}</th>
                ))}
              </tr>
            )}
            <tr>
              <th className="name-col">{view === 'week' ? 'Name' : ''}</th>
              {dateRange.map(d => (
                <th
                  key={formatDate(d)}
                  className={[
                    isToday(d) ? 'today-col' : '',
                    d.getDate() === 1 && view !== 'week' ? 'month-start' : '',
                    d.getDay() === 1 && view !== 'week' && view !== '4weeks' ? 'week-start' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {formatHeader(d, view)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map(team => {
              const teamStaff = staff
                .filter(s => s.team_id === team.id)
                .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
              const mpKey = team.name === 'Duty Managers' ? 'dm'
                : team.name === 'ATR Crew' ? 'atr'
                : team.name === 'DHC Crew' ? 'dhc'
                : null
              const mpLabel = team.name === 'Duty Managers' ? '≥1 DM'
                : team.name === 'ATR Crew' ? '≥2 ATR'
                : team.name === 'DHC Crew' ? '≥2 DHC'
                : null
              const mpNeed = team.name === 'Duty Managers' ? 1 : 2

              return [
                <tr key={`team-${team.id}`} className="team-header-row">
                  <td colSpan={dateRange.length + 1}><span className="team-header-label">{team.name}</span></td>
                </tr>,
                ...teamStaff.map(person => (
                  <tr key={person.id}>
                    <td className="staff-name">
                      <span className="staff-name-text">{person.name}</span>
                      {absencesByStaff[person.id] && Object.entries(absencesByStaff[person.id]).map(([type, count]) => (
                        <span key={type} className="absence-count">{count} {type.toLowerCase()}</span>
                      ))}
                    </td>
                    {dateRange.map(d => {
                      const dateStr = formatDate(d)
                      const shift = getShift(person.id, d)
                      const cellClass = shift ? shift.name.toLowerCase().replace(/\s+/g, '-') : 'empty'
                      const content = view === 'week'
                        ? (shift?.name ?? '—')
                        : (shift ? (SHORT_CODES[shift.name] || shift.name[0]) : '')
                      const isActive = activeCell?.staffId === person.id && activeCell?.dateStr === dateStr
                      const teamTypes = [...shiftTypes.filter(t => t.team_id === team.id), ...shiftTypes.filter(t => t.team_id === null)]
                      const currentTypeId = shift ? (shiftTypes.find(t => t.name === shift.name)?.id ?? '') : ''
                      return (
                        <td
                          key={dateStr}
                          className={[
                            'shift-cell',
                            cellClass,
                            shift?.isManual ? 'manual' : '',
                            isToday(d) ? 'today-col' : '',
                            d.getDate() === 1 && view !== 'week' ? 'month-start' : '',
                            d.getDay() === 1 && view !== 'week' && view !== '4weeks' ? 'week-start' : '',
                            isActive ? 'cell-active' : '',
                          ].filter(Boolean).join(' ')}
                          onClick={() => setActiveCell(isActive ? null : { staffId: person.id, teamId: team.id, dateStr })}
                          title={`${person.name} — ${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}: ${shift?.name ?? 'Rest'}`}
                        >
                          {isActive ? (
                            <select
                              className="shift-select"
                              autoFocus
                              defaultValue={currentTypeId}
                              onBlur={() => setActiveCell(null)}
                              onChange={e => selectShift(person.id, team.id, dateStr, e.target.value || null)}
                              onClick={e => e.stopPropagation()}
                            >
                              <option value="">— Rest —</option>
                              {teamTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                          ) : content}
                        </td>
                      )
                    })}
                  </tr>
                )),
                (() => {
                  const teamTotals = {}
                  teamStaff.forEach(s => {
                    const abs = absencesByStaff[s.id]
                    if (!abs) return
                    Object.entries(abs).forEach(([type, count]) => {
                      teamTotals[type] = (teamTotals[type] || 0) + count
                    })
                  })
                  const total = Object.values(teamTotals).reduce((a, b) => a + b, 0)
                  if (!total) return null
                  const summary = Object.entries(teamTotals)
                    .map(([type, count]) => `${count} ${type.toLowerCase()}`)
                    .join(', ')
                  return (
                    <tr key={`totals-${team.id}`} className="team-totals-row">
                      <td className="staff-name team-totals-label">{summary}</td>
                      {dateRange.map(d => <td key={formatDate(d)} className="team-totals-cell" />)}
                    </tr>
                  )
                })(),
                mpKey && (
                  <tr key={`mp-${team.id}`} className="manpower-row">
                    <td className="staff-name manpower-label">{mpLabel}</td>
                    {dateRange.map(d => {
                      const dateStr = formatDate(d)
                      const mp = manpowerByDate[dateStr]
                      if (!mp) return <td key={dateStr} />
                      const headcountOk = mp[`${mpKey}Ok`]
                      const ok = mpKey === 'dm'
                        ? headcountOk
                        : headcountOk && mp.earlyOk && mp.lateOk
                      const eff = mpKey === 'dm' ? mp.dmCount : mp[`${mpKey}Effective`]
                      const issues = []
                      if (!headcountOk) issues.push(`${eff}/${mpNeed} on shift`)
                      if (mpKey !== 'dm' && !mp.earlyOk) issues.push(`Earlies: ${mp.earlyCount}/2`)
                      if (mpKey !== 'dm' && !mp.lateOk)  issues.push(`Lates: ${mp.lateCount}/2`)
                      return (
                        <td
                          key={dateStr}
                          className={[
                            'manpower-cell',
                            ok ? 'manpower-ok' : 'manpower-fail',
                            isToday(d) ? 'today-col' : '',
                            d.getDate() === 1 && view !== 'week' ? 'month-start' : '',
                            d.getDay() === 1 && view !== 'week' && view !== '4weeks' ? 'week-start' : '',
                          ].filter(Boolean).join(' ')}
                          title={ok ? `${eff}/${mpNeed}` : issues.join(', ')}
                        >
                          {ok ? '' : '!'}
                        </td>
                      )
                    })}
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
