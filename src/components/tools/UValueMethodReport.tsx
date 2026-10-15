import type { UValueInput, UValueResult } from '@/lib/u-value/calculator';
import { formatWorkingNumber } from '@/lib/u-value/methods';
const label = (value: string) => value.replace(/_m2k_w$/, ' (m²K/W)').replace(/_w_m2k$/, ' (W/m²K)').replace(/_w_mk$/, ' (W/mK)').replace(/_w_k$/, ' (W/K)').replace(/_m2$/, ' (m²)').replace(/_mm$/, ' (mm)').replace(/_m$/, ' (m)').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const skip = new Set(['u_value', 'u_value_2dp', 'u_value_5dp', 'warnings', 'references', 'evidence', 'method', 'element', 'name', 'components', 'edges', 'wall_formula_uses_wall_thickness_instead_of_floor']);
function workingRows(value: Record<string, unknown>, prefix = ''): { label: string; value: string }[] {
  return Object.entries(value).flatMap(([key, item]) => {
    if (skip.has(key) || item == null) return [];
    const title = `${prefix}${label(key)}`;
    if (typeof item === 'number') return [{ label: title, value: formatWorkingNumber(item) }];
    if (typeof item === 'string') return [{ label: title, value: label(item) }];
    if (typeof item === 'boolean') return [{ label: title, value: item ? 'Yes' : 'No' }];
    if (Array.isArray(item)) return item.flatMap((child, index) => typeof child === 'number' ? [{ label: `${title} ${index + 1}`, value: String(child) }] : child && typeof child === 'object' ? workingRows(child, `${title} ${index + 1} · `) : []);
    return typeof item === 'object' ? workingRows(item as Record<string, unknown>, `${title} · `) : [];
  });
}
export default function UValueMethodReport({ input, result }: { input: UValueInput; result: UValueResult }) {
  if (!input.methodData || !result.additional) return null;
  const data = input.methodData;
  const workings = workingRows(result.additional.engineResult);
  return <>
    <section><h2>Method inputs</h2><dl className="report-working">{result.additional.working.map(row => <div key={row.label}><dt>{row.label}</dt><dd className={/^[-+\d.e]+$/.test(row.value) ? 'report-number' : ''}>{row.value}</dd></div>)}</dl><p className="report-small">Assessment reference: {data.source}</p></section>
    {data.components.length > 0 && <section><h2>Opening components and edges</h2><p className="report-formula">U = (Σ Ai Ui + Σ lj Ψj) / Aopening. Component areas partition the projected opening. Installation junctions are excluded.</p><div className="report-table-wrap"><table><thead><tr><th>Component</th><th>Type</th><th>Area (m²)</th><th>U (W/m²K)</th><th>Reference</th></tr></thead><tbody>{data.components.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.kind}</td><td>{c.area_m2}</td><td>{c.u_value_w_m2k}</td><td>{c.evidence}</td></tr>)}</tbody></table></div>{data.edges.length > 0 && <div className="report-table-wrap"><table><thead><tr><th>Edge</th><th>Length (m)</th><th>Ψ (W/mK)</th><th>Reference</th></tr></thead><tbody>{data.edges.map((e, i) => <tr key={i}><td>{e.name}</td><td>{e.length_m}</td><td>{e.psi_w_mk}</td><td>{e.evidence}</td></tr>)}</tbody></table></div>}</section>}
    {data.regions.length > 0 && <section><h2>Tapered roof geometry</h2><p className="report-small">Complete, non-overlapping regions. Rectangles use opposite-edge thicknesses; triangles use all three vertex thicknesses. Thicknesses include the minimum insulation.</p><div className="report-table-wrap"><table><thead><tr><th>Region</th><th>Shape</th><th>Area (m²)</th><th>Thicknesses (mm)</th></tr></thead><tbody>{data.regions.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.shape}</td><td>{r.area_m2}</td><td>{r.thicknesses_mm.join(' / ')}</td></tr>)}</tbody></table></div></section>}
    {workings.length > 0 && <section><h2>Calculation working</h2><dl className="report-working">{workings.map((row, i) => <div key={i}><dt>{row.label}</dt><dd className={/^[-+\d.e]+$/.test(row.value) ? 'report-number' : ''}>{row.value}</dd></div>)}</dl></section>}
  </>;
}
