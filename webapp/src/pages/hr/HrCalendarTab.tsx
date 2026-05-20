import React, { useMemo, useState } from 'react';
import type { HrEmployee, HrRequest } from '../../types';
import { requestTypeLabels } from './hrMockData';

interface HrCalendarTabProps {
  requests: HrRequest[];
  employees: HrEmployee[];
}

const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const toDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const startOfCalendar = (monthDate: Date) => {
  const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  return date;
};

const parseRequestStart = (request: HrRequest) => {
  const rawStart = request.values?.start_date;
  if (typeof rawStart === 'string') {
    const parts = rawStart.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (parts) return new Date(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]));
  }
  return request.submittedAt;
};

const HrCalendarTab: React.FC<HrCalendarTabProps> = ({ requests, employees }) => {
  const [cursor, setCursor] = useState(() => new Date());

  const days = useMemo(() => {
    const start = startOfCalendar(cursor);
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return day;
    });
  }, [cursor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, HrRequest[]>();
    requests.forEach((request) => {
      const key = toDateKey(parseRequestStart(request));
      map.set(key, [...(map.get(key) ?? []), request]);
    });
    return map;
  }, [requests]);

  const title = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(cursor);

  const moveMonth = (offset: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div className="hr-calendar-shell">
      <div className="hr-calendar-toolbar">
        <button className="button secondary" type="button" onClick={() => moveMonth(-1)}>Назад</button>
        <h3>{title}</h3>
        <button className="button secondary" type="button" onClick={() => moveMonth(1)}>Вперед</button>
      </div>
      <div className="hr-calendar-month" aria-label="Календарь кадров">
        {weekDays.map((day) => (
          <div className="hr-calendar-weekday" key={day}>{day}</div>
        ))}
        {days.map((day) => {
          const key = toDateKey(day);
          const isMuted = day.getMonth() !== cursor.getMonth();
          const isToday = key === toDateKey(new Date());
          const events = eventsByDay.get(key) ?? [];

          return (
            <section
              className={`hr-calendar-day ${isMuted ? 'hr-calendar-day--muted' : ''} ${isToday ? 'hr-calendar-day--today' : ''}`}
              key={key}
              aria-labelledby={`hr-day-${key}`}
            >
              <h3 id={`hr-day-${key}`}>{day.getDate()}</h3>
              {events.map((request) => (
                <article className={`hr-calendar-event hr-calendar-event--${request.type}`} key={request.id}>
                  <strong>{request.employeeName}</strong>
                  <span>{requestTypeLabels[request.type]}</span>
                </article>
              ))}
              {!events.length && day.getDay() !== 0 && day.getDay() !== 6 && employees.length > 0 && (
                <span className="hr-calendar-empty">09:00-18:00</span>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default HrCalendarTab;
