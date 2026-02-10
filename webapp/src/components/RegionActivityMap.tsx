import React, { useCallback, useMemo, useRef, useState } from 'react';
import { geoCentroid, geoMercator, geoPath, scaleLinear } from 'd3';
import type { FeatureCollection, Geometry } from 'geojson';
import kzMap from '../../kz.json';

/** GeoJSON features for Kazakhstan regions. */
export const GEOJSON_FEATURES = kzMap as FeatureCollection<Geometry, { name: string }>;

export const REGION_LABELS: Record<string, string> = {
    Abai: 'Абайская область',
    Akmola: 'Акмолинская область',
    Aktobe: 'Актюбинская область',
    Almaty: 'Алматинская область',
    'Almaty (city)': 'г. Алматы',
    Astana: 'г. Астана',
    Atyrau: 'Атырауская область',
    'East Kazakhstan': 'Восточно-Казахстанская область',
    Jambyl: 'Жамбылская область',
    Jetisu: 'Жетысуская область',
    Karaganda: 'Карагандинская область',
    Kostanay: 'Костанайская область',
    Kyzylorda: 'Кызылординская область',
    Mangystau: 'Мангистауская область',
    'North Kazakhstan': 'Северо-Казахстанская область',
    Pavlodar: 'Павлодарская область',
    'Shymkent (city)': 'г. Шымкент',
    Turkestan: 'Туркестанская область',
    Ulytau: 'Улытауская область',
    'West Kazakhstan': 'Западно-Казахстанская область',
};

const REGION_MATCHERS: { key: string; patterns: string[] }[] = [
    { key: 'Almaty (city)', patterns: ['алматы', 'г.алматы', 'город алматы', 'алматы қ', 'almaty city'] },
    { key: 'Astana', patterns: ['г. астана', 'астана'] },
    { key: 'Shymkent (city)', patterns: ['г. шымкент', 'шымкент', 'shymkent'] },
    { key: 'Almaty', patterns: ['алматин', 'almaty oblast'] },
    { key: 'Akmola', patterns: ['акмол', 'akmola'] },
    { key: 'Aktobe', patterns: ['актоб', 'aktobe', 'актюб'] },
    { key: 'Atyrau', patterns: ['атырау', 'atyrau'] },
    { key: 'East Kazakhstan', patterns: ['восточно-казахстан', 'east kazakhstan'] },
    { key: 'West Kazakhstan', patterns: ['западно-казахстан', 'west kazakhstan'] },
    { key: 'North Kazakhstan', patterns: ['северо-казахстан', 'north kazakhstan'] },
    { key: 'Jambyl', patterns: ['жамбыл', 'jambyl', 'zhambyl'] },
    { key: 'Jetisu', patterns: ['жетысу', 'jetisu', 'zhetisu', 'жетісу'] },
    { key: 'Karaganda', patterns: ['караган', 'karaganda'] },
    { key: 'Kostanay', patterns: ['костанай', 'kostanay'] },
    { key: 'Kyzylorda', patterns: ['кызылорд', 'kyzylorda'] },
    { key: 'Mangystau', patterns: ['мангист', 'mangystau'] },
    { key: 'Pavlodar', patterns: ['павлодар', 'pavlodar'] },
    { key: 'Turkestan', patterns: ['туркестан', 'turkestan'] },
    { key: 'Ulytau', patterns: ['улытау', 'ulytau'] },
    { key: 'Abai', patterns: ['абай', 'abai'] },
];

export const CITY_REGION_KEYS = new Set(['Almaty (city)', 'Astana', 'Shymkent (city)']);

/**
 * Detects a Kazakhstan region key from a free-text address string.
 * Returns the GeoJSON feature key or null if no match found.
 */
export const detectRegionFromAddress = (address: string | null | undefined): string | null => {
    if (!address) return null;
    const normalized = address.toLowerCase().replace(/ё/g, 'е');
    const match = REGION_MATCHERS.find((entry) =>
        entry.patterns.some((pattern) => normalized.includes(pattern)),
    );
    return match?.key ?? null;
};

const RegionActivityMap: React.FC<{
    features: FeatureCollection<Geometry, { name: string }>;
    counts: Record<string, number>;
}> = React.memo(({ features, counts }) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [hovered, setHovered] = useState<{ key: string; x: number; y: number } | null>(null);

    const width = 760;
    const height = 420;
    const projection = useMemo(() => geoMercator().fitSize([width, height], features), [features]);
    const pathGenerator = useMemo(() => geoPath(projection), [projection]);
    const maxValue = useMemo(() => Math.max(1, ...Object.values(counts)), [counts]);
    const colorScale = useMemo(
        () => scaleLinear<string>().domain([0, maxValue]).range(['#a5b4d8', '#4a5d8a']),
        [maxValue],
    );

    // Pre-compute all paths and centroids once
    const regionData = useMemo(() =>
        features.features.map((feature) => {
            const key = feature.properties?.name ?? '';
            const d = pathGenerator(feature) ?? '';
            const centroid = geoCentroid(feature);
            const [cx, cy] = projection(centroid) ?? [0, 0];
            return { key, d, cx, cy };
        }),
        [features, pathGenerator, projection]
    );

    const handleMove = useCallback((event: React.MouseEvent<SVGPathElement>, key: string) => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        setHovered({ key, x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, []);

    const handleLeave = useCallback(() => setHovered(null), []);

    return (
        <div className="kz-map" ref={wrapperRef}>
            <svg className="kz-map__svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Карта Казахстана по регионам">
                {regionData.map(({ key, d }) => {
                    const value = counts[key] ?? 0;
                    const isActive = hovered?.key === key;
                    return (
                        <path
                            key={key}
                            d={d}
                            fill={colorScale(value)}
                            className={`kz-map__region ${isActive ? 'is-active' : ''}`}
                            onMouseEnter={(event) => handleMove(event, key)}
                            onMouseMove={(event) => handleMove(event, key)}
                            onMouseLeave={handleLeave}
                        />
                    );
                })}
                {/* Region count labels */}
                {regionData.map(({ key, cx, cy }) => {
                    const value = counts[key] ?? 0;
                    if (value === 0) return null;
                    return (
                        <text
                            key={`label-${key}`}
                            x={cx}
                            y={cy}
                            className="kz-map__label"
                            textAnchor="middle"
                            dominantBaseline="central"
                            pointerEvents="none"
                        >
                            {value}
                        </text>
                    );
                })}
            </svg>
            {hovered && (
                <div
                    className="kz-map__tooltip"
                    style={{ left: hovered.x + 12, top: hovered.y + 12 }}
                >
                    <div className="kz-map__tooltip-title">{REGION_LABELS[hovered.key] ?? hovered.key}</div>
                    <div className="kz-map__tooltip-value">{counts[hovered.key] ?? 0} БИН</div>
                </div>
            )}
        </div>
    );
});

export default RegionActivityMap;
