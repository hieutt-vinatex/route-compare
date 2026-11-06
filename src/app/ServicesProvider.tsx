import type { ReactNode } from 'react';
import type { AppServices } from './services';
import { ServicesContext } from './servicesContext';

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}
