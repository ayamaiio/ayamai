import { useEffect } from 'react';

/** Sets a unique document title per route: "<page> · ayamai". */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · yoru` : 'ayamai';
  }, [title]);
}
