// Newborn Screening Malaysia — Tendering Cost Estimator
// Report generation: builds an Excel workbook and a PDF from the same
// computeAll()/computeKitAll() the app itself uses, so exported numbers
// always match the app. Both calculator types (SOP-based / kit-based) have
// their own report builders since their data shapes differ; both honor the
// site's chosen currency (site.data.currency).

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
// computed.kitCalc.calibrators/controls (from computeKitAll) already has one
// entry per level in order — its own keys (from computeKit's calLevelKeys/
// qcLevelKeys, driven by Batch Setup's calLevels/qcLevels) are what these
// report builders iterate over below, rather than a fixed count.

function currencyOf(site) {
  return (site.data && site.data.currency) || { code: 'USD', symbol: '$' };
}
function makeFmtCur(symbol) {
  return (n) => symbol + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }

const NAVY = 'FF1F4E78';
const NAVY_LIGHT = 'FF2E75B6';
const GRAY = 'FFF2F2F2';
const GREEN = 'FFD7F2DF';
const RED = 'FFFFC7CE';

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_LIGHT } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
}
function styleTitle(ws, text, cols) {
  ws.mergeCells(1, 1, 1, cols);
  const cell = ws.getCell(1, 1);
  cell.value = text;
  cell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 26;
}
function styleSubheading(ws, row) {
  row.eachCell((cell) => { cell.font = { bold: true, color: { argb: NAVY } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } }; });
}
function styleTotalRow(row) {
  row.eachCell((cell) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } }; });
}

// ============================================================
// Shared sheets (both calculator types)
// ============================================================
function addBatchSetupSheetXlsx(wb, site, computed) {
  const sBatch = wb.addWorksheet('Batch Setup');
  sBatch.columns = [{ width: 46 }, { width: 16 }];
  styleTitle(sBatch, 'Batch & Sample Design', 2);
  sBatch.addRow([]);
  styleSubheading(sBatch, sBatch.addRow(['Inputs', '']));
  const bs = site.data.batchSetup || {};
  [
    ['Number of batches', bs.batches], ['Study samples per batch', bs.samplesPerBatch],
    ['Calibrator levels per batch', bs.calLevels], ['Calibrator replicates per level', bs.calReps],
    ['QC levels per batch', bs.qcLevels], ['QC replicates per level', bs.qcReps],
    ['Blanks per batch', bs.blanksPerBatch],
  ].forEach((r) => sBatch.addRow(r));
  sBatch.addRow([]);
  styleSubheading(sBatch, sBatch.addRow(['Calculated', '']));
  const bc = computed.batchCalc;
  [
    ['Total calibrators per batch', bc.totalCalPerBatch], ['Total QCs per batch', bc.totalQCPerBatch],
    ['Total samples run per batch', bc.totalSamplesRunPerBatch], ['Total wells used per batch (96-well plate)', bc.totalWellsUsedPerBatch],
    ['Wells remaining on plate', bc.wellsRemaining], ['Total samples run — all batches', bc.totalSamplesRunAllBatches],
    ['Total study samples — all batches', bc.totalStudySamplesAllBatches],
    ['Total calibrators — all batches', bc.totalCalAllBatches], ['Total QCs — all batches', bc.totalQCAllBatches],
    ['Total blanks — all batches', bc.totalBlanksAllBatches],
  ].forEach((r) => sBatch.addRow(r));
}

function addConsumablesSheetXlsx(wb, computed, currency) {
  const sCons = wb.addWorksheet('Consumables');
  sCons.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }];
  styleTitle(sCons, 'General Lab Consumables', 5);
  sCons.addRow([]);
  const consHead = sCons.addRow(['Item', 'Unit', 'Quantity', `Cost/unit (${currency.symbol})`, `Amount (${currency.symbol})`]);
  styleHeaderRow(consHead);
  computed.consumablesCalc.items.forEach((it) => sCons.addRow([it.name, it.unit || '', it.qty, it.costPerUnit, makeFmtCur(currency.symbol)(it.totalCost)]));
  styleTotalRow(sCons.addRow(['TOTAL', '', '', '', makeFmtCur(currency.symbol)(computed.consumablesCalc.totalCost)]));
}

function addFreightTaxSheetXlsx(wb, site, computed, currency) {
  const fmtCur = makeFmtCur(currency.symbol);
  const curCol = `Amount (${currency.symbol})`;
  const sFreight = wb.addWorksheet('Freight & Tax');
  sFreight.columns = [{ width: 40 }, { width: 18 }];
  styleTitle(sFreight, 'Freight & Tax', 2);
  sFreight.addRow([]);
  const ft = computed.freightTaxCalc;
  if (ft.freightItems.length) {
    const fHead = sFreight.addRow(['Freight Item', curCol]);
    styleHeaderRow(fHead);
    ft.freightItems.forEach((f) => sFreight.addRow([f.description || '(unnamed)', fmtCur(f.amount)]));
    sFreight.addRow([]);
  }
  const freightTax = site.data.freightTax || {};
  sFreight.addRow(['Total Freight', fmtCur(ft.freightTotal)]);
  sFreight.addRow(['Tax rate', `${((freightTax.taxRate || 0) * 100).toFixed(2)}%`]);
  sFreight.addRow(['Tax applies to freight too?', freightTax.applyTaxToFreight ? 'Yes' : 'No']);
  sFreight.addRow(['Taxable base', fmtCur(ft.taxableBase)]);
  sFreight.addRow(['Tax amount', fmtCur(ft.taxAmount)]);
  styleTotalRow(sFreight.addRow(['FINAL TOTAL', fmtCur(ft.finalTotal)]));
}

function addLcGradientSheetXlsx(wb, site, computed, sheetTitle) {
  const sGrad = wb.addWorksheet('LC Method');
  sGrad.columns = [{ width: 8 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 12 }];
  styleTitle(sGrad, sheetTitle || 'LC Gradient Method', 6);
  sGrad.addRow([]);
  const gHead = sGrad.addRow(['No', 'Time (min)', 'Flow (mL/min)', '%A', '%B', 'Shape']);
  styleHeaderRow(gHead);
  (site.data.lcGradient || []).forEach((r) => sGrad.addRow([r.no, r.time, r.flow, r.a, r.b, r.shape]));
  sGrad.addRow([]);
  styleSubheading(sGrad, sGrad.addRow(['Mobile Phase Volume per Sample', '', '', '', '', '']));
  sGrad.addRow(['Mobile Phase A (Water) volume/sample (mL)', computed.gradientCalc.volA.toFixed(3)]);
  sGrad.addRow(['Mobile Phase B (ACN) volume/sample (mL)', computed.gradientCalc.volB.toFixed(3)]);
  sGrad.addRow(['Total mobile phase volume/sample (mL)', computed.gradientCalc.totalVol.toFixed(3)]);
}

function addNotesSheetXlsx(wb, site) {
  const sNotes = wb.addWorksheet('Tender Spec & Notes');
  sNotes.columns = [{ width: 100 }];
  styleTitle(sNotes, 'Tender Spec & Supporting Notes', 1);
  sNotes.addRow([]);
  sNotes.getRow(sNotes.addRow(['Tender Specification Notes:']).number).font = { bold: true };
  sNotes.addRow([(site.data.tenderSpec && site.data.tenderSpec.notes) || '(none)']);
  sNotes.addRow([]);
  sNotes.getRow(sNotes.addRow(['Supporting Information Notes:']).number).font = { bold: true };
  sNotes.addRow([(site.data.supportingInfo && site.data.supportingInfo.notes) || '(none)']);
  const tsLinks = (site.data.tenderSpec && site.data.tenderSpec.links) || [];
  const siLinks = (site.data.supportingInfo && site.data.supportingInfo.links) || [];
  if (tsLinks.length || siLinks.length) {
    sNotes.addRow([]);
    sNotes.getRow(sNotes.addRow(['Website Links:']).number).font = { bold: true };
    [...tsLinks, ...siLinks].forEach((l) => { if (l.url) sNotes.addRow([`${l.label || l.url}: ${l.url}`]); });
  }
}

// ============================================================
// SOP-based (Calculator type "chemistry") Excel report
// ============================================================
async function buildExcelReport(site, computed, calcName) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const curCol = `Amount (${currency.symbol})`;
  const titleSuffix = calcName ? ` — ${calcName} (SOP-based)` : '';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Newborn Screening Malaysia - Tender Specs Preparation';
  wb.created = new Date();

  // Summary sheet
  const sSummary = wb.addWorksheet('Summary');
  sSummary.columns = [{ width: 42 }, { width: 20 }];
  styleTitle(sSummary, `${site.name}${titleSuffix} — Tender Cost Summary`, 2);
  sSummary.addRow([]);
  sSummary.addRow(['Generated', new Date().toLocaleString()]);
  sSummary.addRow(['Currency', `${currency.code} (${currency.symbol})`]);
  sSummary.addRow([]);
  const catHeader = sSummary.addRow(['Cost Category', curCol]);
  styleHeaderRow(catHeader);
  [
    ['Reagents (IS, QC material)', computed.summary.reagentsTotal],
    ['Calibrator & QC Prep', computed.summary.calPrepTotal],
    ['Column & Guard Column', computed.summary.columnTotal],
    ['Solvents & Acid', computed.summary.solventsTotal],
    ['Consumables', computed.summary.consumablesTotal],
  ].forEach(([label, val]) => sSummary.addRow([label, fmtCur(val)]));
  styleTotalRow(sSummary.addRow(['SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal)]));
  sSummary.addRow([]);
  sSummary.addRow(['Total Freight', fmtCur(computed.freightTaxCalc.freightTotal)]);
  sSummary.addRow(['Total Tax', fmtCur(computed.freightTaxCalc.taxAmount)]);
  const finalRow = sSummary.addRow(['FINAL TOTAL', fmtCur(computed.freightTaxCalc.finalTotal)]);
  styleTotalRow(finalRow);
  finalRow.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
  sSummary.addRow([]);
  sSummary.addRow(['Total batches', fmtNum(site.data.batchSetup.batches)]);
  sSummary.addRow(['Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches)]);
  sSummary.addRow(['Total samples run, incl. calibrators/QCs/blanks (all batches)', fmtNum(computed.batchCalc.totalSamplesRunAllBatches)]);
  sSummary.addRow(['Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch)]);
  sSummary.addRow(['Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample)]);

  addBatchSetupSheetXlsx(wb, site, computed);

  addLcGradientSheetXlsx(wb, site, computed, 'LC Gradient Method');

  // Calibrator & QC Prep sheet
  const sCal = wb.addWorksheet('Calibrator & QC Prep');
  sCal.columns = [{ width: 20 }, { width: 14 }, { width: 20 }, { width: 16 }, { width: 16 }];
  styleTitle(sCal, 'Calibrator & QC Preparation', 5);
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Standard Stock Serial Dilution (per batch)', '', '', '', '']));
  const sdHead = sCal.addRow(['Level', 'Concentration', 'Volume from previous (µL)', 'Methanol added (µL)', 'Resulting volume (µL)']);
  styleHeaderRow(sdHead);
  const cp = site.data.calibratorPrep || {};
  (cp.stockDilution || []).forEach((r) => {
    const resulting = (r.vol === null || r.vol === undefined) ? '—' : (Number(r.vol) + Number(r.meoh || 0));
    sCal.addRow([r.level, r.conc, r.vol === null ? '—' : r.vol, r.meoh === null ? '—' : r.meoh, resulting]);
  });
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Standard Working Preparation (calibrators, per batch)', '', '', '', '']));
  const wpHead = sCal.addRow(['Level', 'Source', 'Volume from stock (µL)', 'IS solution (µL)', '']);
  styleHeaderRow(wpHead);
  (cp.workingPrep || []).forEach((r) => sCal.addRow([r.level, r.source, r.vol, r.isVol, '']));
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['QC Preparation (per batch)', '', '', '', '']));
  const qcHead = sCal.addRow(['QC Level', 'Volume (µL)', 'IS solution (µL)', '', '']);
  styleHeaderRow(qcHead);
  (cp.qcPrep || []).forEach((r) => sCal.addRow([r.level, r.vol, r.isVol, '', '']));
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Derived Totals & Cost', '', '', '', '']));
  const cpc = computed.calPrepCalc;
  sCal.addRow(['Total methanol for dilution (µL/batch)', fmtNum(cpc.totalMethanolPerBatchUL)]);
  sCal.addRow(['Total raw Amino Acid Standard needed (µL/batch)', fmtNum(cpc.totalStdPerBatchUL)]);
  sCal.addRow(['Amino Acid Standard vials needed (all batches)', fmtNum(cpc.stdVialsNeeded)]);
  styleTotalRow(sCal.addRow(['TOTAL (raw standard cost)', '', '', '', fmtCur(cpc.calPrepTotalCost)]));

  // Reagents sheet
  const sReagents = wb.addWorksheet('Reagents');
  sReagents.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sReagents, 'Reagents', 7);
  sReagents.addRow([]);
  const rHead = sReagents.addRow(['Component', 'Vol/use (µL)', 'Uses/batch', 'Vials needed', `Cost/vial (${currency.symbol})`, curCol, `Cost/sample (${currency.symbol})`]);
  styleHeaderRow(rHead);
  const rg = site.data.reagents;
  const rc = computed.reagentsCalc;
  sReagents.addRow(['Internal Standard (IS)', rg.is.volPerUse, rc.is.usesPerBatch, rc.is.vialsNeeded, rg.is.costPerVial, fmtCur(rc.is.totalCost), fmtCur(rc.is.costPerSample)]);
  sReagents.addRow(['QC material', rg.qc.volPerUse, rc.qc.usesPerBatch, rc.qc.vialsNeeded, rg.qc.costPerVial, fmtCur(rc.qc.totalCost), fmtCur(rc.qc.costPerSample)]);
  styleTotalRow(sReagents.addRow(['TOTAL', '', '', '', '', fmtCur(rc.totalCost), '']));

  // Column sheet
  const sColumn = wb.addWorksheet('Column');
  sColumn.columns = [{ width: 40 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }];
  styleTitle(sColumn, 'Analytical Column & Guard Column', 5);
  sColumn.addRow([]);
  const cHead = sColumn.addRow(['Component', `Cost/unit (${currency.symbol})`, 'Lifetime (samples)', 'Units needed', curCol]);
  styleHeaderRow(cHead);
  const col = site.data.column;
  const cc = computed.columnCalc;
  sColumn.addRow([col.analytical.label || 'Analytical column', col.analytical.cost, col.analytical.lifetime, cc.analytical.unitsNeeded, fmtCur(cc.analytical.totalCost)]);
  sColumn.addRow([col.guard.label || 'Guard column', col.guard.cost, col.guard.lifetime, cc.guard.unitsNeeded, fmtCur(cc.guard.totalCost)]);
  styleTotalRow(sColumn.addRow(['TOTAL', '', '', '', fmtCur(cc.totalCost)]));

  // Solvents & Acid sheet
  const sSolv = wb.addWorksheet('Solvents & Acid');
  sSolv.columns = [{ width: 34 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sSolv, 'Solvents & Acid', 5);
  sSolv.addRow([]);
  const svHead = sSolv.addRow(['Component', 'Vol/sample or /batch', 'Bottles needed', `Cost/bottle (${currency.symbol})`, curCol]);
  styleHeaderRow(svHead);
  const sv = site.data.solvents;
  const svc = computed.solventsCalc;
  sSolv.addRow(['Water (Mobile Phase A)', svc.water.volPerSample.toFixed(3) + ' mL/sample', svc.water.bottlesNeeded, sv.water.costPerBottle, fmtCur(svc.water.totalCost)]);
  sSolv.addRow(['Acetonitrile (Mobile Phase B)', svc.acn.volPerSample.toFixed(3) + ' mL/sample', svc.acn.bottlesNeeded, sv.acn.costPerBottle, fmtCur(svc.acn.totalCost)]);
  sSolv.addRow(['PFHeptA/TDHFA', svc.pfhepta.volPerSample.toFixed(4) + ' mL/sample', svc.pfhepta.bottlesNeeded, sv.pfhepta.costPerBottle, fmtCur(svc.pfhepta.totalCost)]);
  sSolv.addRow(['Calibrator dilution methanol', svc.calibratorMethanol.volPerBatchML.toFixed(3) + ' mL/batch', svc.calibratorMethanol.bottlesNeeded, sv.calibratorMethanol.costPerBottle, fmtCur(svc.calibratorMethanol.totalCost)]);
  svc.generalSolvents.forEach((g) => sSolv.addRow([g.name, g.qty + ' units (project total)', '', g.costPerUnit, fmtCur(g.totalCost)]));
  styleTotalRow(sSolv.addRow(['TOTAL', '', '', '', fmtCur(svc.totalCost)]));

  addConsumablesSheetXlsx(wb, computed, currency);
  addFreightTaxSheetXlsx(wb, site, computed, currency);
  addNotesSheetXlsx(wb, site);

  return wb.xlsx.writeBuffer();
}

// ============================================================
// Kit-based (Calculator type "kit") Excel report
// ============================================================
async function buildKitExcelReport(site, computed, calcName) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const curCol = `Amount (${currency.symbol})`;
  const titleSuffix = calcName ? ` — ${calcName} (Kit-based)` : ' — Kit-based Calculator';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Newborn Screening Malaysia - Tender Specs Preparation';
  wb.created = new Date();

  // Summary sheet
  const sSummary = wb.addWorksheet('Summary');
  sSummary.columns = [{ width: 42 }, { width: 20 }];
  styleTitle(sSummary, `${site.name}${titleSuffix} — Tender Cost Summary`, 2);
  sSummary.addRow([]);
  sSummary.addRow(['Generated', new Date().toLocaleString()]);
  sSummary.addRow(['Currency', `${currency.code} (${currency.symbol})`]);
  sSummary.addRow([]);
  const catHeader = sSummary.addRow(['Cost Category', curCol]);
  styleHeaderRow(catHeader);
  [
    ['Complete Kit(s)', computed.summary.kitTotal],
    ['Extra LC Packs', computed.summary.lcExtraTotal],
    ['Extra IS, Cal & Control', computed.summary.reagentsExtraTotal],
    ['Additional Items', computed.summary.additionalItemsTotal],
    ['Consumables', computed.summary.consumablesTotal],
  ].forEach(([label, val]) => sSummary.addRow([label, fmtCur(val)]));
  styleTotalRow(sSummary.addRow(['SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal)]));
  sSummary.addRow([]);
  sSummary.addRow(['Total Freight', fmtCur(computed.freightTaxCalc.freightTotal)]);
  sSummary.addRow(['Total Tax', fmtCur(computed.freightTaxCalc.taxAmount)]);
  const finalRow = sSummary.addRow(['FINAL TOTAL', fmtCur(computed.freightTaxCalc.finalTotal)]);
  styleTotalRow(finalRow);
  finalRow.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
  sSummary.addRow([]);
  sSummary.addRow(['Total batches', fmtNum(site.data.batchSetup.batches)]);
  sSummary.addRow(['Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches)]);
  sSummary.addRow(['Total samples run, incl. calibrators/QCs/blanks (all batches)', fmtNum(computed.batchCalc.totalSamplesRunAllBatches)]);
  sSummary.addRow(['Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch)]);
  sSummary.addRow(['Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample)]);
  sSummary.addRow([]);
  styleSubheading(sSummary, sSummary.addRow(['Is the kit enough?', '']));
  sSummary.addRow(['Assays required (all batches)', fmtNum(computed.summary.assaysRequired)]);
  sSummary.addRow(['Assays covered by kit(s) purchased', fmtNum(computed.summary.assaysCovered)]);
  const assaysRow = sSummary.addRow(['Assay surplus / shortfall', fmtNum(computed.summary.assaysSurplus)]);
  assaysRow.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: computed.summary.assaysSufficient ? GREEN : RED } }; });
  const lcRow = sSummary.addRow(['LC solvents (MPA/MPB/Wash/Precipitant)', computed.summary.lcAllSufficient ? 'Sufficient' : 'Shortfall — see Kit & Components sheet']);
  lcRow.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: computed.summary.lcAllSufficient ? GREEN : RED } }; });
  const rgRow = sSummary.addRow(['Internal Standard, Calibrators & Controls', computed.summary.reagentsAllSufficient ? 'Sufficient' : 'Shortfall — see Kit & Components sheet']);
  rgRow.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: computed.summary.reagentsAllSufficient ? GREEN : RED } }; });

  addBatchSetupSheetXlsx(wb, site, computed);
  addLcGradientSheetXlsx(wb, site, computed, 'LC Method');

  // Kit & Components sheet
  const sKit = wb.addWorksheet('Kit & Components');
  sKit.columns = [{ width: 30 }, { width: 14 }, { width: 16 }, { width: 10 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 14 }, { width: 14 }];
  styleTitle(sKit, 'Kit & Components', 12);
  sKit.addRow([]);
  const kit = site.data.kit || {};
  const ck = kit.completeKits || {};
  const kc = computed.kitCalc;
  styleSubheading(sKit, sKit.addRow(['Complete Kit(s)', '', '', '', '', '', '', '', '', '', '', '']));
  sKit.addRow(['Complete kits purchased (qty)', ck.qty || 0]);
  sKit.addRow([`Cost per kit (${currency.symbol})`, ck.costPerKit || 0]);
  sKit.addRow(['Assays covered per kit', ck.assaysPerKit || 200]);
  sKit.addRow(['Complete kit(s) cost', '', '', '', '', '', '', '', '', '', '', fmtCur(kc.kitCost)]);
  sKit.addRow(['Assays covered by kit(s)', fmtNum(kc.assaysCovered)]);
  sKit.addRow([]);
  styleSubheading(sKit, sKit.addRow(['LC Solvent Sufficiency', '', '', '', '', '', '', '', '', '', '', '']));
  const lcHead = sKit.addRow(['Component', 'Vol/sample (mL)', 'Total required (mL)', 'Packs/kit', 'Packs from kit(s)', 'Extra packs bought', 'Pack size (mL)', 'Total available (mL)', 'Surplus/shortfall (mL)', 'Status', `Cost/extra pack (${currency.symbol})`, curCol]);
  styleHeaderRow(lcHead);
  [
    ['Mobile Phase A', kc.mobilePhaseA],
    ['Mobile Phase B', kc.mobilePhaseB],
    ['Autosampler Washing Solution', kc.washSolution],
    ['Precipitant P', kc.precipitantP],
  ].forEach(([label, line]) => {
    const r = sKit.addRow([
      label, line.volPerSampleML, line.totalRequiredML.toFixed(2), line.packsPerKit, line.packsFromKits,
      line.extraPacksPurchased, line.packSizeML, line.totalAvailableML.toFixed(2), line.surplusML.toFixed(2),
      line.sufficient ? 'Sufficient' : 'Shortfall', line.extraPacksPurchased ? (line.extraCost / (line.extraPacksPurchased || 1)) : 0, fmtCur(line.extraCost),
    ]);
    r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: line.sufficient ? GREEN : RED } };
    if (line.surplusML < 0) r.getCell(9).font = { bold: true, color: { argb: 'FF9C0006' } };
  });
  styleTotalRow(sKit.addRow(['EXTRA PACKS TOTAL COST', '', '', '', '', '', '', '', '', '', '', fmtCur(kc.lcExtraCost)]));
  sKit.addRow([]);
  styleSubheading(sKit, sKit.addRow(['IS, Calibrator & Control Usage', '', '', '', '', '', '', '', '', '', '', '']));
  const rgHead = sKit.addRow(['Component', 'Vol/use (µL)', 'Total required (µL)', 'Packs/kit', 'Packs from kit(s)', 'Extra packs bought', 'Pack size (µL)', 'Total available (µL)', 'Surplus/shortfall (µL)', 'Status', `Cost/extra pack (${currency.symbol})`, curCol]);
  styleHeaderRow(rgHead);
  const addReagentLineRow = (label, line) => {
    const r = sKit.addRow([
      label, line.volPerUseUL, line.totalRequiredUL.toFixed(2), line.packsPerKit, line.packsFromKits,
      line.extraPacksPurchased, line.packSizeUL, line.totalAvailableUL.toFixed(2), line.surplusUL.toFixed(2),
      line.sufficient ? 'Sufficient' : 'Shortfall', line.extraPacksPurchased ? (line.extraCost / (line.extraPacksPurchased || 1)) : 0, fmtCur(line.extraCost),
    ]);
    r.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: line.sufficient ? GREEN : RED } };
    if (line.surplusUL < 0) r.getCell(9).font = { bold: true, color: { argb: 'FF9C0006' } };
  };
  addReagentLineRow('Internal Standard (IS)', kc.is);
  const calKeys = Object.keys(kc.calibrators);
  styleSubheading(sKit, sKit.addRow([`Calibrators (${calKeys.length} level${calKeys.length === 1 ? '' : 's'})`, '', '', '', '', '', '', '', '', '', '', '']));
  calKeys.forEach((key, i) => addReagentLineRow(`Calibrator L${i}`, kc.calibrators[key]));
  styleSubheading(sKit, sKit.addRow(['Controls / QC (one bundled set, all levels)', '', '', '', '', '', '', '', '', '', '', '']));
  addReagentLineRow('Control Set (all QC levels)', kc.controlSet);
  styleTotalRow(sKit.addRow(['EXTRA PACKS TOTAL COST', '', '', '', '', '', '', '', '', '', '', fmtCur(kc.reagentsExtraCost)]));
  sKit.addRow([]);
  styleSubheading(sKit, sKit.addRow(['Additional / Separately Purchased Items', '', '', '', '', '', '', '', '', '', '', '']));
  const itemsHead = sKit.addRow(['Code', 'Item', 'Pack/unit size', 'Quantity', `Cost/unit (${currency.symbol})`, curCol]);
  styleHeaderRow(itemsHead);
  kc.additionalItems.forEach((it) => sKit.addRow([it.code || '', it.name || '', it.unit || '', it.qty, it.costPerUnit, fmtCur(it.totalCost)]));
  styleTotalRow(sKit.addRow(['TOTAL', '', '', '', '', fmtCur(kc.additionalItemsTotal)]));

  addConsumablesSheetXlsx(wb, computed, currency);
  addFreightTaxSheetXlsx(wb, site, computed, currency);
  addNotesSheetXlsx(wb, site);

  return wb.xlsx.writeBuffer();
}

// ============================================================
// Shared PDF helpers
// ============================================================
function makePdfHelpers(doc) {
  return {
    sectionTitle(text) {
      doc.moveDown(0.5);
      doc.fillColor('#1f4e78').fontSize(13).text(text);
      doc.moveTo(doc.x, doc.y + 2).lineTo(545, doc.y + 2).strokeColor('#1f4e78').stroke();
      doc.moveDown(0.5);
      doc.fillColor('#000').fontSize(10);
    },
    row(label, value, opts = {}) {
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 55, y, { continued: false, width: 300 });
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(opts.color || '#000').fontSize(10).text(value, 360, y, { width: 185, align: 'right' });
      doc.fillColor('#000');
      doc.moveDown(0.3);
    },
    ensureSpace(minHeight) {
      if (doc.y + minHeight > 740) doc.addPage();
    },
  };
}
function addHeaderPdf(doc, site, currency, titleSuffix) {
  doc.fillColor('#1f4e78').fontSize(20).text('Newborn Screening Malaysia', { align: 'left' });
  doc.fillColor('#555').fontSize(11).text(`Tender Cost Estimate Report${titleSuffix}`, { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor('#000').fontSize(14).text(site.name);
  doc.fillColor('#888').fontSize(9).text(`Generated ${new Date().toLocaleString()} — Currency: ${currency.code} (${currency.symbol})`);
  doc.moveDown(1);
}
function addBatchSetupPdf(doc, h, site, computed) {
  const bs = site.data.batchSetup || {};
  h.sectionTitle('Batch Setup');
  h.row('Number of batches', fmtNum(bs.batches));
  h.row('Study samples per batch', fmtNum(bs.samplesPerBatch));
  h.row('Calibrator levels x replicates', `${bs.calLevels} × ${bs.calReps}`);
  h.row('QC levels x replicates', `${bs.qcLevels} × ${bs.qcReps}`);
  h.row('Blanks per batch', fmtNum(bs.blanksPerBatch));
  h.row('Total wells used per batch (96-well plate)', fmtNum(computed.batchCalc.totalWellsUsedPerBatch));
  h.row('Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches));
  h.row('Total samples run, incl. cal/QC/blanks (all batches)', fmtNum(computed.batchCalc.totalSamplesRunAllBatches));
}
function addFreightTaxPdf(doc, h, site, computed, fmtCur) {
  h.ensureSpace(140);
  h.sectionTitle('Freight & Tax');
  h.row('Total Freight', fmtCur(computed.freightTaxCalc.freightTotal));
  h.row('Tax rate', `${((site.data.freightTax.taxRate || 0) * 100).toFixed(2)}%`);
  h.row('Tax amount', fmtCur(computed.freightTaxCalc.taxAmount));
  doc.moveDown(0.3);
  h.ensureSpace(50);
  doc.rect(50, doc.y, 495, 34).fillAndStroke('#1f4e78', '#1f4e78');
  doc.fillColor('#fff').fontSize(13).text('FINAL TOTAL', 60, doc.y - 26);
  doc.fontSize(13).text(fmtCur(computed.freightTaxCalc.finalTotal), 360, doc.y - 15, { width: 175, align: 'right' });
  doc.moveDown(1.5);
  doc.fillColor('#000').fontSize(10);
  h.row('Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch));
  h.row('Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample));
}
function addNotesPdf(doc, h, site) {
  const tsNotes = (site.data.tenderSpec && site.data.tenderSpec.notes) || '';
  const siNotes = (site.data.supportingInfo && site.data.supportingInfo.notes) || '';
  if (tsNotes || siNotes) {
    h.ensureSpace(100);
    h.sectionTitle('Notes');
    if (tsNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Tender Specification:'); doc.font('Helvetica').fontSize(9).text(tsNotes); doc.moveDown(0.5); }
    if (siNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Supporting Information:'); doc.font('Helvetica').fontSize(9).text(siNotes); }
  }
}
function addFooterPdf(doc) {
  const pageRange = doc.bufferedPageRange();
  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#999').fontSize(8).text(
      `Instrument purchase/depreciation cost is excluded, per scope.  —  Page ${i + 1} of ${pageRange.count}`,
      50, 800, { width: 495, align: 'center' }
    );
  }
}

// ============================================================
// SOP-based (Calculator type "chemistry") PDF report
// ============================================================
function buildPdfReport(site, computed, res, calcName) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  doc.pipe(res);
  const h = makePdfHelpers(doc);

  addHeaderPdf(doc, site, currency, calcName ? ` — ${calcName} (SOP-based)` : '');
  addBatchSetupPdf(doc, h, site, computed);

  h.ensureSpace(120);
  h.sectionTitle('LC Gradient & Mobile Phase');
  h.row('Gradient length', `${(site.data.lcGradient || []).length} timepoints`);
  h.row('Mobile Phase A (Water) per sample', computed.gradientCalc.volA.toFixed(3) + ' mL');
  h.row('Mobile Phase B (ACN) per sample', computed.gradientCalc.volB.toFixed(3) + ' mL');
  h.row('Total mobile phase per sample', computed.gradientCalc.totalVol.toFixed(3) + ' mL');

  h.ensureSpace(100);
  h.sectionTitle('Calibrator & QC Prep');
  h.row('Raw Amino Acid Standard needed', fmtNum(computed.calPrepCalc.totalStdPerBatchUL) + ' µL/batch');
  h.row('Methanol for serial dilution', fmtNum(computed.calPrepCalc.totalMethanolPerBatchUL) + ' µL/batch');
  h.row('Standard vials needed (all batches)', fmtNum(computed.calPrepCalc.stdVialsNeeded));
  h.row('Raw Standard cost', fmtCur(computed.calPrepCalc.calPrepTotalCost));

  h.ensureSpace(160);
  h.sectionTitle('Cost Breakdown');
  h.row('Reagents (IS, QC material)', fmtCur(computed.summary.reagentsTotal));
  h.row('Calibrator & QC Prep', fmtCur(computed.summary.calPrepTotal));
  h.row('Column & Guard Column', fmtCur(computed.summary.columnTotal));
  h.row('Solvents & Acid', fmtCur(computed.summary.solventsTotal));
  h.row('Consumables', fmtCur(computed.summary.consumablesTotal));
  doc.moveDown(0.2);
  h.row('SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal), { bold: true });

  addFreightTaxPdf(doc, h, site, computed, fmtCur);
  addNotesPdf(doc, h, site);
  addFooterPdf(doc);
  doc.end();
}

// ============================================================
// Kit-based (Calculator type "kit") PDF report
// ============================================================
function buildKitPdfReport(site, computed, res, calcName) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  doc.pipe(res);
  const h = makePdfHelpers(doc);

  addHeaderPdf(doc, site, currency, calcName ? ` — ${calcName} (Kit-based)` : ' — Kit-based Calculator');
  addBatchSetupPdf(doc, h, site, computed);

  h.ensureSpace(100);
  h.sectionTitle('LC Method');
  h.row('Gradient length', `${(site.data.lcGradient || []).length} timepoints`);
  h.row('Mobile Phase A (Water) per sample', computed.gradientCalc.volA.toFixed(3) + ' mL');
  h.row('Mobile Phase B (ACN) per sample', computed.gradientCalc.volB.toFixed(3) + ' mL');
  h.row('Total mobile phase per sample', computed.gradientCalc.totalVol.toFixed(3) + ' mL');

  const kc = computed.kitCalc;
  h.ensureSpace(140);
  h.sectionTitle('Complete Kit(s)');
  h.row('Complete kits purchased', fmtNum(kc.kitsQty));
  h.row('Cost per kit', fmtCur(kc.costPerKit));
  h.row('Complete kit(s) cost', fmtCur(kc.kitCost));
  h.row('Assays covered by kit(s)', fmtNum(kc.assaysCovered));

  h.ensureSpace(180);
  h.sectionTitle('LC Solvent Sufficiency');
  [
    ['Mobile Phase A', kc.mobilePhaseA],
    ['Mobile Phase B', kc.mobilePhaseB],
    ['Autosampler Washing Solution', kc.washSolution],
    ['Precipitant P', kc.precipitantP],
  ].forEach(([label, line]) => {
    h.row(`${label}: packs/kit × kits = packs from kit(s)`, `${fmtNum(line.packsPerKit)} × ${fmtNum(kc.kitsQty)} = ${fmtNum(line.packsFromKits)}`);
    h.row(`${label}: required (mL) / available (mL)`, `${line.totalRequiredML.toFixed(1)} / ${line.totalAvailableML.toFixed(1)}`);
    h.row(`${label} status`, line.sufficient ? 'Sufficient' : `Shortfall (${line.surplusML.toFixed(1)} mL)`, { bold: !line.sufficient, color: line.sufficient ? '#14632f' : '#9c0006' });
  });
  h.row('Extra LC packs cost', fmtCur(kc.lcExtraCost));

  h.ensureSpace(60);
  h.sectionTitle('IS, Calibrator & Control Usage');
  const addReagentLinePdf = (label, line) => {
    h.ensureSpace(60);
    h.row(`${label}: packs/kit × kits = packs from kit(s)`, `${fmtNum(line.packsPerKit)} × ${fmtNum(kc.kitsQty)} = ${fmtNum(line.packsFromKits)}`);
    h.row(`${label}: required (µL) / available (µL)`, `${line.totalRequiredUL.toFixed(1)} / ${line.totalAvailableUL.toFixed(1)}`);
    h.row(`${label} status`, line.sufficient ? 'Sufficient' : `Shortfall (${line.surplusUL.toFixed(1)} µL)`, { bold: !line.sufficient, color: line.sufficient ? '#14632f' : '#9c0006' });
  };
  addReagentLinePdf('Internal Standard (IS)', kc.is);
  Object.keys(kc.calibrators).forEach((key, i) => addReagentLinePdf(`Calibrator L${i}`, kc.calibrators[key]));
  addReagentLinePdf('Control Set (all QC levels, one bundled pack)', kc.controlSet);
  h.ensureSpace(30);
  h.row('Extra IS, Cal & Control cost', fmtCur(kc.reagentsExtraCost));

  h.ensureSpace(100);
  h.sectionTitle('Additional / Separately Purchased Items');
  kc.additionalItems.forEach((it) => {
    if (!it.name && !it.qty) return;
    h.row(`${it.name || '(unnamed)'} × ${it.qty}`, fmtCur(it.totalCost));
  });
  h.row('Additional items subtotal', fmtCur(kc.additionalItemsTotal), { bold: true });

  h.ensureSpace(160);
  h.sectionTitle('Cost Breakdown');
  h.row('Complete Kit(s)', fmtCur(computed.summary.kitTotal));
  h.row('Extra LC Packs', fmtCur(computed.summary.lcExtraTotal));
  h.row('Extra IS, Cal & Control', fmtCur(computed.summary.reagentsExtraTotal));
  h.row('Additional Items', fmtCur(computed.summary.additionalItemsTotal));
  h.row('Consumables', fmtCur(computed.summary.consumablesTotal));
  doc.moveDown(0.2);
  h.row('SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal), { bold: true });

  h.ensureSpace(120);
  h.sectionTitle('Is the Kit Enough?');
  h.row('Assays required (all batches)', fmtNum(computed.summary.assaysRequired));
  h.row('Assays covered by kit(s)', fmtNum(computed.summary.assaysCovered));
  h.row('Surplus / shortfall', fmtNum(computed.summary.assaysSurplus), { bold: true, color: computed.summary.assaysSufficient ? '#14632f' : '#9c0006' });
  h.row('LC solvents overall', computed.summary.lcAllSufficient ? 'Sufficient' : 'Shortfall', { bold: true, color: computed.summary.lcAllSufficient ? '#14632f' : '#9c0006' });
  h.row('IS, Calibrators & Controls overall', computed.summary.reagentsAllSufficient ? 'Sufficient' : 'Shortfall', { bold: true, color: computed.summary.reagentsAllSufficient ? '#14632f' : '#9c0006' });

  addFreightTaxPdf(doc, h, site, computed, fmtCur);
  addNotesPdf(doc, h, site);
  addFooterPdf(doc);
  doc.end();
}

module.exports = { buildExcelReport, buildPdfReport, buildKitExcelReport, buildKitPdfReport };
