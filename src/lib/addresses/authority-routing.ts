export const AUTHORITY_CATALOGUE_VERSION = 'scotland-2026-10-09';
const councils = new Set(['Aberdeen City', 'Aberdeenshire', 'Angus', 'Argyll and Bute', 'City of Edinburgh', 'Clackmannanshire', 'Dumfries and Galloway', 'Dundee City', 'East Ayrshire', 'East Dunbartonshire', 'East Lothian', 'East Renfrewshire', 'Falkirk', 'Fife', 'Glasgow City', 'Highland', 'Inverclyde', 'Midlothian', 'Moray', 'Na h-Eileanan Siar', 'North Ayrshire', 'North Lanarkshire', 'Orkney Islands', 'Perth and Kinross', 'Renfrewshire', 'Scottish Borders', 'Shetland Islands', 'South Ayrshire', 'South Lanarkshire', 'Stirling', 'West Dunbartonshire', 'West Lothian']);
export function routeScottishAuthorities(input: { country?: string; adminDistrict?: string; nationalPark?: string | null; boundaryUncertain?: boolean }) {
  const district = input.adminDistrict?.replace(/ Council$/i, '').trim() ?? '';
  const nationalPark = input.nationalPark && !/non[- ]national park|^none$/i.test(input.nationalPark) ? input.nationalPark : null;
  const supported = input.country === 'Scotland' && councils.has(district);
  const council = supported ? `${district} Council` : null;
  return { administrativeAuthority: input.adminDistrict ?? null, planningAuthority: supported && !nationalPark && !input.boundaryUncertain ? council : null,
    buildingStandardsAuthority: supported && !input.boundaryUncertain ? council : null, nationalPark,
    requiresConfirmation: !supported || Boolean(nationalPark) || Boolean(input.boundaryUncertain), catalogueVersion: AUTHORITY_CATALOGUE_VERSION };
}
export function applicationAuthority(site: { localAuthority?: string | null; planningAuthority?: string | null; buildingStandardsAuthority?: string | null; authorityVerification?: string | null } | null | undefined, kind: string) {
  if (site?.authorityVerification === 'suggested') return null;
  const confirmed = site?.authorityVerification === 'confirmed';
  return confirmed ? (kind === 'BUILDING_WARRANT' ? site.buildingStandardsAuthority : site.planningAuthority) ?? site.localAuthority : site?.localAuthority;
}
