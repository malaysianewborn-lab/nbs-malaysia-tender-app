// Newborn Screening Malaysia — Tendering Cost Estimator
// Report generation: builds an Excel workbook and a PDF, both from the same
// computeAll() the app itself uses, so exported numbers always match the app.
// Both honor the site's chosen currency (site.data.currency).

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

function currencyOf(site) {
  return (site.data && site.data.currency) || { code: 'USD', symbol: '$' };
}
function makeFmtCur(symbol) {
  return (n) => symbol + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }

async function buildExcelReport(site, computed) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const curCol = `Amount (${currency.symbol})`;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Newborn Screening Malaysia - Tender Specs Preparation';
  wb.created = new Date();

  const NAVY = 'FF1F4E78';
  const NAVY_LIGHT = 'FF2E75B6';
  const GRAY = 'FFF2F2F2';

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
  // Summary sheet
  // ============================================================
  const sSummary = wb.addWorksheet('Summary');
  sSummary.columns = [{ width: 42 }, { width: 20 }];
  styleTitle(sSummary, `${site.name} \u2014 Tender Cost Summary`, 2);
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

  // ============================================================
  // Batch Setup sheet
  // ============================================================
  const sBatch = wb.addWorksheet('Batch Setup');
  sBatch.columns = [{ width: 46 }, { width: 16 }];
  styleTitle(sBatch, 'Batch & Sample Design', 2);
  sBatch.addRow([]);
  styleSubheading(sBatch, sBatch.addRow(['Inputs', '']));
  const bs = site.data.batchSetup;
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
    ['Wells remaining on plate', bc.wellsRemaining], ['Total samples run \u2014 all batches', bc.totalSamplesRunAllBatches],
    ['Total study samples \u2014 all batches', bc.totalStudySamplesAllBatches],
    ['Total calibrators \u2014 all batches', bc.totalCalAllBatches], ['Total QCs \u2014 all batches', bc.totalQCAllBatches],
    ['Total blanks \u2014 all batches', bc.totalBlanksAllBatches],
  ].forEach((r) => sBatch.addRow(r));

  // ============================================================
  // LC Gradient sheet (new — full method table + segment volumes)
  // ============================================================
  const sGrad = wb.addWorksheet('LC Gradient');
  sGrad.columns = [{ width: 8 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 10 }, { width: 12 }];
  styleTitle(sGrad, 'LC Gradient Method', 6);
  sGrad.addRow([]);
  const gHead = sGrad.addRow(['No', 'Time (min)', 'Flow (mL/min)', '%A', '%B', 'Shape']);
  styleHeaderRow(gHead);
  (site.data.lcGradient || []).forEach((r) => sGrad.addRow([r.no, r.time, r.flow, r.a, r.b, r.shape]));
  sGrad.addRow([]);
  styleSubheading(sGrad, sGrad.addRow(['Mobile Phase Volume per Sample', '', '', '', '', '']));
  sGrad.addRow(['Mobile Phase A (Water) volume/sample (mL)', computed.gradientCalc.volA.toFixed(3)]);
  sGrad.addRow(['Mobile Phase B (ACN) volume/sample (mL)', computed.gradientCalc.volB.toFixed(3)]);
  sGrad.addRow(['Total mobile phase volume/sample (mL)', computed.gradientCalc.totalVol.toFixed(3)]);

  // ============================================================
  // Calibrator & QC Prep sheet (expanded — full recipe tables)
  // ============================================================
  const sCal = wb.addWorksheet('Calibrator & QC Prep');
  sCal.columns = [{ width: 20 }, { width: 14 }, { width: 20 }, { width: 16 }, { width: 16 }];
  styleTitle(sCal, 'Calibrator & QC Preparation', 5);
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Standard Stock Serial Dilution (per batch)', '', '', '', '']));
  const sdHead = sCal.addRow(['Level', 'Concentration', 'Volume from previous (\u00b5L)', 'Methanol added (\u00b5L)', 'Resulting volume (\u00b5L)']);
  styleHeaderRow(sdHead);
  const cp = site.data.calibratorPrep || {};
  (cp.stockDilution || []).forEach((r) => {
    const resulting = (r.vol === null || r.vol === undefined) ? '\u2014' : (Number(r.vol) + Number(r.meoh || 0));
    sCal.addRow([r.level, r.conc, r.vol === null ? '\u2014' : r.vol, r.meoh === null ? '\u2014' : r.meoh, resulting]);
  });
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Standard Working Preparation (calibrators, per batch)', '', '', '', '']));
  const wpHead = sCal.addRow(['Level', 'Source', 'Volume from stock (\u00b5L)', 'IS solution (\u00b5L)', '']);
  styleHeaderRow(wpHead);
  (cp.workingPrep || []).forEach((r) => sCal.addRow([r.level, r.source, r.vol, r.isVol, '']));
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['QC Preparation (per batch)', '', '', '', '']));
  const qcHead = sCal.addRow(['QC Level', 'Volume (\u00b5L)', 'IS solution (\u00b5L)', '', '']);
  styleHeaderRow(qcHead);
  (cp.qcPrep || []).forEach((r) => sCal.addRow([r.level, r.vol, r.isVol, '', '']));
  sCal.addRow([]);
  styleSubheading(sCal, sCal.addRow(['Derived Totals & Cost', '', '', '', '']));
  const cpc = computed.calPrepCalc;
  sCal.addRow(['Total methanol for dilution (\u00b5L/batch)', fmtNum(cpc.totalMethanolPerBatchUL)]);
  sCal.addRow(['Total raw Amino Acid Standard needed (\u00b5L/batch)', fmtNum(cpc.totalStdPerBatchUL)]);
  sCal.addRow(['Amino Acid Standard vials needed (all batches)', fmtNum(cpc.stdVialsNeeded)]);
  styleTotalRow(sCal.addRow(['TOTAL (raw standard cost)', '', '', '', fmtCur(cpc.calPrepTotalCost)]));

  // ============================================================
  // Reagents sheet
  // ============================================================
  const sReagents = wb.addWorksheet('Reagents');
  sReagents.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sReagents, 'Reagents', 7);
  sReagents.addRow([]);
  const rHead = sReagents.addRow(['Component', 'Vol/use (\u00b5L)', 'Uses/batch', 'Vials needed', `Cost/vial (${currency.symbol})`, curCol, `Cost/sample (${currency.symbol})`]);
  styleHeaderRow(rHead);
  const rg = site.data.reagents;
  const rc = computed.reagentsCalc;
  sReagents.addRow(['Internal Standard (IS)', rg.is.volPerUse, rc.is.usesPerBatch, rc.is.vialsNeeded, rg.is.costPerVial, fmtCur(rc.is.totalCost), fmtCur(rc.is.costPerSample)]);
  sReagents.addRow(['QC material', rg.qc.volPerUse, rc.qc.usesPerBatch, rc.qc.vialsNeeded, rg.qc.costPerVial, fmtCur(rc.qc.totalCost), fmtCur(rc.qc.costPerSample)]);
  styleTotalRow(sReagents.addRow(['TOTAL', '', '', '', '', fmtCur(rc.totalCost), '']));

  // ============================================================
  // Column sheet
  // ============================================================
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

  // ============================================================
  // Solvents & Acid sheet
  // ============================================================
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

  // ============================================================
  // Consumables sheet
  // ============================================================
  const sCons = wb.addWorksheet('Consumables');
  sCons.columns = [{ width: 34 }, { width: 14 }, { width: 18 }, { width: 14 }];
  styleTitle(sCons, 'General Lab Consumables', 4);
  sCons.addRow([]);
  const consHead = sCons.addRow(['Item', 'Quantity', `Cost/unit (${currency.symbol})`, curCol]);
  styleHeaderRow(consHead);
  computed.consumablesCalc.items.forEach((it) => sCons.addRow([it.name, it.qty, it.costPerUnit, fmtCur(it.totalCost)]));
  styleTotalRow(sCons.addRow(['TOTAL', '', '', fmtCur(computed.consumablesCalc.totalCost)]));

  // ============================================================
  // Freight & Tax sheet
  // ============================================================
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
  sFreight.addRow(['Total Freight', fmtCur(ft.freightTotal)]);
  sFreight.addRow(['Tax rate', `${((site.data.freightTax.taxRate || 0) * 100).toFixed(2)}%`]);
  sFreight.addRow(['Tax applies to freight too?', site.data.freightTax.applyTaxToFreight ? 'Yes' : 'No']);
  sFreight.addRow(['Taxable base', fmtCur(ft.taxableBase)]);
  sFreight.addRow(['Tax amount', fmtCur(ft.taxAmount)]);
  styleTotalRow(sFreight.addRow(['FINAL TOTAL', fmtCur(ft.finalTotal)]));

  // ============================================================
  // Tender Spec & Notes sheet
  // ============================================================
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

  return wb.xlsx.writeBuffer();
}

function buildPdfReport(site, computed, res) {
  const currency = currencyOf(site);
  const fmtCur = makeFmtCur(currency.symbol);
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  doc.pipe(res);

  const navy = '#1f4e78';
  doc.fillColor(navy).fontSize(20).text('Newborn Screening Malaysia', { align: 'left' });
  doc.fillColor('#555').fontSize(11).text('Tender Cost Estimate Report', { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor('#000').fontSize(14).text(site.name);
  doc.fillColor('#888').fontSize(9).text(`Generated ${new Date().toLocaleString()} \u2014 Currency: ${currency.code} (${currency.symbol})`);
  doc.moveDown(1);

  function sectionTitle(text) {
    doc.moveDown(0.5);
    doc.fillColor(navy).fontSize(13).text(text);
    doc.moveTo(doc.x, doc.y + 2).lineTo(545, doc.y + 2).strokeColor(navy).stroke();
    doc.moveDown(0.5);
    doc.fillColor('#000').fontSize(10);
  }
  function row(label, value, opts = {}) {
    const y = doc.y;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 55, y, { continued: false, width: 300 });
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(value, 360, y, { width: 185, align: 'right' });
    doc.moveDown(0.3);
  }
  function ensureSpace(minHeight) {
    if (doc.y + minHeight > 740) doc.addPage();
  }

  const bs = site.data.batchSetup;
  sectionTitle('Batch Setup');
  row('Number of batches', fmtNum(bs.batches));
  row('Study samples per batch', fmtNum(bs.samplesPerBatch));
  row('Calibrator levels x replicates', `${bs.calLevels} \u00d7 ${bs.calReps}`);
  row('QC levels x replicates', `${bs.qcLevels} \u00d7 ${bs.qcReps}`);
  row('Blanks per batch', fmtNum(bs.blanksPerBatch));
  row('Total wells used per batch (96-well plate)', fmtNum(computed.batchCalc.totalWellsUsedPerBatch));
  row('Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches));
  row('Total samples run, incl. cal/QC/blanks (all batches)', fmtNum(computed.batchCalc.totalSamplesRunAllBatches));

  ensureSpace(120);
  sectionTitle('LC Gradient & Mobile Phase');
  row('Gradient length', `${(site.data.lcGradient || []).length} timepoints`);
  row('Mobile Phase A (Water) per sample', computed.gradientCalc.volA.toFixed(3) + ' mL');
  row('Mobile Phase B (ACN) per sample', computed.gradientCalc.volB.toFixed(3) + ' mL');
  row('Total mobile phase per sample', computed.gradientCalc.totalVol.toFixed(3) + ' mL');

  ensureSpace(100);
  sectionTitle('Calibrator & QC Prep');
  row('Raw Amino Acid Standard needed', fmtNum(computed.calPrepCalc.totalStdPerBatchUL) + ' \u00b5L/batch');
  row('Methanol for serial dilution', fmtNum(computed.calPrepCalc.totalMethanolPerBatchUL) + ' \u00b5L/batch');
  row('Standard vials needed (all batches)', fmtNum(computed.calPrepCalc.stdVialsNeeded));
  row('Raw Standard cost', fmtCur(computed.calPrepCalc.calPrepTotalCost));

  ensureSpace(160);
  sectionTitle('Cost Breakdown');
  row('Reagents (IS, QC material)', fmtCur(computed.summary.reagentsTotal));
  row('Calibrator & QC Prep', fmtCur(computed.summary.calPrepTotal));
  row('Column & Guard Column', fmtCur(computed.summary.columnTotal));
  row('Solvents & Acid', fmtCur(computed.summary.solventsTotal));
  row('Consumables', fmtCur(computed.summary.consumablesTotal));
  doc.moveDown(0.2);
  row('SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal), { bold: true });

  ensureSpace(140);
  sectionTitle('Freight & Tax');
  row('Total Freight', fmtCur(computed.freightTaxCalc.freightTotal));
  row('Tax rate', `${((site.data.freightTax.taxRate || 0) * 100).toFixed(2)}%`);
  row('Tax amount', fmtCur(computed.freightTaxCalc.taxAmount));
  doc.moveDown(0.3);
  ensureSpace(50);
  doc.rect(50, doc.y, 495, 34).fillAndStroke(navy, navy);
  doc.fillColor('#fff').fontSize(13).text('FINAL TOTAL', 60, doc.y - 26);
  doc.fontSize(13).text(fmtCur(computed.freightTaxCalc.finalTotal), 360, doc.y - 15, { width: 175, align: 'right' });
  doc.moveDown(1.5);
  doc.fillColor('#000').fontSize(10);
  row('Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch));
  row('Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample));

  const tsNotes = (site.data.tenderSpec && site.data.tenderSpec.notes) || '';
  const siNotes = (site.data.supportingInfo && site.data.supportingInfo.notes) || '';
  if (tsNotes || siNotes) {
    ensureSpace(100);
    sectionTitle('Notes');
    if (tsNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Tender Specification:'); doc.font('Helvetica').fontSize(9).text(tsNotes); doc.moveDown(0.5); }
    if (siNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Supporting Information:'); doc.font('Helvetica').fontSize(9).text(siNotes); }
  }

  // Footer with page numbers on every page
  const pageRange = doc.bufferedPageRange();
  for (let i = 0; i < pageRange.count; i++) {
    doc.switchToPage(i);
    doc.fillColor('#999').fontSize(8).text(
      `Instrument purchase/depreciation cost is excluded, per scope.  \u2014  Page ${i + 1} of ${pageRange.count}`,
      50, 800, { width: 495, align: 'center' }
    );
  }

  doc.end();
}

module.exports = { buildExcelReport, buildPdfReport };
