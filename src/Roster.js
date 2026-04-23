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

export default function Roster() {
  const [staff, setStaff] = useState([])
  const [shiftTypes, setShiftTypes] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)

  const weekDates = getWeekDates()

  useEffect(() => {
    async function loadData() {
      const [staffRes, shiftTypesRes, shiftsRes] = await Promise.all([
        supabase.from('staff').select('*'),
        supabase.from('shift_types').select('*'),
        supabase.from('shifts').select('*').in(
          'date', weekDates.map(formatDate)
        )
      ])

      setStaff(staffRes.data || [])
      setShiftTypes(shiftTypesRes.data || [])
      setShifts(shiftsRes.data || [])
      setLoading(false)
    }

    loadData()
  }, [])

  function getShift(staffId, date) {
    const shift = shifts.find(
      s => s.staff_id === staffId && s.date === formatDate(date)
    )
    if (!shift) return null
    return shiftTypes.find(t => t.id === shift.shift_type_id)
  }

  async function cycleShift(staffId, date) {
    const current = getShift(staffId, date)
    const dateStr = formatDate(date)

    const currentIndex = current
      ? shiftTypes.findIndex(t => t.id === current.id)
      : -1

    const nextType = currentIndex < shiftTypes.length - 1
      ? shiftTypes[currentIndex + 1]
      : null

    const existing = shifts.find(s => s.staff_id === staffId && s.date === dateStr)

    if (nextType) {
      if (existing) {
        await supabase.from('shifts').update({ shift_type_id: nextType.id }).eq('id', existing.id)
        setShifts(prev => prev.map(s => s.id === existing.id ? { ...s, shift_type_id: nextType.id } : s))
      } else {
        const { data } = await supabase.from('shifts').insert({
          staff_id: staffId,
          shift_type_id: nextType.id,
          date: dateStr
        }).select().single()
        setShifts(prev => [...prev, data])
      }
    } else {
      if (existing) {
        await supabase.from('shifts').delete().eq('id', existing.id)
        setShifts(prev => prev.filter(s => s.id !== existing.id))
      }
    }
  }

  if (loading) return <p className="loading">Loading roster...</p>

  return (
    <div className="roster-wrapper">
      <h2>DHC Crew — This Week</h2>
      <div className="roster-scroll">
        <table className="roster-table">
          <thead>
            <tr>
              <th>Name</th>
              {weekDates.map(d => (
                <th key={formatDate(d)}>{formatDisplay(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map(person => (
              <tr key={person.id}>
                <td className="staff-name">{person.name}</td>
                {weekDates.map(d => {
                  const shift = getShift(person.id, d)
                  return (
                    <td
                      key={formatDate(d)}
                      className={`shift-cell ${shift ? shift.name.toLowerCase() : 'empty'}`}
                      onClick={() => cycleShift(person.id, d)}
                      title="Click to cycle shift"
                    >
                      {shift ? shift.name : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
