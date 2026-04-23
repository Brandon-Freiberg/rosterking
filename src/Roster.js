import { useState, useEffect } from 'react'
import { supabase } from './supabase'

function getWeekDates() {
  const dates = []
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - today.getDay() + 1)
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    dates.push(d)
  }
  return dates
}

function formatDate(date) {
  return date.toISOString().split('T')[0]
}

function formatDisplay(date) {
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function isToday(date) {
  const today = new Date()
  return formatDate(date) === formatDate(today)
}

const TEAM_ORDER = ['MOC Manager', 'Duty Managers', 'ATR Crew', 'DHC Crew', 'MOC Support']
const CODE_TO_NAME = { E: 'Earlies', L: 'Lates', D: 'Days', C: 'Cover' }

function getPatternShift(staffId, patternEntries, date) {
  const entries = patternEntries.filter(e => e.staff_id === staffId)
  if (!entries.length) return null

  const pattern = entries[0].patterns
  if (!pattern) return null

  const startDate = new Date(pattern.start_date)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksElapsed = Math.floor((date - startDate) / msPerWeek)
  const weekNumber = (weeksElapsed % pattern.cycle_weeks) + 1
  const dayOfWeek = (date.getDay() + 6) % 7

  const entry = entries.find(e => e.week_number === weekNumber && e.day_of_week === dayOfWeek)
  return entry ? { name: CODE_TO_NAME[entry.shift_code] || entry.shift_code, isPattern: true } : null
}

export default function Roster() {
  const [teams, setTeams] = useState([])
  const [staff, setStaff] = useState([])
  const [shiftTypes, setShiftTypes] = useState([])
  const [patternEntries, setPatternEntries] = useState([])
  const [manualShifts, setManualShifts] = useState([])
  const [loading, setLoading] = useState(true)

  const weekDates = getWeekDates()

  useEffect(() => {
    async function loadData() {
      const [teamsRes, staffRes, shiftTypesRes, patternRes, shiftsRes] = await Promise.all([
        supabase.from('teams').select('*'),
        supabase.from('staff').select('*'),
        supabase.from('shift_types').select('*'),
        supabase.from('pattern_entries').select('*, patterns(cycle_weeks, start_date)'),
        supabase.from('shifts').select('*').in('date', weekDates.map(formatDate)),
      ])
      setTeams(teamsRes.data || [])
      setStaff(staffRes.data || [])
      setShiftTypes(shiftTypesRes.data || [])
      setPatternEntries(patternRes.data || [])
      setManualShifts(shiftsRes.data || [])
      setLoading(false)
    }
    loadData()
  }, [])

  function getShift(staffId, date) {
    const manual = manualShifts.find(s => s.staff_id === staffId && s.date === formatDate(date))
    if (manual) {
      const shiftType = shiftTypes.find(t => t.id === manual.shift_type_id)
      return shiftType ? { name: shiftType.name, manualId: manual.id, shiftTypeId: manual.shift_type_id, isManual: true } : null
    }
    return getPatternShift(staffId, patternEntries, date)
  }

  async function cycleShift(staffId, teamId, date) {
    const current = getShift(staffId, date)
    const dateStr = formatDate(date)
    const globalTypes = shiftTypes.filter(t => t.team_id === null)
    const teamTypes = [...shiftTypes.filter(t => t.team_id === teamId), ...globalTypes]

    const currentIndex = teamTypes.findIndex(t => t.name === current?.name)
    const isLast = currentIndex === teamTypes.length - 1
    const nextType = !isLast ? teamTypes[currentIndex + 1] : null

    const existing = manualShifts.find(s => s.staff_id === staffId && s.date === dateStr)

    if (nextType) {
      if (existing) {
        await supabase.from('shifts').update({ shift_type_id: nextType.id }).eq('id', existing.id)
        setManualShifts(prev => prev.map(s => s.id === existing.id ? { ...s, shift_type_id: nextType.id } : s))
      } else {
        const { data } = await supabase.from('shifts').insert({
          staff_id: staffId, shift_type_id: nextType.id, date: dateStr,
        }).select().single()
        setManualShifts(prev => [...prev, data])
      }
    } else {
      // End of cycle — clear manual override
      // Rostered days show pattern shift, rest days go blank
      if (existing) {
        await supabase.from('shifts').delete().eq('id', existing.id)
        setManualShifts(prev => prev.filter(s => s.id !== existing.id))
      }
    }
  }

  if (loading) return <p className="loading">Loading roster...</p>

  const sortedTeams = [...teams].sort((a, b) => TEAM_ORDER.indexOf(a.name) - TEAM_ORDER.indexOf(b.name))

  return (
    <div className="roster-wrapper">
      <div className="roster-scroll">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Name</th>
              {weekDates.map(d => (
                <th key={formatDate(d)} className={isToday(d) ? 'today-col' : ''}>
                  {formatDisplay(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTeams.map(team => {
              const teamStaff = staff
                .filter(s => s.team_id === team.id)
                .sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))
              return [
                <tr key={`team-${team.id}`} className="team-header-row">
                  <td colSpan={weekDates.length + 1}>{team.name}</td>
                </tr>,
                ...teamStaff.map(person => (
                  <tr key={person.id}>
                    <td className="staff-name">{person.name}</td>
                    {weekDates.map(d => {
                      const shift = getShift(person.id, d)
                      const cellClass = shift ? shift.name.toLowerCase().replace(/\s+/g, '-') : 'empty'
                      return (
                        <td
                          key={formatDate(d)}
                          className={`shift-cell ${cellClass}${shift?.isManual ? ' manual' : ''}${isToday(d) ? ' today-col' : ''}`}
                          onClick={() => cycleShift(person.id, team.id, d)}
                          title={shift?.isManual ? 'Manual override — click to cycle' : 'Pattern shift — click to override'}
                        >
                          {shift ? shift.name : '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
