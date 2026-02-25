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

const EChartsWrapper: React.FC<EChartsWrapperProps> = ({
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

    useEffect(() => {
        if (!chartRef.current) return;

        let currentInstance = echarts.getInstanceByDom(chartRef.current);
        if (!currentInstance) {
            currentInstance = echarts.init(chartRef.current, theme);
        }
        chartInstance.current = currentInstance;

        if (onEvents) {
            Object.entries(onEvents).forEach(([eventName, handler]) => {
                chartInstance.current?.on(eventName, handler as any);
            });
        }

        return () => {
            if (chartInstance.current) {
                if (onEvents) {
                    Object.entries(onEvents).forEach(([eventName, handler]) => {
                        chartInstance.current?.off(eventName, handler as any);
                    });
                }
                chartInstance.current.dispose();
                chartInstance.current = null;
            }
        };
    }, [theme]);

    // Update chart when option changes
    useEffect(() => {
        if (chartInstance.current && option) {
            chartInstance.current.setOption(option, notMerge, lazyUpdate);
        }
    }, [option, notMerge, lazyUpdate]);

    // Handle Resize correctly
    useEffect(() => {
        const handleResize = () => {
            if (chartInstance.current) {
                chartInstance.current.resize();
            }
        };

        window.addEventListener('resize', handleResize);

        let resizeObserver: ResizeObserver | null = null;
        if (chartRef.current && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                handleResize();
            });
            resizeObserver.observe(chartRef.current);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            if (resizeObserver && chartRef.current) {
                resizeObserver.unobserve(chartRef.current);
                resizeObserver.disconnect();
            }
        };
    }, []);

    return <div ref={chartRef} style={{ width: '100%', height: '100%', ...style }} className={className} />;
};

export default EChartsWrapper;
