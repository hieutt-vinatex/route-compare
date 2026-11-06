import type { RouteObject } from 'react-router';
import { ComparePage } from '@/pages/ComparePage';
import { HistoryPage } from '@/pages/HistoryPage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RouteErrorPage } from '@/pages/RouteErrorPage';
import { TrackingPage } from '@/pages/TrackingPage';
import { TripDetailPage } from '@/pages/TripDetailPage';
import { AppLayout } from './AppLayout';

/** The 5 routes of docs/03 §2 (+ 404). */
export function createRoutes(): RouteObject[] {
  return [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: <RouteErrorPage />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'tracking', element: <TrackingPage /> },
        { path: 'history', element: <HistoryPage /> },
        { path: 'trips/:id', element: <TripDetailPage /> },
        { path: 'compare', element: <ComparePage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ];
}
