import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FeatureCollection, Geometry } from 'geojson';
import { scaleLinear } from 'd3';
import kzMap from '../../kz.json';
import { OBLASTS, OBLAST_RAYONS, MAIN_VIEWBOX } from '../data/kzMapData';
import type { RegionStats } from '../hooks/useDialogsData';
import type { BinDetailed, ChatSummary } from '../types';

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
        ['Алмалинский', ['алмалин', 'алмалы', 'район алматы']],
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

import EChartsWrapper from './EChartsWrapper';

const RegionActivityMap: React.FC<{
    counts: Record<string, number>;
    rayonCounts?: Record<string, Record<number, number>>;
    regionStats?: Record<string, RegionStats>;
    rayonStats?: Record<string, Record<number, RegionStats>>;
    binDetails?: BinDetailed[];
    chats?: ChatSummary[];
}> = React.memo(({ counts, rayonCounts, regionStats, rayonStats, binDetails, chats }) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const [hovered, setHovered] = useState<{ key: string; x: number; y: number } | null>(null);
    const [selectedOblast, setSelectedOblast] = useState<string | null>(null);
    const [selectedRayon, setSelectedRayon] = useState<number | null>(null);
    const [binTab, setBinTab] = useState<'all' | 'with_contract' | 'without_contract'>('all');
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
            setSelectedRayon(null);
            setHovered(null);
            setBinTab('all');
        }
    }, []);

    const handleBack = useCallback(() => {
        if (selectedRayon !== null) {
            setSelectedRayon(null);
            setHovered(null);
            setBinTab('all');
        } else {
            setSelectedOblast(null);
            setSelectedRayon(null);
            setHovered(null);
            setBinTab('all');
        }
    }, [selectedRayon]);

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

    // Lock body scroll when fullscreen (save/restore scroll position)
    useEffect(() => {
        if (isFullscreen) {
            const scrollY = window.scrollY;
            document.body.classList.add('kz-map-scroll-lock');
            document.body.style.top = `-${scrollY}px`;
            return () => {
                document.body.classList.remove('kz-map-scroll-lock');
                document.body.style.top = '';
                window.scrollTo(0, scrollY);
            };
        }
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

    // ─── Analytics for the right panel (Oblast or selected Rayon) ───
    const activeAnalytics = useMemo(() => {
        if (!selectedOblast || !selectedRegionKey) return null;

        let targetBins = binDetails ?? [];
        let rStats: RegionStats | null = null;
        const oData = OBLAST_RAYONS[selectedOblast];

        if (selectedRayon === null) {
            // Oblast Mode
            rStats = regionStats?.[selectedRegionKey] ?? null;
            targetBins = targetBins.filter((d) => detectRegionFromAddress(d.customerLegalAddress) === selectedRegionKey);

            const withContract = targetBins.filter((b) => b.hasContract).length;
            const withoutContract = targetBins.length - withContract;

            const rayonBreakdown: { name: string; bins: number; stats: RegionStats | null }[] = [];
            if (oData) {
                oData.rayons.forEach((rayon, idx) => {
                    const bins = currentRayonCounts[idx] ?? 0;
                    const rs2 = rayonStats?.[selectedOblast]?.[idx] ?? null;
                    rayonBreakdown.push({ name: rayon.name || `Район ${idx + 1}`, bins, stats: rs2 });
                });
                rayonBreakdown.sort((a, b) => b.bins - a.bins);
            }

            return {
                mode: 'oblast' as const,
                title: selectedOblastName,
                totalBins: targetBins.length,
                totalDialogs: rStats?.totalDialogs ?? 0,
                openDialogs: rStats?.openDialogs ?? 0,
                closedDialogs: rStats?.closedDialogs ?? 0,
                unreadCount: rStats?.unreadCount ?? 0,
                withContract,
                withoutContract,
                breakdownLabel: 'Районы по БИН',
                breakdownList: rayonBreakdown.map(r => ({ name: r.name, value: r.bins })),
                rayonBreakdown, // needed for Top 5 charts in oblast mode
                stats: rStats,
            };
        } else {
            // Rayon Mode
            const rs = rayonStats?.[selectedOblast]?.[selectedRayon] ?? null;
            rStats = rs;
            const rayonName = oData?.rayons[selectedRayon]?.name || `Район ${selectedRayon + 1}`;

            targetBins = targetBins.filter((d) => {
                const rk = detectRegionFromAddress(d.customerLegalAddress);
                if (!rk) return false;

                let checkOblast = selectedOblast;
                // Deal with Shymkent within Turkistan map
                if (rk === 'Shymkent (city)' && selectedOblast === 'turkistanOblast') {
                    checkOblast = 'turkistanOblast';
                } else if (SVG_ID_TO_REGION_KEY[checkOblast] !== rk) {
                    return false;
                }

                const idx = detectRayonFromAddress(d.customerLegalAddress, checkOblast);
                return idx === selectedRayon;
            });

            const withContract = targetBins.filter((b) => b.hasContract).length;
            const withoutContract = targetBins.length - withContract;

            // Top BINs by dialog count
            const binCounts: Record<string, number> = {};
            const targetBinSet = new Set(targetBins.map(b => b.bin));

            if (chats) {
                chats.forEach(c => {
                    if (c.bin && targetBinSet.has(c.bin)) {
                        binCounts[c.bin] = (binCounts[c.bin] || 0) + 1;
                    }
                });
            }

            let filteredBins = targetBins;
            if (binTab === 'with_contract') filteredBins = targetBins.filter(b => b.hasContract);
            else if (binTab === 'without_contract') filteredBins = targetBins.filter(b => !b.hasContract);

            const filteredBinSet = new Set(filteredBins.map(b => b.bin));

            const topBinsList = Object.entries(binCounts)
                .filter(([bin]) => filteredBinSet.has(bin))
                .map(([bin, count]) => {
                    return { name: bin, value: count };
                })
                .sort((a, b) => b.value - a.value)
                .slice(0, 5);

            return {
                mode: 'rayon' as const,
                title: rayonName,
                totalBins: targetBins.length,
                totalDialogs: rStats?.totalDialogs ?? 0,
                openDialogs: rStats?.openDialogs ?? 0,
                closedDialogs: rStats?.closedDialogs ?? 0,
                unreadCount: rStats?.unreadCount ?? 0,
                withContract,
                withoutContract,
                breakdownLabel: 'Топ БИН по обращениям',
                breakdownList: topBinsList,
                rayonBreakdown: [],
                stats: rStats,
            };
        }
    }, [selectedOblast, selectedRegionKey, selectedRayon, regionStats, rayonStats, binDetails, currentRayonCounts, chats, binTab, selectedOblastName]);

    const renderRatingCard = (
        title: string,
        average: number | null,
        count: number,
        distribution: number[],
        emptyText: string,
    ) => {
        const ratingCounts = [1, 2, 3, 4, 5].map((rating) => distribution[rating - 1] ?? 0);
        const yMax = Math.max(1, ...ratingCounts);
        const axisMax = yMax <= 1 ? 1.15 : yMax + Math.max(0.25, yMax * 0.1);

        return (
            <div className="dashboard-card dashboard-card--rating" style={{ margin: 0 }}>
                <h3 className="dashboard-card__title">{title}</h3>
                {count === 0 ? (
                    <div className="dashboard-empty kz-rating-empty" style={{ minHeight: 220 }}>
                        <div className="kz-rating-empty__visual" aria-hidden="true">
                            <span className="kz-rating-empty__bar kz-rating-empty__bar--1" />
                            <span className="kz-rating-empty__bar kz-rating-empty__bar--2" />
                            <span className="kz-rating-empty__bar kz-rating-empty__bar--3" />
                            <span className="kz-rating-empty__bar kz-rating-empty__bar--4" />
                            <span className="kz-rating-empty__bar kz-rating-empty__bar--5" />
                        </div>
                        <p className="dashboard-empty__text kz-rating-empty__text">{emptyText}</p>
                    </div>
                ) : (
                    <div className="dashboard-rating">
                        <div className="dashboard-rating__summary">
                            <div className="dashboard-rating__score">
                                {average !== null ? average.toFixed(1) : '—'}
                            </div>
                            <div className="dashboard-rating__caption">Средняя оценка</div>
                            <div className="dashboard-rating__count">
                                {count} отзывов
                            </div>
                        </div>
                        <div className="dashboard-rating__chart">
                            <EChartsWrapper
                                option={{
                                    tooltip: {
                                        trigger: 'axis',
                                        axisPointer: { type: 'none' },
                                        backgroundColor: 'var(--surface-color, #ffffff)',
                                        borderColor: 'var(--border-color, #e2e8f0)',
                                        borderWidth: 1,
                                        textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                                        formatter: '{b} ★: <b>{c}</b>',
                                    },
                                    grid: { top: 8, right: 8, bottom: 4, left: 8, containLabel: true },
                                    xAxis: {
                                        type: 'category',
                                        data: ['1', '2', '3', '4', '5'],
                                        axisLine: { show: false },
                                        axisTick: { show: false },
                                        axisLabel: { fontSize: 13, color: 'var(--text-color, #334155)', margin: 12 },
                                    },
                                    yAxis: {
                                        type: 'value',
                                        show: false,
                                        min: 0,
                                        max: axisMax,
                                    },
                                    series: [
                                        {
                                            type: 'bar',
                                            barWidth: 30,
                                            barMinHeight: 2,
                                            data: ratingCounts,
                                            itemStyle: {
                                                borderRadius: [6, 6, 0, 0],
                                                color: (params: any) => {
                                                    const rating = Number(params.name);
                                                    if (rating <= 2) return '#ef4444';
                                                    if (rating === 3) return '#f59e0b';
                                                    return '#22c55e';
                                                },
                                            },
                                            label: {
                                                show: true,
                                                position: 'top',
                                                color: 'var(--text-muted, #64748b)',
                                                fontSize: 12,
                                                fontWeight: 700,
                                                formatter: (params: any) => `${Number(params?.value ?? 0)}`,
                                            },
                                        },
                                    ],
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const wrapperClass = [
        'kz-map',
        isFullscreen ? 'kz-map--fullscreen' : '',
        selectedOblastData ? 'kz-map--district-mode' : '',
    ].filter(Boolean).join(' ');

    const mapElement = (
        <>
            {isFullscreen && (
                <div
                    className="kz-map__backdrop"
                    onClick={toggleFullscreen}
                    aria-hidden="true"
                />
            )}
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
                            {activeAnalytics?.title || selectedOblastName}
                            {activeAnalytics && activeAnalytics.totalBins > 0 && (
                                <span className="kz-map__district-count"> — {activeAnalytics.totalBins} БИН</span>
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

                {/* District (rayon) view — split layout with analytics */}
                {selectedOblastData && (
                    <div className="kz-map__split">
                        {/* Left: map */}
                        <div className="kz-map__split-left">
                            <svg
                                className="kz-map__svg kz-map__svg--district"
                                viewBox={selectedOblastData.viewBox}
                                role="img"
                                aria-label={`Карта районов: ${selectedOblastName}`}
                                preserveAspectRatio="xMidYMid meet"
                                onClick={() => setSelectedRayon(null)}
                            >
                                {selectedOblastData.rayons.map((rayon, index) => {
                                    const isActive = hovered?.key === `rayon-${index}` || selectedRayon === index;
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
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRayon(selectedRayon === index ? null : index);
                                                }}
                                            />
                                            {rayonValue > 0 && (() => {
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
                        </div>

                        {/* Right: analytics panel */}
                        {activeAnalytics && (
                            <div className="kz-map__split-right">
                                {/* Summary stat cards */}
                                <div className="kz-panel__stats">
                                    <div className="kz-panel__stat">
                                        <span className="kz-panel__stat-value">{activeAnalytics.totalBins}</span>
                                        <span className="kz-panel__stat-label">БИН</span>
                                    </div>
                                    <div className="kz-panel__stat">
                                        <span className="kz-panel__stat-value">{activeAnalytics.totalDialogs}</span>
                                        <span className="kz-panel__stat-label">Диалогов</span>
                                    </div>
                                    <div className="kz-panel__stat kz-panel__stat--open">
                                        <span className="kz-panel__stat-value">{activeAnalytics.openDialogs}</span>
                                        <span className="kz-panel__stat-label">Открытых</span>
                                    </div>
                                    <div className="kz-panel__stat kz-panel__stat--closed">
                                        <span className="kz-panel__stat-value">{activeAnalytics.closedDialogs}</span>
                                        <span className="kz-panel__stat-label">Закрытых</span>
                                    </div>
                                    {activeAnalytics.unreadCount > 0 && (
                                        <div className="kz-panel__stat kz-panel__stat--unread">
                                            <span className="kz-panel__stat-value">{activeAnalytics.unreadCount}</span>
                                            <span className="kz-panel__stat-label">Непрочит.</span>
                                        </div>
                                    )}
                                </div>

                                {/* Contracts breakdown */}
                                <details className="kz-panel__section kz-panel__collapsible" open>
                                    <summary className="kz-panel__section-title">Договоры</summary>
                                    <div style={{ height: 16, width: '100%', marginTop: 8, marginBottom: 8, borderRadius: 4, overflow: 'hidden' }}>
                                        <EChartsWrapper
                                            option={{
                                                grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                                xAxis: { type: 'value', show: false, max: (activeAnalytics.withContract || 0) + (activeAnalytics.withoutContract || 0) || 1 },
                                                yAxis: { type: 'category', data: [''], show: false },
                                                tooltip: { show: false },
                                                series: [
                                                    {
                                                        name: 'С контрактом',
                                                        type: 'bar',
                                                        stack: 'total',
                                                        data: [activeAnalytics.withContract || 0],
                                                        barWidth: '100%',
                                                        itemStyle: { color: '#10b981', borderRadius: [4, 0, 0, 4] }
                                                    },
                                                    {
                                                        name: 'Без контракта',
                                                        type: 'bar',
                                                        stack: 'total',
                                                        data: [activeAnalytics.withoutContract || 0],
                                                        barWidth: '100%',
                                                        itemStyle: { color: '#f43f5e', borderRadius: [0, 4, 4, 0] }
                                                    }
                                                ]
                                            }}
                                        />
                                    </div>
                                    <div className="kz-panel__bar-legend">
                                        <span className="kz-panel__legend-item">
                                            <span className="kz-panel__legend-dot kz-panel__legend-dot--contract" />
                                            С контрактом: {activeAnalytics.withContract}
                                        </span>
                                        <span className="kz-panel__legend-item">
                                            <span className="kz-panel__legend-dot kz-panel__legend-dot--no-contract" />
                                            Без: {activeAnalytics.withoutContract}
                                        </span>
                                    </div>
                                </details>

                                {/* Dynamic Breakdown (Rayons or Top BINs) */}
                                <details className="kz-panel__section kz-panel__collapsible" open>
                                    <summary className="kz-panel__section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        Сведения
                                    </summary>
                                    <div className="kz-panel__section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted-color)' }}>
                                            {activeAnalytics.breakdownLabel}
                                        </div>
                                        {activeAnalytics.mode === 'rayon' && (
                                            <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.05)', padding: 2, borderRadius: 6 }} onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    onClick={() => setBinTab('all')}
                                                    style={{ border: 'none', background: binTab === 'all' ? '#fff' : 'transparent', boxShadow: binTab === 'all' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none', color: binTab === 'all' ? '#1e293b' : 'inherit', borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem', cursor: 'pointer' }}
                                                >Все</button>
                                                <button
                                                    onClick={() => setBinTab('with_contract')}
                                                    style={{ border: 'none', background: binTab === 'with_contract' ? '#10b981' : 'transparent', color: binTab === 'with_contract' ? '#fff' : 'inherit', borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem', cursor: 'pointer' }}
                                                >С дог.</button>
                                                <button
                                                    onClick={() => setBinTab('without_contract')}
                                                    style={{ border: 'none', background: binTab === 'without_contract' ? '#f43f5e' : 'transparent', color: binTab === 'without_contract' ? '#fff' : 'inherit', borderRadius: 4, padding: '2px 8px', fontSize: '0.65rem', cursor: 'pointer' }}
                                                >Без дог.</button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="kz-panel__rayon-bars" style={{ marginTop: 8 }}>
                                        {activeAnalytics.breakdownList.length === 0 && (
                                            <div className="text-muted" style={{ fontSize: '0.8rem', padding: '8px 0' }}>Нет данных</div>
                                        )}
                                        {activeAnalytics.breakdownList.slice(0, 8).map((r) => {
                                            const maxBins = activeAnalytics.breakdownList[0]?.value || 1;
                                            return (
                                                <div className="kz-panel__rayon-bar" key={r.name}>
                                                    <span className="kz-panel__rayon-name" title={r.name}>{r.name}</span>
                                                    <div style={{ height: 10, flex: 1, margin: '0 8px' }}>
                                                        <EChartsWrapper
                                                            option={{
                                                                grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                                                xAxis: { type: 'value', show: false, max: maxBins },
                                                                yAxis: { type: 'category', data: [''], show: false },
                                                                tooltip: { show: false },
                                                                series: [
                                                                    {
                                                                        type: 'bar',
                                                                        data: [r.value],
                                                                        barWidth: '100%',
                                                                        itemStyle: { color: activeAnalytics.mode === 'oblast' ? '#6366f1' : '#14b8a6', borderRadius: 4 },
                                                                        showBackground: true,
                                                                        backgroundStyle: { color: '#e2e8f0', borderRadius: 4 }
                                                                    }
                                                                ]
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="kz-panel__rayon-value">{r.value}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </details>

                                {/* AI Automation - Dashboard Style */}
                                {(() => {
                                    const totalForSlaAndAi = activeAnalytics.closedDialogs;
                                    const aiClosed = activeAnalytics.stats?.aiClosedDialogs ?? 0;
                                    const opsHandled = Math.max(0, totalForSlaAndAi - aiClosed);
                                    const aiPct = totalForSlaAndAi > 0 ? (aiClosed / totalForSlaAndAi) * 100 : 0;

                                    return (
                                        <details className="kz-panel__section kz-panel__collapsible" open>
                                            <summary className="kz-panel__section-title">Автоматизация (AI)</summary>
                                            <div className="dashboard-ai-bar" style={{ marginTop: 12 }}>
                                                <div className="dashboard-ai-bar__hero">
                                                    <span className="dashboard-ai-bar__pct">{totalForSlaAndAi > 0 ? aiPct.toFixed(0) + '%' : '—'}</span>
                                                    <span className="dashboard-ai-bar__pct-label">решено ботом</span>
                                                </div>

                                                <div style={{ height: 16, width: '100%', marginTop: 12, marginBottom: 12, borderRadius: 8, overflow: 'hidden' }}>
                                                    <EChartsWrapper
                                                        option={{
                                                            tooltip: {
                                                                trigger: 'axis',
                                                                axisPointer: { type: 'none' },
                                                                backgroundColor: 'var(--surface-color, #ffffff)',
                                                                borderColor: 'var(--border-color, #e2e8f0)',
                                                                borderWidth: 1,
                                                                textStyle: { color: 'var(--text-color, #334155)', fontSize: 12 },
                                                                formatter: (params: any) => {
                                                                    if (totalForSlaAndAi === 0) return 'Нет данных';
                                                                    return params.map((p: any) => `${p.seriesName}: <b>${p.value}</b>`).join('<br/>');
                                                                }
                                                            },
                                                            grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                                            xAxis: { type: 'value', show: false, max: totalForSlaAndAi > 0 ? totalForSlaAndAi : 1 },
                                                            yAxis: { type: 'category', data: ['AI'], show: false },
                                                            series: totalForSlaAndAi === 0 ? [
                                                                { type: 'bar', data: [1], barWidth: 14, itemStyle: { color: '#e2e8f0' }, animation: false }
                                                            ] : [
                                                                {
                                                                    name: 'Решено ботом',
                                                                    type: 'bar',
                                                                    stack: 'total',
                                                                    data: [aiClosed],
                                                                    barWidth: 14,
                                                                    itemStyle: { color: '#3b82f6', borderRadius: [8, 0, 0, 8] }
                                                                },
                                                                {
                                                                    name: 'Решено оператором',
                                                                    type: 'bar',
                                                                    stack: 'total',
                                                                    data: [opsHandled],
                                                                    barWidth: 14,
                                                                    itemStyle: { color: '#cbd5e1', borderRadius: [0, 8, 8, 0] }
                                                                }
                                                            ]
                                                        }}
                                                    />
                                                </div>

                                                <div className="kz-panel__bar-legend" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span className="kz-panel__legend-dot" style={{ background: '#3b82f6', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                                                            <span style={{ color: 'var(--text-color)' }}>Решено ботом</span>
                                                        </div>
                                                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{aiClosed}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <span className="kz-panel__legend-dot" style={{ background: '#cbd5e1', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }} />
                                                            <span style={{ color: 'var(--text-color)' }}>Переведено оператору</span>
                                                        </div>
                                                        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{opsHandled}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </details>
                                    );
                                })()}

                                {/* SLA Section - Conditional Based on Mode */}
                                {activeAnalytics.mode === 'oblast' ? (
                                    <details className="kz-panel__section kz-panel__collapsible" open>
                                        <summary className="kz-panel__section-title">Топ-5 по SLA</summary>
                                        <div className="kz-panel__rayon-bars" style={{ marginTop: 8 }}>
                                            {activeAnalytics.rayonBreakdown
                                                .map(r => {
                                                    const fast = r.stats?.responseSpeedFast ?? 0;
                                                    const medium = r.stats?.responseSpeedMedium ?? 0;
                                                    const slow = r.stats?.responseSpeedSlow ?? 0;
                                                    const total = fast + medium + slow;
                                                    const sla = total > 0 ? (fast / total) * 100 : null;
                                                    return { ...r, sla };
                                                })
                                                .filter((r): r is typeof r & { sla: number } => r.sla !== null)
                                                .sort((a, b) => b.sla - a.sla)
                                                .slice(0, 5)
                                                .map(r => (
                                                    <div className="kz-panel__rayon-bar" key={r.name}>
                                                        <span className="kz-panel__rayon-name" title={r.name}>{r.name}</span>
                                                        <div style={{ height: 10, flex: 1, margin: '0 8px' }}>
                                                            <EChartsWrapper
                                                                option={{
                                                                    grid: { top: 0, bottom: 0, left: 0, right: 0 },
                                                                    xAxis: { type: 'value', show: false, max: 100 },
                                                                    yAxis: { type: 'category', data: [''], show: false },
                                                                    tooltip: { show: false },
                                                                    series: [
                                                                        {
                                                                            type: 'bar',
                                                                            data: [r.sla],
                                                                            barWidth: '100%',
                                                                            itemStyle: {
                                                                                color: r.sla >= 80 ? '#22c55e' : (r.sla >= 50 ? '#f59e0b' : '#ef4444'),
                                                                                borderRadius: 4
                                                                            },
                                                                            showBackground: true,
                                                                            backgroundStyle: { color: '#e2e8f0', borderRadius: 4 }
                                                                        }
                                                                    ]
                                                                }}
                                                            />
                                                        </div>
                                                        <span className="kz-panel__rayon-value">{Math.round(r.sla)}%</span>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    </details>
                                ) : (
                                    (() => {
                                        const stats = activeAnalytics.stats;
                                        const fast = stats?.responseSpeedFast ?? 0;
                                        const medium = stats?.responseSpeedMedium ?? 0;
                                        const slow = stats?.responseSpeedSlow ?? 0;
                                        const totalResponded = fast + medium + slow;
                                        const slaPct = totalResponded > 0 ? (fast / totalResponded) * 100 : null;
                                        const gaugeColor = slaPct !== null && slaPct >= 80 ? '#22c55e' : (slaPct !== null && slaPct >= 50 ? '#f59e0b' : '#ef4444');
                                        const slaViolations = medium + slow;

                                        return (
                                            <details className="kz-panel__section kz-panel__collapsible" open>
                                                <summary className="kz-panel__section-title">Качество обслуживания</summary>
                                                {totalResponded > 0 ? (
                                                    <div style={{ marginTop: 12 }}>
                                                        <div className="dashboard-sla-gauge" style={{ position: 'relative', height: 120 }}>
                                                            <EChartsWrapper
                                                                option={{
                                                                    series: [
                                                                        {
                                                                            type: 'gauge',
                                                                            startAngle: 180,
                                                                            endAngle: 0,
                                                                            center: ['50%', '70%'],
                                                                            radius: '100%',
                                                                            min: 0,
                                                                            max: 100,
                                                                            splitNumber: 1,
                                                                            itemStyle: {
                                                                                color: gaugeColor
                                                                            },
                                                                            progress: {
                                                                                show: true,
                                                                                width: 10,
                                                                                roundCap: true
                                                                            },
                                                                            axisLine: {
                                                                                roundCap: true,
                                                                                lineStyle: {
                                                                                    width: 10,
                                                                                    color: [[1, '#e2e8f0']]
                                                                                }
                                                                            },
                                                                            pointer: { show: false },
                                                                            axisTick: { show: false },
                                                                            splitLine: { show: false },
                                                                            axisLabel: { show: false },
                                                                            detail: { show: false },
                                                                            data: [{ value: slaPct ?? 0 }]
                                                                        }
                                                                    ]
                                                                }}
                                                            />
                                                            <div className="dashboard-sla-gauge__label" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, marginTop: 0 }}>
                                                                <span className="dashboard-sla-gauge__value" style={{ color: gaugeColor }}>
                                                                    {slaPct !== null ? slaPct.toFixed(1) + '%' : '—'}
                                                                </span>
                                                                <span className="dashboard-sla-gauge__sub">SLA (ответ до 5 мин)</span>
                                                            </div>
                                                        </div>

                                                        <div className="dashboard-legend" style={{ marginTop: 8 }}>
                                                            <div className="dashboard-legend-row" style={{ justifyContent: 'center' }}>
                                                                <div className="dashboard-legend-left" style={{ gap: 6 }}>
                                                                    <span className="dashboard-legend-dot" style={{ background: '#ef4444' }} />
                                                                    <span className="dashboard-legend-label">Ответов с задержкой</span>
                                                                    <span className="dashboard-legend-count" style={{ color: slaViolations > 0 ? 'var(--input-error-color)' : 'inherit', marginLeft: 4 }}>
                                                                        {slaViolations}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-muted" style={{ fontSize: '0.8rem', padding: '8px 0' }}>Нет данных</div>
                                                )}
                                            </details>
                                        );
                                    })()
                                )}

                                {/* Average customer rating (SCAT + AI) */}
                                {(() => {
                                    const stats = activeAnalytics.stats;
                                    const csatAvg = stats && stats.csatCount > 0 ? stats.csatSum / stats.csatCount : null;
                                    const aiCsatAvg = stats && stats.aiCsatCount > 0 ? stats.aiCsatSum / stats.aiCsatCount : null;
                                    const csatDistribution = stats?.csatDistribution ?? [0, 0, 0, 0, 0];
                                    const aiCsatDistribution = stats?.aiCsatDistribution ?? [0, 0, 0, 0, 0];
                                    return (
                                        <details className="kz-panel__section kz-panel__collapsible" open>
                                            <summary className="kz-panel__section-title">Средняя оценка клиентов</summary>
                                            <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
                                                {renderRatingCard(
                                                    'Удовлетворенность (SCAT)',
                                                    csatAvg,
                                                    stats?.csatCount ?? 0,
                                                    csatDistribution,
                                                    'Пока нет оценок операторов.',
                                                )}
                                                {renderRatingCard(
                                                    'Оценка работы AI',
                                                    aiCsatAvg,
                                                    stats?.aiCsatCount ?? 0,
                                                    aiCsatDistribution,
                                                    'Пока нет оценок AI.',
                                                )}
                                            </div>
                                        </details>
                                    );
                                })()}
                            </div>
                        )}
                    </div >
                )}

                {/* Tooltip */}
                {
                    hovered && (
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
                    )
                }
            </div >
        </>
    );

    if (isFullscreen && typeof document !== 'undefined') {
        return createPortal(mapElement, document.body);
    }

    return mapElement;
});

export default RegionActivityMap;


