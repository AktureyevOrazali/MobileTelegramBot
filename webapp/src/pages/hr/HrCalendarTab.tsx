import React from 'react';
import { hrCalendarEvents } from './hrMockData';

const days = [
  { date: '2026-05-18', label: 'Пн 18' },
  { date: '2026-05-19', label: 'Вт 19' },
  { date: '2026-05-20', label: 'Ср 20' },
  { date: '2026-05-21', label: 'Чт 21' },
  { date: '2026-05-22', label: 'Пт 22' },
  { date: '2026-05-23', label: 'Сб 23' },
  { date: '2026-05-24', label: 'Вс 24' },
];

const HrCalendarTab: React.FC = () => (
  <div className="hr-calendar">
    {days.map((day) => {
      const events = hrCalendarEvents.filter((event) => event.date === day.date);

      return (
        <section className="hr-calendar-day" key={day.date} aria-labelledby={`hr-day-${day.date}`}>
          <h3 id={`hr-day-${day.date}`}>{day.label}</h3>
          {events.map((event) => (
            <article className={`hr-calendar-event hr-calendar-event--${event.type}`} key={event.id}>
              <strong>{event.employeeName}</strong>
              <span>{event.label}</span>
              <time dateTime={`${event.date}T${event.startTime}`}>
                {event.startTime} - {event.endTime}
              </time>
            </article>
          ))}
        </section>
      );
    })}
  </div>
);

export default HrCalendarTab;
