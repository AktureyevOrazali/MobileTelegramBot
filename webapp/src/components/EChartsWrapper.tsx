import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

export interface EChartsWrapperProps {
    option: echarts.EChartsOption;
    style?: React.CSSProperties;
    className?: string;
    theme?: string | object;
    notMerge?: boolean;
    lazyUpdate?: boolean;
    onEvents?: Record<string, Function>;
}

const shallowStyleEqual = (left?: React.CSSProperties, right?: React.CSSProperties) => {
    if (left === right) return true;
    if (!left || !right) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => left[key as keyof React.CSSProperties] === right[key as keyof React.CSSProperties]);
};

const EChartsWrapperBase: React.FC<EChartsWrapperProps> = ({
    option,
    style,
    className,
    theme,
    notMerge = false,
    lazyUpdate = false,
    onEvents,
}) => {
    const chartRef = useRef<HTMLDivElement>(null);
    const chartInstance = useRef<echarts.ECharts | null>(null);
    const optionFrameRef = useRef<number | null>(null);
    const resizeFrameRef = useRef<number | null>(null);

    useEffect(() => {
        if (!chartRef.current) return;

        let currentInstance = echarts.getInstanceByDom(chartRef.current);
        if (!currentInstance) {
            currentInstance = echarts.init(chartRef.current, theme);
        }
        chartInstance.current = currentInstance;

        return () => {
            if (optionFrameRef.current !== null) {
                window.cancelAnimationFrame(optionFrameRef.current);
                optionFrameRef.current = null;
            }
            if (resizeFrameRef.current !== null) {
                window.cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
            }
            if (chartInstance.current) {
                chartInstance.current.dispose();
                chartInstance.current = null;
            }
        };
    }, [theme]);

    useEffect(() => {
        if (!chartInstance.current || !onEvents) return;

        Object.entries(onEvents).forEach(([eventName, handler]) => {
            chartInstance.current?.on(eventName, handler as any);
        });

        return () => {
            Object.entries(onEvents).forEach(([eventName, handler]) => {
                chartInstance.current?.off(eventName, handler as any);
            });
        };
    }, [onEvents]);

    // Update chart when option changes
    useEffect(() => {
        if (chartInstance.current && option) {
            if (optionFrameRef.current !== null) {
                window.cancelAnimationFrame(optionFrameRef.current);
            }
            optionFrameRef.current = window.requestAnimationFrame(() => {
                optionFrameRef.current = null;
                chartInstance.current?.setOption(option, notMerge, lazyUpdate);
            });
        }
        return () => {
            if (optionFrameRef.current !== null) {
                window.cancelAnimationFrame(optionFrameRef.current);
                optionFrameRef.current = null;
            }
        };
    }, [option, notMerge, lazyUpdate]);

    // Handle Resize correctly
    useEffect(() => {
        const scheduleResize = () => {
            if (resizeFrameRef.current !== null) {
                return;
            }
            resizeFrameRef.current = window.requestAnimationFrame(() => {
                resizeFrameRef.current = null;
                chartInstance.current?.resize();
            });
        };

        let resizeObserver: ResizeObserver | null = null;
        if (chartRef.current && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                scheduleResize();
            });
            resizeObserver.observe(chartRef.current);
        } else {
            window.addEventListener('resize', scheduleResize);
        }

        return () => {
            window.removeEventListener('resize', scheduleResize);
            if (resizeFrameRef.current !== null) {
                window.cancelAnimationFrame(resizeFrameRef.current);
                resizeFrameRef.current = null;
            }
            if (resizeObserver && chartRef.current) {
                resizeObserver.unobserve(chartRef.current);
                resizeObserver.disconnect();
            }
        };
    }, []);

    return <div ref={chartRef} style={{ width: '100%', height: '100%', ...style }} className={className} />;
};

const EChartsWrapper = React.memo(EChartsWrapperBase, (prevProps, nextProps) => (
    prevProps.option === nextProps.option
    && prevProps.className === nextProps.className
    && prevProps.theme === nextProps.theme
    && prevProps.notMerge === nextProps.notMerge
    && prevProps.lazyUpdate === nextProps.lazyUpdate
    && prevProps.onEvents === nextProps.onEvents
    && shallowStyleEqual(prevProps.style, nextProps.style)
));

export default EChartsWrapper;
