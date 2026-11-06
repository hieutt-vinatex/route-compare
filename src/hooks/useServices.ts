import { use } from 'react';
import type { AppServices } from '@/app/services';
import { ServicesContext } from '@/app/servicesContext';

export function useServices(): AppServices {
  const services = use(ServicesContext);
  if (services === null) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}
