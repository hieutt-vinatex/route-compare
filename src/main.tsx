import './styles/index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { systemClock } from './adapters/system';
import { createRoutes } from './app/routes';
import { createAppServices } from './app/services';
import { ServicesProvider } from './app/ServicesProvider';

// `?gps=demo` replays a synthetic route — development builds only (dead code in production).
const demoGeolocation =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('gps') === 'demo'
    ? (await import('./adapters/geolocation/demo')).createDemoGeolocation(systemClock)
    : undefined;

// Services live outside React so StrictMode double-mounting cannot create duplicate GPS watchers.
const services = createAppServices(demoGeolocation === undefined ? {} : { demoGeolocation });
const router = createBrowserRouter(createRoutes());

const container = document.getElementById('root');
if (container === null) throw new Error('#root element missing');

createRoot(container).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <RouterProvider router={router} />
    </ServicesProvider>
  </StrictMode>,
);
