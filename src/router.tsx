import { lazy } from 'react';
import { createBrowserRouter } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { RouteError } from './components/feedback/RouteError';

// Each page is a separate file that downloads only when first visited.
const HomePage = lazy(() => import('./pages/HomePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const MapPage = lazy(() => import('./pages/MapPage'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
const SavedTripsPage = lazy(() => import('./pages/SavedTripsPage'));
const CommunityPage = lazy(() => import('./pages/CommunityPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'map', element: <MapPage /> },
      { path: 'explore', element: <ExplorePage /> },
      { path: 'saved', element: <SavedTripsPage /> },
      { path: 'community', element: <CommunityPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'design', element: <DesignSystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
