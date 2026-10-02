import { createFileRoute } from '@tanstack/react-router';
import { CalendarPage, parseCalendarSearch } from '../../../features/calendar/calendar-page';

export const Route = createFileRoute('/_app/calendar/')({
  validateSearch: parseCalendarSearch,
  component: CalendarRoute,
});

function CalendarRoute() {
  return <CalendarPage search={Route.useSearch()} />;
}
