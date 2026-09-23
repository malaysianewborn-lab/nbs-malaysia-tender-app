// Newborn Screening Malaysia — Tendering Cost Estimator
// Report generation: builds an Excel workbook and a PDF, both from the same
// computeAll() the app itself uses, so exported numbers always match the app.

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ---------- Report export (Excel & PDF) ----------
// Both reports are built from the same computeAll() the app itself uses, so
// exported numbers always match what's on screen.
function fmtCur(n) { return '$' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }

async function buildExcelReport(site, computed) {
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
  function styleTotalRow(row) {
    row.eachCell((cell) => { cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAY } }; });
  }

  // --- Summary sheet ---
  const sSummary = wb.addWorksheet('Summary');
  sSummary.columns = [{ width: 42 }, { width: 20 }];
  styleTitle(sSummary, `${site.name} \u2014 Tender Cost Summary`, 2);
  sSummary.addRow([]);
  sSummary.addRow(['Generated', new Date().toLocaleString()]);
  sSummary.addRow([]);
  const catHeader = sSummary.addRow(['Cost Category', 'Amount ($)']);
  styleHeaderRow(catHeader);
  const cats = [
    ['Reagents (IS, QC material)', computed.summary.reagentsTotal],
    ['Calibrator & QC Prep', computed.summary.calPrepTotal],
    ['Column & Guard Column', computed.summary.columnTotal],
    ['Solvents & Acid', computed.summary.solventsTotal],
    ['Consumables', computed.summary.consumablesTotal],
  ];
  cats.forEach(([label, val]) => sSummary.addRow([label, fmtCur(val)]));
  const subtotalRow = sSummary.addRow(['SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal)]);
  styleTotalRow(subtotalRow);
  sSummary.addRow([]);
  sSummary.addRow(['Total Freight', fmtCur(computed.freightTaxCalc.freightTotal)]);
  sSummary.addRow(['Total Tax', fmtCur(computed.freightTaxCalc.taxAmount)]);
  const finalRow = sSummary.addRow(['FINAL TOTAL', fmtCur(computed.freightTaxCalc.finalTotal)]);
  styleTotalRow(finalRow);
  finalRow.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY.replace('FF', 'FF') } };
  sSummary.addRow([]);
  sSummary.addRow(['Total batches', fmtNum(site.data.batchSetup.batches)]);
  sSummary.addRow(['Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches)]);
  sSummary.addRow(['Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch)]);
  sSummary.addRow(['Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample)]);

  // --- Batch Setup sheet ---
  const sBatch = wb.addWorksheet('Batch Setup');
  sBatch.columns = [{ width: 42 }, { width: 16 }];
  styleTitle(sBatch, 'Batch & Sample Design', 2);
  sBatch.addRow([]);
  const bs = site.data.batchSetup;
  [
    ['Number of batches', bs.batches], ['Study samples per batch', bs.samplesPerBatch],
    ['Calibrator levels per batch', bs.calLevels], ['Calibrator replicates per level', bs.calReps],
    ['QC levels per batch', bs.qcLevels], ['QC replicates per level', bs.qcReps],
    ['Blanks per batch', bs.blanksPerBatch],
  ].forEach((r) => sBatch.addRow(r));
  sBatch.addRow([]);
  const bc = computed.batchCalc;
  [
    ['Total calibrators per batch', bc.totalCalPerBatch], ['Total QCs per batch', bc.totalQCPerBatch],
    ['Total samples run per batch', bc.totalSamplesRunPerBatch], ['Total wells used per batch', bc.totalWellsUsedPerBatch],
    ['Wells remaining on 96-well plate', bc.wellsRemaining], ['Total samples run \u2014 all batches', bc.totalSamplesRunAllBatches],
    ['Total study samples \u2014 all batches', bc.totalStudySamplesAllBatches],
  ].forEach((r) => sBatch.addRow(r));

  // --- Reagents sheet ---
  const sReagents = wb.addWorksheet('Reagents');
  sReagents.columns = [{ width: 26 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sReagents, 'Reagents', 7);
  sReagents.addRow([]);
  const rHead = sReagents.addRow(['Component', 'Vol/use (\u00b5L)', 'Uses/batch', 'Vials needed', 'Cost/vial ($)', 'Total cost ($)', 'Cost/sample ($)']);
  styleHeaderRow(rHead);
  const rg = site.data.reagents;
  const rc = computed.reagentsCalc;
  sReagents.addRow(['Internal Standard (IS)', rg.is.volPerUse, rc.is.usesPerBatch, rc.is.vialsNeeded, rg.is.costPerVial, fmtCur(rc.is.totalCost), fmtCur(rc.is.costPerSample)]);
  sReagents.addRow(['QC material', rg.qc.volPerUse, rc.qc.usesPerBatch, rc.qc.vialsNeeded, rg.qc.costPerVial, fmtCur(rc.qc.totalCost), fmtCur(rc.qc.costPerSample)]);
  styleTotalRow(sReagents.addRow(['TOTAL', '', '', '', '', fmtCur(rc.totalCost), '']));

  // --- Column sheet ---
  const sColumn = wb.addWorksheet('Column');
  sColumn.columns = [{ width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sColumn, 'Analytical Column & Guard Column', 5);
  sColumn.addRow([]);
  const cHead = sColumn.addRow(['Component', 'Cost/unit ($)', 'Lifetime (samples)', 'Units needed', 'Total cost ($)']);
  styleHeaderRow(cHead);
  const col = site.data.column;
  const cc = computed.columnCalc;
  sColumn.addRow([col.analytical.label || 'Analytical column', col.analytical.cost, col.analytical.lifetime, cc.analytical.unitsNeeded, fmtCur(cc.analytical.totalCost)]);
  sColumn.addRow([col.guard.label || 'Guard column', col.guard.cost, col.guard.lifetime, cc.guard.unitsNeeded, fmtCur(cc.guard.totalCost)]);
  styleTotalRow(sColumn.addRow(['TOTAL', '', '', '', fmtCur(cc.totalCost)]));

  // --- Solvents & Acid sheet ---
  const sSolv = wb.addWorksheet('Solvents & Acid');
  sSolv.columns = [{ width: 34 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }];
  styleTitle(sSolv, 'Solvents & Acid', 5);
  sSolv.addRow([]);
  const svHead = sSolv.addRow(['Component', 'Vol/sample', 'Bottles needed', 'Cost/bottle ($)', 'Total cost ($)']);
  styleHeaderRow(svHead);
  const sv = site.data.solvents;
  const svc = computed.solventsCalc;
  sSolv.addRow(['Water (Mobile Phase A)', svc.water.volPerSample.toFixed(3), svc.water.bottlesNeeded, sv.water.costPerBottle, fmtCur(svc.water.totalCost)]);
  sSolv.addRow(['Acetonitrile (Mobile Phase B)', svc.acn.volPerSample.toFixed(3), svc.acn.bottlesNeeded, sv.acn.costPerBottle, fmtCur(svc.acn.totalCost)]);
  sSolv.addRow(['PFHeptA/TDHFA', svc.pfhepta.volPerSample.toFixed(4), svc.pfhepta.bottlesNeeded, sv.pfhepta.costPerBottle, fmtCur(svc.pfhepta.totalCost)]);
  sSolv.addRow(['Calibrator dilution methanol', svc.calibratorMethanol.volPerBatchML.toFixed(3) + ' mL/batch', svc.calibratorMethanol.bottlesNeeded, sv.calibratorMethanol.costPerBottle, fmtCur(svc.calibratorMethanol.totalCost)]);
  svc.generalSolvents.forEach((g) => sSolv.addRow([g.name, g.qty + ' units', '', g.costPerUnit, fmtCur(g.totalCost)]));
  styleTotalRow(sSolv.addRow(['TOTAL', '', '', '', fmtCur(svc.totalCost)]));

  // --- Consumables sheet ---
  const sCons = wb.addWorksheet('Consumables');
  sCons.columns = [{ width: 34 }, { width: 14 }, { width: 16 }, { width: 14 }];
  styleTitle(sCons, 'General Lab Consumables', 4);
  sCons.addRow([]);
  const consHead = sCons.addRow(['Item', 'Quantity', 'Cost/unit ($)', 'Total cost ($)']);
  styleHeaderRow(consHead);
  computed.consumablesCalc.items.forEach((it) => sCons.addRow([it.name, it.qty, it.costPerUnit, fmtCur(it.totalCost)]));
  styleTotalRow(sCons.addRow(['TOTAL', '', '', fmtCur(computed.consumablesCalc.totalCost)]));

  // --- Freight & Tax sheet ---
  const sFreight = wb.addWorksheet('Freight & Tax');
  sFreight.columns = [{ width: 40 }, { width: 16 }];
  styleTitle(sFreight, 'Freight & Tax', 2);
  sFreight.addRow([]);
  const ft = computed.freightTaxCalc;
  if (ft.freightItems.length) {
    const fHead = sFreight.addRow(['Freight Item', 'Amount ($)']);
    styleHeaderRow(fHead);
    ft.freightItems.forEach((f) => sFreight.addRow([f.description || '(unnamed)', fmtCur(f.amount)]));
    sFreight.addRow([]);
  }
  sFreight.addRow(['Total Freight', fmtCur(ft.freightTotal)]);
  sFreight.addRow(['Tax rate', `${((site.data.freightTax.taxRate || 0) * 100).toFixed(2)}%`]);
  sFreight.addRow(['Taxable base', fmtCur(ft.taxableBase)]);
  sFreight.addRow(['Tax amount', fmtCur(ft.taxAmount)]);
  styleTotalRow(sFreight.addRow(['FINAL TOTAL', fmtCur(ft.finalTotal)]));

  // --- Tender Spec & Notes sheet ---
  const sNotes = wb.addWorksheet('Tender Spec & Notes');
  sNotes.columns = [{ width: 100 }];
  styleTitle(sNotes, 'Tender Spec & Supporting Notes', 1);
  sNotes.addRow([]);
  sNotes.addRow(['Tender Specification Notes:']).font = { bold: true };
  sNotes.addRow([(site.data.tenderSpec && site.data.tenderSpec.notes) || '(none)']);
  sNotes.addRow([]);
  sNotes.addRow(['Supporting Information Notes:']).font = { bold: true };
  sNotes.addRow([(site.data.supportingInfo && site.data.supportingInfo.notes) || '(none)']);

  return wb.xlsx.writeBuffer();
}

function buildPdfReport(site, computed, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(res);

  const navy = '#1f4e78';
  doc.fillColor(navy).fontSize(20).text('Newborn Screening Malaysia', { align: 'left' });
  doc.fillColor('#555').fontSize(11).text('Tender Cost Estimate Report', { align: 'left' });
  doc.moveDown(0.3);
  doc.fillColor('#000').fontSize(14).text(site.name);
  doc.fillColor('#888').fontSize(9).text(`Generated ${new Date().toLocaleString()}`);
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

  const bs = site.data.batchSetup;
  sectionTitle('Batch Setup');
  row('Number of batches', fmtNum(bs.batches));
  row('Study samples per batch', fmtNum(bs.samplesPerBatch));
  row('Calibrator levels x replicates', `${bs.calLevels} \u00d7 ${bs.calReps}`);
  row('QC levels x replicates', `${bs.qcLevels} \u00d7 ${bs.qcReps}`);
  row('Total study samples (all batches)', fmtNum(computed.batchCalc.totalStudySamplesAllBatches));

  sectionTitle('Cost Breakdown');
  row('Reagents (IS, QC material)', fmtCur(computed.summary.reagentsTotal));
  row('Calibrator & QC Prep', fmtCur(computed.summary.calPrepTotal));
  row('Column & Guard Column', fmtCur(computed.summary.columnTotal));
  row('Solvents & Acid', fmtCur(computed.summary.solventsTotal));
  row('Consumables', fmtCur(computed.summary.consumablesTotal));
  doc.moveDown(0.2);
  row('SUBTOTAL (before freight & tax)', fmtCur(computed.summary.grandTotal), { bold: true });

  sectionTitle('Freight & Tax');
  row('Total Freight', fmtCur(computed.freightTaxCalc.freightTotal));
  row('Tax rate', `${((site.data.freightTax.taxRate || 0) * 100).toFixed(2)}%`);
  row('Tax amount', fmtCur(computed.freightTaxCalc.taxAmount));
  doc.moveDown(0.3);
  doc.rect(50, doc.y, 495, 34).fillAndStroke('#1f4e78', '#1f4e78');
  doc.fillColor('#fff').fontSize(13).text('FINAL TOTAL', 60, doc.y - 26);
  doc.fontSize(13).text(fmtCur(computed.freightTaxCalc.finalTotal), 360, doc.y - 15, { width: 175, align: 'right' });
  doc.moveDown(1.5);
  doc.fillColor('#000').fontSize(10);
  row('Final cost per batch', fmtCur(computed.freightTaxCalc.finalCostPerBatch));
  row('Final cost per study sample', fmtCur(computed.freightTaxCalc.finalCostPerSample));

  const tsNotes = (site.data.tenderSpec && site.data.tenderSpec.notes) || '';
  const siNotes = (site.data.supportingInfo && site.data.supportingInfo.notes) || '';
  if (tsNotes || siNotes) {
    sectionTitle('Notes');
    if (tsNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Tender Specification:'); doc.font('Helvetica').fontSize(9).text(tsNotes); doc.moveDown(0.5); }
    if (siNotes) { doc.font('Helvetica-Bold').fontSize(10).text('Supporting Information:'); doc.font('Helvetica').fontSize(9).text(siNotes); }
  }

  doc.fillColor('#999').fontSize(8).text('Instrument purchase/depreciation cost is excluded, per scope.', 50, 780, { width: 495, align: 'center' });
  doc.end();
}

module.exports = { buildExcelReport, buildPdfReport };
