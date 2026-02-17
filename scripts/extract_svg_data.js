/**
 * Extract SVG path data from zxzxzxzxzxzxzzxzx.html using line-by-line parsing.
 * Avoids catastrophic regex backtracking on the 500KB file.
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '..', 'zxzxzxzxzxzxzzxzx.html');
const lines = fs.readFileSync(htmlPath, 'utf-8').split('\n');

// ─── 1. Extract MAIN MAP oblasts (lines 340-559) ─────
const oblasts = [];
let i = 0;
// Find the start of the main SVG map
while (i < lines.length && !lines[i].includes('<div class="mapDiv">')) i++;

// Parse oblast <g> groups
while (i < lines.length && !lines[i].includes('</svg>')) {
    const line = lines[i].trim();
    // Detect oblast group start: <g id="aktobeOblast" class="oblys">
    const oblastMatch = line.match(/^<g id="([^"]+)" class="oblys">/);
    if (oblastMatch) {
        const id = oblastMatch[1];
        let d = '';
        let name = '';
        let labelX = 0, labelY = 0, labelWidth = 80;

        // Scan forward for path d="" and foreignObject
        let j = i + 1;
        while (j < lines.length && !lines[j].trim().startsWith('</g>')) {
            const l = lines[j].trim();
            const dMatch = l.match(/^d="([^"]+)"/);
            if (dMatch) d = dMatch[1];

            const foMatch = l.match(/foreignObject x="([^"]+)" y="([^"]+)" width="([^"]+)"/);
            if (foMatch) {
                labelX = parseFloat(foMatch[1]);
                labelY = parseFloat(foMatch[2]);
                labelWidth = parseFloat(foMatch[3]);
            }

            // Name is text content after >Name</foreignObject
            const nameMatch = l.match(/>([^<]+)<\/foreignObject/);
            if (nameMatch) name = nameMatch[1].trim();

            j++;
        }

        if (d) {
            oblasts.push({ id, name, d, labelX, labelY, labelWidth });
        }
    }
    i++;
}

console.log(`Found ${oblasts.length} oblasts:`);
oblasts.forEach(o => console.log(`  ${o.id}: "${o.name}" path=${o.d.length} chars`));

// ─── 2. Extract RAYON SVGs from modal section ─────
const oblastRayons = {};
i = 0;
// Find the modal section
while (i < lines.length && !lines[i].includes('<!-- Модальное окно -->')) i++;

while (i < lines.length) {
    const line = lines[i].trim();

    // Detect region SVG start: <svg id="ZKO" class="region ..."
    const svgMatch = line.match(/^<svg$/);
    if (svgMatch || line.match(/^<svg\s/)) {
        // Read ahead to gather SVG attributes
        let svgBlock = line;
        let j = i;
        while (j < lines.length && !svgBlock.includes('>')) {
            j++;
            svgBlock += ' ' + lines[j].trim();
        }

        const idMatch = svgBlock.match(/id="([^"]+)"/);
        const classMatch = svgBlock.match(/class="region/);
        const vbMatch = svgBlock.match(/viewBox="([^"]+)"/);

        if (idMatch && classMatch && vbMatch) {
            const oblastId = idMatch[1];
            const viewBox = vbMatch[1];
            const rayons = [];

            // Scan for rayon groups within this SVG
            let k = j + 1;
            let svgDepth = 1;
            while (k < lines.length && svgDepth > 0) {
                const rl = lines[k].trim();

                if (rl === '</svg>') {
                    svgDepth--;
                    if (svgDepth === 0) break;
                }
                if (rl.match(/<svg[\s>]/)) svgDepth++;

                // Detect rayon group
                if (rl.includes('class="rayon"')) {
                    let rayonD = '';
                    let rayonName = '';
                    let rayonLabelX = 0, rayonLabelY = 0;

                    let rk = k + 1;
                    let rayonEnd = false;
                    while (rk < lines.length && !rayonEnd) {
                        const rrl = lines[rk].trim();

                        // Path d attribute - could be very long single line
                        const rdMatch = rrl.match(/d="([^"]+)"/);
                        if (rdMatch && !rayonD) rayonD = rdMatch[1];

                        // foreignObject with label
                        const rfoMatch = rrl.match(/x="([^"]+)"/);
                        if (rrl.includes('foreignObject') && rfoMatch) {
                            const yMatch = rrl.match(/y="([^"]+)"/);
                            if (yMatch) {
                                rayonLabelX = parseFloat(rfoMatch[1]);
                                rayonLabelY = parseFloat(yMatch[1]);
                            }
                        }

                        // Name from foreignObject content (may be on same or next line)
                        const rnMatch = rrl.match(/>([^<]+)<\/foreignObject/);
                        if (rnMatch) rayonName = rnMatch[1].trim();

                        // End of rayon group (second </g>)
                        if (rrl === '</g>' && lines[rk - 1]?.trim() === '</g>') {
                            rayonEnd = true;
                        }
                        // Also detect next rayon group or end of SVG
                        if (rrl.includes('class="rayon"') && rk > k + 1) {
                            rayonEnd = true;
                            rk--; // back up so outer loop catches it
                        }

                        rk++;
                    }

                    if (rayonD) {
                        rayons.push({ name: rayonName, d: rayonD, labelX: rayonLabelX, labelY: rayonLabelY });
                    }
                }

                k++;
            }

            if (rayons.length > 0) {
                oblastRayons[oblastId] = { viewBox, rayons };
                console.log(`  ${oblastId}: ${rayons.length} rayons, viewBox="${viewBox}"`);
            }

            i = k;
            continue;
        }
    }
    i++;
}

console.log(`\nTotal oblasts with rayon data: ${Object.keys(oblastRayons).length}`);

// ─── 3. Generate TypeScript ─────

let ts = `// Auto-generated from zxzxzxzxzxzxzzxzx.html — do not edit manually

export interface OblastData {
  id: string;
  name: string;
  d: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
}

export interface RayonData {
  name: string;
  d: string;
  labelX: number;
  labelY: number;
}

export interface OblastRayonData {
  oblastId: string;
  viewBox: string;
  rayons: RayonData[];
}

export const MAIN_VIEWBOX = '45 25 900 500';

export const OBLASTS: OblastData[] = [\n`;

for (const o of oblasts) {
    ts += `  {\n    id: ${JSON.stringify(o.id)},\n    name: ${JSON.stringify(o.name)},\n    d: ${JSON.stringify(o.d)},\n    labelX: ${o.labelX},\n    labelY: ${o.labelY},\n    labelWidth: ${o.labelWidth},\n  },\n`;
}

ts += `];\n\nexport const OBLAST_RAYONS: Record<string, OblastRayonData> = {\n`;

for (const [oblastId, data] of Object.entries(oblastRayons)) {
    ts += `  ${JSON.stringify(oblastId)}: {\n    oblastId: ${JSON.stringify(oblastId)},\n    viewBox: ${JSON.stringify(data.viewBox)},\n    rayons: [\n`;
    for (const r of data.rayons) {
        ts += `      {\n        name: ${JSON.stringify(r.name)},\n        d: ${JSON.stringify(r.d)},\n        labelX: ${r.labelX},\n        labelY: ${r.labelY},\n      },\n`;
    }
    ts += `    ],\n  },\n`;
}

ts += `};\n`;

const outPath = path.resolve(__dirname, '..', 'webapp', 'src', 'data', 'kzMapData.ts');
const outDir = path.dirname(outPath);
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, ts, 'utf-8');
console.log(`\nWritten to ${outPath}`);
console.log(`File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
