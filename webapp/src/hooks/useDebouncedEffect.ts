import { useEffect, useRef } from 'react';

/**
 * Runs an effect after a debounce delay whenever dependencies change.
 * Skips the first invocation (mount) to avoid unnecessary network requests.
 */
export function useDebouncedEffect(
    fn: () => void,
    deps: React.DependencyList,
    delay = 300,
): void {
    const isFirst = useRef(true);

    useEffect(() => {
        if (isFirst.current) {
            isFirst.current = false;
            return () => { };
        }
        const timer = setTimeout(fn, delay);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
}
