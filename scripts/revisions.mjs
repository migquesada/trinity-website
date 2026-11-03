// Client-requested content revisions applied on top of the Wix extraction (content/v2/products.json).
// Source: Trinity feedback on the Wix build (14 Jul 2026) and follow-up (3 Nov 2026).
export function applyProductRevisions(products) {
  const P = products;
  const dropKyc = p => {
    p.sections = p.sections
      .map(s => ({ ...s, items: s.items.filter(i => !/^KYC form/i.test(i)) }))
      .filter(s => s.kind === 'why' || s.items.length || s.paras.filter(t => !/^what is the information needed/i.test(t)).length || (s.title && !/^what is the information needed/i.test(s.title)));
  };
  // Remove the KYC Form requirement: Seafarers program + all Service Solutions
  const seafarers = P['/solutions/employee-benefits/shipowners-healthcare-program-for-seafarers-dependents'];
  if (seafarers) dropKyc(seafarers);
  for (const [k, p] of Object.entries(P)) if (k.startsWith('/solutions/service-solutions/')) dropKyc(p);

  // Poultry & Livestock: correction "In Agriculture…"
  const poultry = P['/solutions/general-insurance/poultry-and-livestock-insurance'];
  if (poultry) poultry.intro = poultry.intro.map(t => t.replace(/^n agriculture/i, 'In agriculture'));

  // D&O: "First Party Coverage" -> "Coverage"
  const dno = P['/solutions/general-insurance/directors-officers-liability-insurance'];
  if (dno) dno.sections.forEach(s => { if (/first[- ]party coverage/i.test(s.title)) s.title = 'Coverage'; });

  // HMO: align the Trinity Shield introduction with its "Full-Risk Coverage includes" list
  const hmo = P['/solutions/employee-benefits/hmo'];
  if (hmo) {
    const i = hmo.intro.findIndex(t => /5 to 249 employees/i.test(t));
    if (i >= 0) {
      const moved = hmo.intro.splice(i, 2); // "For companies with 5 to 249 employees, we offer TRINITY SHIELD." + description
      const full = hmo.sections.find(s => /full-risk coverage/i.test(s.title));
      if (full) { full.title = 'Trinity Shield'; full.paras = [...moved, 'Full-risk coverage includes:', ...full.paras]; full.parasAfterLead = moved.length + 1; }
    }
  }
  return P;
}
