import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection, Geometry } from 'geojson';
import { scaleLinear } from 'd3';
import kzMap from '../../kz.json';
import { OBLASTS, OBLAST_RAYONS, MAIN_VIEWBOX } from '../data/kzMapData';
import type { RegionStats } from '../hooks/useDialogsData';

/** GeoJSON features for Kazakhstan regions — kept for useDialogsData compatibility. */
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

/**
 * Extra search patterns for rayons that can't be detected by simple name matching.
 * Key: oblastId, value: array of [rayonName, additionalPatterns[]].
 * Rayon name must exactly match the name field in OBLAST_RAYONS data.
 */
const RAYON_EXTRA_PATTERNS: Record<string, [string, string[]][]> = {
    turkistanOblast: [
        ['Сауран', ['г. туркестан', 'г.туркестан', 'город туркестан', 'кентау', 'саура']],
        ['Cайрам', ['сайрам']],
        ['Шымкент', ['шымкент']],
        ['Арыс', ['арыс']],
        ['Сарыагаш', ['сарыагаш']],
        ['Мактаарал', ['мактаарал']],
        ['Казыгурт', ['казыгурт']],
        ['Толеби', ['толеби']],
        ['Тулкибас', ['тулкибас']],
        ['Ордабасы', ['ордабасы']],
        ['Байдибек', ['байдибек']],
        ['Шардаринский', ['шардар']],
        ['Отырарский', ['отырар']],
        ['Сузакский район', ['сузак']],
        ['Жетисай', ['жетисай']],
        ['Келес', ['келес']],
        ['Тұран', ['туран', 'тұран']],
        ['Аль-Фараби', ['аль-фараби', 'фараби']],
        ['Каратау', ['каратау']],
        ['Абай', ['абай']],
        ['Енбекшин', ['енбекшин']],
    ],
    jambylOblast: [
        ['Турара Рыскулова', ['рыскулов', 'турара']],
        ['Жуалынский', ['жуалын']],
        ['Жамбылский', ['жамбыл']],
        ['Кордайский', ['кордай']],
        ['Шуский', ['шуск', 'шуйск']],
        ['Талас', ['талас']],
        ['Сарысуский', ['сарысу']],
        ['Байзакский', ['байзак']],
        ['Мойынкумский', ['мойынкум']],
        ['Меркенский', ['меркен']],
    ],
    aktobeOblast: [
        ['Актобе', ['актобе', 'актюбинск']],
        ['Хромтау', ['хромтау']],
        ['Айтекеби', ['айтекеби']],
        ['Мугалжарский', ['мугалжар']],
        ['Шалкарский', ['шалкар']],
    ],
    karagandyOblast: [
        ['Нұра', ['нура', 'нұра']],
        ['Бухар-Жырауский', ['бухар-жырау', 'бухар жырау']],
        ['Шетский район', ['шетск']],
        ['Нуринский район', ['нурин']],
        ['Актогайский район', ['актогай']],
    ],
    pavlodarOblast: [
        ['Павлодар', ['павлодар']],
        ['Экибастуз', ['экибастуз']],
        ['Аксу', ['г. аксу', 'г.аксу']],
        ['Тереңкөл', ['тереңкол', 'теренкол']],
        ['Аққулы', ['аккулы', 'аққулы']],
    ],
    VKO: [
        ['Семей Г.А', ['семей', 'семипалатинск']],
        ['Глубоковский', ['глубоков']],
        ['Уланский', ['уланск']],
    ],
    abayOblast: [
        ['Аягозский', ['аягоз']],
        ['Урджарский', ['урджар']],
        ['Зайсанский', ['зайсан']],
        ['Курчумский', ['курчум']],
    ],
    almatyOblast: [
        ['Конаев', ['конаев', 'капчагай']],
        ['Талгарский', ['талгар']],
        ['Карасай', ['карасай']],
        ['Илийский', ['илийск']],
        ['Енбекшиказахский', ['енбекшиказах']],
        ['Райымбекский', ['райымбек']],
    ],
    jetisuOblast: [
        ['Панфиловский', ['панфилов', 'жаркент']],
        ['Саркандский', ['сарканд']],
        ['Алакольский', ['алаколь']],
        ['Кербулак', ['кербулак']],
    ],
    kostanaiOblast: [
        ['Костанай', ['костанай', 'кустанай']],
        ['Аркалык', ['аркалык']],
        ['Житикара', ['житикара']],
        ['район Б.Майлина', ['майлин']],
    ],
    SKO: [
        ['Район Мусрепова', ['мусрепов']],
        ['Район Шал Акына', ['шал акын']],
        ['Район Магжана Жумабаева', ['магжан', 'жумабаев']],
    ],
    akmolaOblast: [
        ['Биржан сал', ['биржан']],
        ['Еремейнтау', ['еремейнтау']],
        ['Коргалжын', ['коргалжын']],
        ['Шортандинский район', ['шортанд']],
    ],
    kyzylordaOblast: [
        ['Кызылорда', ['кызылорда', 'қызылорда']],
        ['Жанакорган', ['жанакорган']],
        ['Шиели', ['шиели']],
    ],
    almaty: [
        ['МЕДЕУ', ['медеу']],
        ['Бостандық', ['бостандық', 'бостандык']],
        ['Турксибский', ['турксиб']],
        ['Наурызбай', ['наурызбай']],
        ['Ауэзов', ['ауэзов']],
        ['Алатау', ['алатау']],
    ],
};

/** Normalize text for rayon matching: lowercase, ё→е, latin→cyrillic */
function normalizeForMatch(s: string): string {
    return s
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/c/gi, 'с');
}

/**
 * Detects a rayon index within an oblast from a free-text address string.
 * Returns the rayon array index or null if no match found.
 */
export const detectRayonFromAddress = (
    address: string | null | undefined,
    oblastId: string,
): number | null => {
    if (!address) return null;
    const oblastData = OBLAST_RAYONS[oblastId];
    if (!oblastData) return null;
    const normalized = normalizeForMatch(address);

    // Phase 1: Try extra patterns first (most reliable, covers cities and named rayons)
    const extraPatterns = RAYON_EXTRA_PATTERNS[oblastId];
    if (extraPatterns) {
        for (const [rayonName, patterns] of extraPatterns) {
            if (patterns.some((p) => normalized.includes(normalizeForMatch(p)))) {
                // Find the rayon index by name
                const idx = oblastData.rayons.findIndex(
                    (r) => normalizeForMatch(r.name) === normalizeForMatch(rayonName),
                );
                if (idx >= 0) return idx;
            }
        }
    }

    // Phase 2: Generic matching — try direct name include + root extraction
    for (let i = 0; i < oblastData.rayons.length; i++) {
        const rawName = oblastData.rayons[i].name;
        if (!rawName) continue;
        const rayonNorm = normalizeForMatch(rawName);

        // Direct name match (e.g. address contains "бейнеу", rayon is "Бейнеу")
        if (rayonNorm.length >= 3 && normalized.includes(rayonNorm)) {
            return i;
        }

        // Root extraction: remove "район" suffix, then adjective endings
        const withoutRayon = rayonNorm.replace(/\s*район$/i, '').trim();
        const root = withoutRayon
            .replace(/ский$|ская$|ское$|ный$|ная$|ное$|ской$|нской$/, '')
            .trim();
        if (root.length >= 3 && normalized.includes(root)) {
            return i;
        }
    }

    return null;
};

/* ─── Mapping: SVG oblastId → GeoJSON regionKey ─── */
export const SVG_ID_TO_REGION_KEY: Record<string, string> = {
    aktobeOblast: 'Aktobe',
    atyrayOblast: 'Atyrau',
    abayOblast: 'Abai',
    jambylOblast: 'Jambyl',
    ulytauOblast: 'Ulytau',
    kostanaiOblast: 'Kostanay',
    kyzylordaOblast: 'Kyzylorda',
    mangistauOblast: 'Mangystau',
    SKO: 'North Kazakhstan',
    akmolaOblast: 'Akmola',
    pavlodarOblast: 'Pavlodar',
    turkistanOblast: 'Turkestan',
    ZKO: 'West Kazakhstan',
    karagandyOblast: 'Karaganda',
    jetisuOblast: 'Jetisu',
    VKS: 'East Kazakhstan',
    almatyOblast: 'Almaty',
    shymkent: 'Shymkent (city)',
    almaty: 'Almaty (city)',
    astana: 'Astana',
};

/* ─── Color palette (aligned with app brand #3b5998) ─── */
const LIGHT_COLORS = {
    empty: '#9bb3d4',
    min: '#6d92c4',
    max: '#2c4a90',
    rayonEmpty: '#9bb3d4',
    rayonMin: '#6d92c4',
    rayonMax: '#2c4a90',
};

const DARK_COLORS = {
    empty: '#3d4a6b',
    min: '#5264a0',
    max: '#818cf8',
    rayonEmpty: '#3d4a6b',
    rayonMin: '#5264a0',
    rayonMax: '#818cf8',
};

/* ─── Helper: proper polygon centroid from SVG path via Shoelace formula ─── */
function computePolygonCentroid(d: string): [number, number] {
    // Parse absolute coordinates from SVG path d attribute
    const points: [number, number][] = [];
    let cx = 0, cy = 0; // current position

    // Tokenize: split into command + numbers sequence
    const tokens = d.match(/[a-zA-Z][^a-zA-Z]*/g);
    if (!tokens) return [0, 0];

    for (const token of tokens) {
        const cmd = token[0];
        const nums = token.slice(1).match(/[-+]?\d*\.?\d+/g)?.map(Number) ?? [];

        switch (cmd) {
            case 'M':
                for (let i = 0; i < nums.length - 1; i += 2) {
                    cx = nums[i]; cy = nums[i + 1];
                    points.push([cx, cy]);
                }
                break;
            case 'm':
                for (let i = 0; i < nums.length - 1; i += 2) {
                    cx += nums[i]; cy += nums[i + 1];
                    points.push([cx, cy]);
                }
                break;
            case 'L':
                for (let i = 0; i < nums.length - 1; i += 2) {
                    cx = nums[i]; cy = nums[i + 1];
                    points.push([cx, cy]);
                }
                break;
            case 'l':
                for (let i = 0; i < nums.length - 1; i += 2) {
                    cx += nums[i]; cy += nums[i + 1];
                    points.push([cx, cy]);
                }
                break;
            case 'H':
                for (const n of nums) { cx = n; points.push([cx, cy]); }
                break;
            case 'h':
                for (const n of nums) { cx += n; points.push([cx, cy]); }
                break;
            case 'V':
                for (const n of nums) { cy = n; points.push([cx, cy]); }
                break;
            case 'v':
                for (const n of nums) { cy += n; points.push([cx, cy]); }
                break;
            case 'Z': case 'z':
                break;
            default:
                // For curves (C/c/S/s/Q/q/T/t/A/a), just take the endpoint
                if (cmd >= 'A' && cmd <= 'Z') {
                    // Uppercase = absolute, take last pair
                    if (nums.length >= 2) {
                        cx = nums[nums.length - 2];
                        cy = nums[nums.length - 1];
                        points.push([cx, cy]);
                    }
                } else {
                    // lowercase = relative, take last pair
                    if (nums.length >= 2) {
                        cx += nums[nums.length - 2];
                        cy += nums[nums.length - 1];
                        points.push([cx, cy]);
                    }
                }
                break;
        }
    }

    if (points.length < 3) {
        // Fallback: bounding box center
        if (points.length === 0) return [0, 0];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const [px, py] of points) {
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (py < minY) minY = py;
            if (py > maxY) maxY = py;
        }
        return [(minX + maxX) / 2, (minY + maxY) / 2];
    }

    // Shoelace formula for area-weighted centroid
    let area = 0;
    let centX = 0;
    let centY = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % n];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        centX += (x0 + x1) * cross;
        centY += (y0 + y1) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 1e-6) {
        // Degenerate: fallback to average
        let sx = 0, sy = 0;
        for (const [px, py] of points) { sx += px; sy += py; }
        return [sx / n, sy / n];
    }
    centX /= (6 * area);
    centY /= (6 * area);
    return [centX, centY];
}

/* ─── Hook: detect current theme ─── */
function useIsDarkTheme(): boolean {
    const [isDark, setIsDark] = useState(
        () => document.documentElement.getAttribute('data-theme') === 'dark',
    );
    useEffect(() => {
        const el = document.documentElement;
        const observer = new MutationObserver(() => {
            setIsDark(el.getAttribute('data-theme') === 'dark');
        });
        observer.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);
    return isDark;
}

/* ─── Component ─── */

const RegionActivityMap: React.FC<{
    counts: Record<string, number>;
    rayonCounts?: Record<string, Record<number, number>>;
    regionStats?: Record<string, RegionStats>;
    rayonStats?: Record<string, Record<number, RegionStats>>;
}> = React.memo(({ counts, rayonCounts, regionStats, rayonStats }) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [hovered, setHovered] = useState<{ key: string; x: number; y: number } | null>(null);
    const [selectedOblast, setSelectedOblast] = useState<string | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const isDark = useIsDarkTheme();
    const palette = isDark ? DARK_COLORS : LIGHT_COLORS;

    const maxValue = useMemo(() => Math.max(1, ...Object.values(counts)), [counts]);
    const colorScale = useMemo(
        () => scaleLinear<string>().domain([0, maxValue]).range([palette.min, palette.max]),
        [maxValue, palette],
    );

    // Pre-compute centroids for oblasts to place count labels
    const oblastCentroids = useMemo(() => {
        const result: Record<string, [number, number]> = {};
        for (const oblast of OBLASTS) {
            result[oblast.id] = computePolygonCentroid(oblast.d);
        }
        return result;
    }, []);

    const handleMouseMove = useCallback((event: React.MouseEvent<SVGElement>, key: string) => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        setHovered({ key, x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, []);

    const handleMouseLeave = useCallback(() => setHovered(null), []);

    const handleOblastClick = useCallback((oblastId: string) => {
        if (OBLAST_RAYONS[oblastId]) {
            setSelectedOblast(oblastId);
            setHovered(null);
        }
    }, []);

    const handleBack = useCallback(() => {
        setSelectedOblast(null);
        setHovered(null);
    }, []);

    const toggleFullscreen = useCallback(() => {
        setIsFullscreen((prev) => !prev);
    }, []);

    // Close fullscreen on Escape
    useEffect(() => {
        if (!isFullscreen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsFullscreen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isFullscreen]);

    // Lock body scroll when fullscreen
    useEffect(() => {
        if (isFullscreen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isFullscreen]);

    const selectedOblastData = selectedOblast ? OBLAST_RAYONS[selectedOblast] : null;
    const selectedRegionKey = selectedOblast ? SVG_ID_TO_REGION_KEY[selectedOblast] ?? '' : '';
    const selectedOblastName = selectedRegionKey ? REGION_LABELS[selectedRegionKey] ?? '' : '';
    const oblastBinCount = selectedRegionKey ? counts[selectedRegionKey] ?? 0 : 0;
    const currentRayonCounts = selectedOblast ? rayonCounts?.[selectedOblast] ?? {} : {};
    const maxRayonValue = useMemo(
        () => Math.max(1, ...Object.values(currentRayonCounts)),
        [currentRayonCounts],
    );
    const rayonColorScale = useMemo(
        () => scaleLinear<string>().domain([0, maxRayonValue]).range([palette.rayonMin, palette.rayonMax]),
        [maxRayonValue, palette],
    );

    // Pre-compute centroids for rayons
    const rayonCentroids = useMemo(() => {
        if (!selectedOblastData) return {};
        const result: Record<number, [number, number]> = {};
        selectedOblastData.rayons.forEach((rayon, i) => {
            result[i] = computePolygonCentroid(rayon.d);
        });
        return result;
    }, [selectedOblastData]);

    const wrapperClass = [
        'kz-map',
        isFullscreen ? 'kz-map--fullscreen' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={wrapperClass} ref={wrapperRef}>
            {/* Controls bar */}
            <div className="kz-map__controls">
                {selectedOblast && (
                    <button
                        className="kz-map__back-btn"
                        onClick={handleBack}
                        title="Назад к областям"
                        type="button"
                    >
                        ← Назад
                    </button>
                )}
                {selectedOblast && (
                    <span className="kz-map__district-title">
                        {selectedOblastName}
                        {oblastBinCount > 0 && (
                            <span className="kz-map__district-count"> — {oblastBinCount} БИН</span>
                        )}
                    </span>
                )}
                <button
                    className="kz-map__expand-btn"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? 'Свернуть карту' : 'Развернуть карту'}
                    type="button"
                >
                    {isFullscreen ? '✕' : '⛶'}
                </button>
            </div>

            {/* Oblast-level view */}
            {!selectedOblastData && (
                <svg
                    className="kz-map__svg"
                    viewBox={MAIN_VIEWBOX}
                    role="img"
                    aria-label="Карта Казахстана по регионам"
                    preserveAspectRatio="xMidYMid meet"
                >
                    {OBLASTS.map((oblast) => {
                        const regionKey = SVG_ID_TO_REGION_KEY[oblast.id] ?? '';
                        const value = counts[regionKey] ?? 0;
                        const isActive = hovered?.key === oblast.id;
                        const fillColor = value > 0 ? colorScale(value) : palette.empty;
                        const [cx, cy] = oblastCentroids[oblast.id] ?? [0, 0];
                        return (
                            <g key={oblast.id}>
                                <path
                                    d={oblast.d}
                                    fill={fillColor}
                                    className={`kz-map__region ${isActive ? 'is-active' : ''}`}
                                    onMouseEnter={(e) => handleMouseMove(e, oblast.id)}
                                    onMouseMove={(e) => handleMouseMove(e, oblast.id)}
                                    onMouseLeave={handleMouseLeave}
                                    onClick={() => handleOblastClick(oblast.id)}
                                />
                                {value > 0 && (
                                    <text
                                        x={cx}
                                        y={cy}
                                        className="kz-map__count-label"
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        pointerEvents="none"
                                    >
                                        {value}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>
            )}

            {/* District (rayon) view */}
            {selectedOblastData && (
                <svg
                    className="kz-map__svg kz-map__svg--district"
                    viewBox={selectedOblastData.viewBox}
                    role="img"
                    aria-label={`Карта районов: ${selectedOblastName}`}
                    preserveAspectRatio="xMidYMid meet"
                >
                    {selectedOblastData.rayons.map((rayon, index) => {
                        const isActive = hovered?.key === `rayon-${index}`;
                        const rayonValue = currentRayonCounts[index] ?? 0;
                        const fillColor = rayonValue > 0
                            ? rayonColorScale(rayonValue)
                            : palette.rayonEmpty;
                        const [rcx, rcy] = rayonCentroids[index] ?? [0, 0];
                        return (
                            <g key={`rayon-${index}`}>
                                <path
                                    d={rayon.d}
                                    fill={fillColor}
                                    className={`kz-map__rayon ${isActive ? 'is-active' : ''}`}
                                    onMouseEnter={(e) => handleMouseMove(e, `rayon-${index}`)}
                                    onMouseMove={(e) => handleMouseMove(e, `rayon-${index}`)}
                                    onMouseLeave={handleMouseLeave}
                                />
                                {rayonValue > 0 && (() => {
                                    // Scale font to match main map visual size (main viewBox=900 wide, font=14)
                                    const vbWidth = parseFloat(selectedOblastData.viewBox.split(' ')[2] ?? '900');
                                    const scaledFont = 14 * (vbWidth / 900);
                                    return (
                                        <text
                                            x={rcx}
                                            y={rcy}
                                            className="kz-map__count-label"
                                            textAnchor="middle"
                                            dominantBaseline="central"
                                            pointerEvents="none"
                                            style={{ fontSize: `${scaledFont}px` }}
                                        >
                                            {rayonValue}
                                        </text>
                                    );
                                })()}
                            </g>
                        );
                    })}
                </svg>
            )}

            {/* Tooltip */}
            {hovered && (
                <div
                    className="kz-map__tooltip"
                    style={{ left: hovered.x + 12, top: hovered.y + 12 }}
                >
                    {selectedOblastData ? (
                        (() => {
                            const idx = parseInt(hovered.key.replace('rayon-', ''), 10);
                            const rayon = selectedOblastData.rayons[idx];
                            const rayonValue = currentRayonCounts[idx] ?? 0;
                            const rs = rayonStats?.[selectedOblast!]?.[idx];
                            return (
                                <>
                                    <div className="kz-map__tooltip-title">
                                        {rayon?.name || 'Район'}
                                    </div>
                                    <div className="kz-map__tooltip-value">
                                        {rayonValue} БИН
                                    </div>
                                    {rs && (
                                        <div className="kz-map__tooltip-stats">
                                            <div>Диалогов: {rs.totalDialogs}</div>
                                            <div>Открытых: {rs.openDialogs}</div>
                                            <div>Закрытых: {rs.closedDialogs}</div>
                                            {rs.unreadCount > 0 && <div>Непрочит.: {rs.unreadCount}</div>}
                                        </div>
                                    )}
                                </>
                            );
                        })()
                    ) : (
                        (() => {
                            const regionKey = SVG_ID_TO_REGION_KEY[hovered.key] ?? '';
                            const rs = regionStats?.[regionKey];
                            return (
                                <>
                                    <div className="kz-map__tooltip-title">
                                        {REGION_LABELS[regionKey] ?? hovered.key}
                                    </div>
                                    <div className="kz-map__tooltip-value">
                                        {counts[regionKey] ?? 0} БИН
                                    </div>
                                    {rs && (
                                        <div className="kz-map__tooltip-stats">
                                            <div>Диалогов: {rs.totalDialogs}</div>
                                            <div>Открытых: {rs.openDialogs}</div>
                                            <div>Закрытых: {rs.closedDialogs}</div>
                                            {rs.unreadCount > 0 && <div>Непрочит.: {rs.unreadCount}</div>}
                                        </div>
                                    )}
                                </>
                            );
                        })()
                    )}
                </div>
            )}
        </div>
    );
});

export default RegionActivityMap;
