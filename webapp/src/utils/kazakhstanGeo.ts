import type { FeatureCollection, Geometry } from 'geojson';
import kzMap from '../../kz.json';
import { OBLASTS, OBLAST_RAYONS } from '../data/kzMapData';

/** GeoJSON features for Kazakhstan regions — kept for useDialogsData compatibility. */
export const GEOJSON_FEATURES = kzMap as FeatureCollection<Geometry, { name: string }>;

const CITY_LABELS: Record<string, string> = {
    'Almaty (city)': 'г. Алматы',
    Astana: 'г. Астана',
    'Shymkent (city)': 'г. Шымкент',
};

export const CITY_REGION_KEYS = new Set(Object.keys(CITY_LABELS));

export const REGION_LABELS = new Proxy(CITY_LABELS, {
    get(target, prop: string | symbol) {
        if (typeof prop !== 'string') return undefined;
        if (prop in target) return target[prop];
        const svgId = Object.entries(SVG_ID_TO_REGION_KEY).find(([, key]) => key === prop)?.[0];
        return svgId ? OBLASTS.find((oblast) => oblast.id === svgId)?.name ?? prop : prop;
    },
}) as Record<string, string>;

const LOCATION_STOP_WORDS = new Set([
    'район',
    'районы',
    'рн',
    'область',
    'обл',
    'город',
    'г',
    'имени',
    'им',
    'аудан',
    'ауданы',
    'облысы',
    'поселок',
    'село',
]);

const TOKEN_SUFFIXES = [
    'овского',
    'евского',
    'инского',
    'ынского',
    'ского',
    'скому',
    'скими',
    'ских',
    'ский',
    'ская',
    'ское',
    'ской',
    'ова',
    'ева',
    'ина',
    'ына',
    'ого',
    'его',
    'ой',
    'ый',
    'ий',
    'ая',
    'ое',
    'ые',
    'а',
    'ы',
];

function normalizeForMatch(value: string): string {
    const kazakhToRussianMap: Record<string, string> = {
        'ә': 'а',
        'ғ': 'г',
        'қ': 'к',
        'ң': 'н',
        'ө': 'о',
        'ұ': 'у',
        'ү': 'у',
        'һ': 'х',
        'і': 'и',
    };
    const latinLookalikesMap: Record<string, string> = {
        a: 'а',
        b: 'в',
        c: 'с',
        e: 'е',
        h: 'н',
        k: 'к',
        m: 'м',
        o: 'о',
        p: 'р',
        t: 'т',
        x: 'х',
        y: 'у',
    };

    return value
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[әғқңөұүһі]/g, (char) => kazakhToRussianMap[char] ?? char)
        .replace(/[abcehkmoptxy]/g, (char) => latinLookalikesMap[char] ?? char)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const stripDescriptors = (value: string): string => value
    .split(' ')
    .filter((token) => token.length >= 2 && !LOCATION_STOP_WORDS.has(token))
    .join(' ')
    .trim();

const shortenToken = (token: string): string[] => {
    const variants = new Set<string>();
    if (token.length < 3) return [];

    variants.add(token);

    for (const suffix of TOKEN_SUFFIXES) {
        if (!token.endsWith(suffix) || token.length - suffix.length < 3) continue;
        variants.add(token.slice(0, -suffix.length));
    }

    for (const suffix of ['ов', 'ев', 'ин', 'ын']) {
        if (!token.endsWith(suffix) || token.length - suffix.length < 4) continue;
        variants.add(token.slice(0, -suffix.length));
    }

    return [...variants].filter((variant) => variant.length >= 3);
};

const buildLocationAliases = (name: string): string[] => {
    const normalizedName = normalizeForMatch(name);
    const cleanedName = stripDescriptors(normalizedName);
    const aliases = new Set<string>();
    const addAlias = (candidate: string) => {
        const alias = candidate.trim();
        if (alias.length < 3) return;
        aliases.add(alias);
        aliases.add(alias.replace(/\s+/g, ''));
    };

    addAlias(normalizedName);
    if (cleanedName && cleanedName !== normalizedName) addAlias(cleanedName);

    const tokens = (cleanedName || normalizedName)
        .split(' ')
        .filter((token) => token.length >= 2 && !LOCATION_STOP_WORDS.has(token));

    const stemmedTokens = tokens.map((token) => {
        const variants = shortenToken(token);
        variants.forEach(addAlias);
        return variants.sort((left, right) => left.length - right.length)[0] ?? token;
    });

    if (tokens.length > 1) {
        addAlias(tokens.join(' '));
        addAlias(stemmedTokens.join(' '));
    }

    return [...aliases];
};

let regionMatchersCache: { key: string; patterns: string[] }[] | null = null;

const getRegionMatchers = (): { key: string; patterns: string[] }[] => {
    if (regionMatchersCache) return regionMatchersCache;

    const oblastMatchers = OBLASTS
        .map((oblast) => {
            const key = SVG_ID_TO_REGION_KEY[oblast.id];
            if (!key || CITY_REGION_KEYS.has(key)) return null;
            return { key, patterns: buildLocationAliases(oblast.name) };
        })
        .filter((entry): entry is { key: string; patterns: string[] } => Boolean(entry));

    const cityMatchers = [
        {
            key: 'Almaty (city)',
            patterns: ['алматы', 'г алматы', 'almaty city'],
        },
        {
            key: 'Astana',
            patterns: ['астана', 'г астана'],
        },
        {
            key: 'Shymkent (city)',
            patterns: ['шымкент', 'г шымкент', 'shymkent'],
        },
    ];

    regionMatchersCache = [...cityMatchers, ...oblastMatchers];
    return regionMatchersCache;
};

/**
 * Detects a Kazakhstan region key from a free-text address string.
 * Returns the GeoJSON feature key or null if no match found.
 */
export const detectRegionFromAddress = (address: string | null | undefined): string | null => {
    if (!address) return null;
    const normalized = normalizeForMatch(address);
    const compact = normalized.replace(/\s+/g, '');

    const match = getRegionMatchers().find((entry) =>
        entry.patterns.some((pattern) => normalized.includes(pattern) || compact.includes(pattern.replace(/\s+/g, ''))),
    );

    return match?.key ?? null;
};

const RAYON_EXTRA_PATTERNS: Record<string, Array<{ rayonName: string; patterns: string[] }>> = {
    turkistanOblast: [
        {
            rayonName: 'Сауран',
            patterns: ['г туркестан', 'город туркестан', 'кентау'],
        },
    ],
    almaty: [
        {
            rayonName: 'Бостандык',
            patterns: ['бостандық', 'бостандык'],
        },
    ],
};

const GENERATED_RAYON_MATCHERS: Record<string, Array<{ index: number; alias: string }>> = Object.fromEntries(
    Object.entries(OBLAST_RAYONS).map(([oblastKey, oblastData]) => {
        const aliasOwners = new Map<string, Set<number>>();

        oblastData.rayons.forEach((rayon, index) => {
            buildLocationAliases(rayon.name).forEach((alias) => {
                if (!aliasOwners.has(alias)) aliasOwners.set(alias, new Set<number>());
                aliasOwners.get(alias)?.add(index);
            });
        });

        const matchers = [...aliasOwners.entries()]
            .filter(([alias, owners]) => alias.length >= 4 && owners.size === 1)
            .map(([alias, owners]) => ({ alias, index: [...owners][0] }))
            .sort((left, right) => right.alias.length - left.alias.length);

        return [oblastKey, matchers];
    }),
);

const matchesAlias = (normalizedAddress: string, compactAddress: string, alias: string): boolean => {
    const compactAlias = alias.replace(/\s+/g, '');
    return normalizedAddress.includes(alias) || compactAddress.includes(compactAlias);
};

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
    const compact = normalized.replace(/\s+/g, '');

    const extraPatterns = RAYON_EXTRA_PATTERNS[oblastId] ?? [];
    for (const { rayonName, patterns } of extraPatterns) {
        if (patterns.some((pattern) => matchesAlias(normalized, compact, normalizeForMatch(pattern)))) {
            const idx = oblastData.rayons.findIndex(
                (rayon) => normalizeForMatch(rayon.name) === normalizeForMatch(rayonName),
            );
            if (idx >= 0) return idx;
        }
    }

    const generatedMatchers = GENERATED_RAYON_MATCHERS[oblastId] ?? [];
    for (const matcher of generatedMatchers) {
        if (matchesAlias(normalized, compact, matcher.alias)) {
            return matcher.index;
        }
    }

    return null;
};

/* Region key mapping */
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
