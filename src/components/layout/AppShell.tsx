import { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ErrorBoundary } from '../feedback/ErrorBoundary';
import { LoadingScreen } from '../feedback/LoadingScreen';
import { BottomNav } from './BottomNav';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

/**
 * The frame around every page: header on top, side menu on desktop,
 * bottom tabs on phones, and the current page in the middle.
 */
export function AppShell() {
  const { pathname } = useLocation();

  // Start each new page at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      <div className="flex">
        <Sidebar />
        <main id="main" className="min-w-0 flex-1 px-4 pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
          <div className="mx-auto w-full max-w-5xl">
            {/* key={pathname} resets the error boundary when you move to another page */}
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<LoadingScreen label="Loading page…" />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
