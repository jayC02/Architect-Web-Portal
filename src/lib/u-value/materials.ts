/** Curated manufacturer declarations; verify suitability as design values for the application. */
export const thermalMaterials = [
  { id: 'sopratherm-ga4000', name: 'SOPRATHERM GA4000 PIR', lambda: 0.022, thickness: 100,
    thicknesses: [50, 60, 70, 75, 80, 90, 100],
    source: 'SOPREMA / Celotex GA4000 technical datasheet, declared λD 0.022 W/mK (50–100 mm).',
    url: 'https://www.soprema.co.uk/products/sopratherm-ga4000', category: 'insulation',
  },
  { id: 'knauf-loft-roll-44', name: 'Knauf Loft Roll 44', lambda: 0.044, thickness: 150,
    thicknesses: [100, 150, 170, 200], source: 'Knauf Insulation Loft Rolls 40 and 44 technical datasheet, Loft Roll 44 declared λ 0.044 W/mK.',
    url: 'https://media.knauf.com/a/VEqwq9hTWtrZp8SpanohsE', category: 'insulation',
  },
  { id: 'rockwool-flexi', name: 'ROCKWOOL Flexi', lambda: 0.038, thickness: 100,
    thicknesses: [50, 60, 70, 90, 100, 120, 140, 180],
    source: 'ROCKWOOL UK product guide: Flexi λ 0.038 W/mK at 50–120 mm; 0.035 W/mK at 140 mm and above.',
    url: 'https://brandcommunity.rockwool.com/asset/qtTkAzUqAly00_J5I7ZtMw/asset.pdf?quality=10', category: 'insulation',
  },
  { id: 'gyproc-wallboard-9.5', name: 'Gyproc WallBoard 9.5 mm', lambda: 0.19, thickness: 9.5,
    thicknesses: [9.5], source: 'British Gypsum Gyproc WallBoard 9.5 mm product data sheet, 17 October 2025; λ 0.19 W/mK.',
    url: 'https://www.british-gypsum.com/download-documents/product-data-sheet-pds/british-gypsum-pds-gyproc-wallboard-9-5mm.pdf', category: 'lining',
  },
  { id: 'gyproc-wallboard-12.5', name: 'Gyproc WallBoard 12.5 mm', lambda: 0.19, thickness: 12.5,
    thicknesses: [12.5], source: 'British Gypsum Gyproc WallBoard 12.5 mm product data sheet, 17 October 2025; λ 0.19 W/mK.',
    url: 'https://www.british-gypsum.com/download-documents/product-data-sheet-pds/british-gypsum-pds-gyproc-wallboard-12-5mm.pdf', category: 'lining',
  },
] as const;
export const materialLambda = (id: string, thickness: number) => {
  const material = thermalMaterials.find(item => item.id === id);
  return material ? (id === 'rockwool-flexi' && thickness >= 140 ? 0.035 : material.lambda) : null;
};
