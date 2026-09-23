/* Calculation engine — mirrors the Excel workbook's formulas exactly.
   Pure functions: (site data) -> (computed values). No side effects. */

function roundUp(value, decimals = 0) {
  const f = Math.pow(10, decimals);
  return Math.ceil((value - Number.EPSILON) * f) / f;
}

function safeDiv(a, b) {
  return b ? a / b : 0;
}

// Coerces any value to a finite number, falling back to 0 (or a given
// fallback) for anything malformed — undefined, null, non-numeric strings,
// or an already-NaN result of a previous bad calculation. Used everywhere a
// number is read from stored data, so one bad/missing field can never cause
// a whole row of downstream figures to silently go blank.
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- Batch Setup ----------
function computeBatch(bs) {
  const batches = num(bs.batches, 1);
  const samplesPerBatch = num(bs.samplesPerBatch);
  const calLevels = num(bs.calLevels);
  const calReps = num(bs.calReps);
  const qcLevels = num(bs.qcLevels);
  const qcReps = num(bs.qcReps);
  const blanksPerBatch = num(bs.blanksPerBatch);
  const totalCalPerBatch = calLevels * calReps;
  const totalQCPerBatch = qcLevels * qcReps;
  const totalSamplesRunPerBatch = samplesPerBatch + totalCalPerBatch + totalQCPerBatch + blanksPerBatch;
  const totalWellsUsedPerBatch = totalSamplesRunPerBatch;
  const wellsRemaining = 96 - totalWellsUsedPerBatch;
  const totalSamplesRunAllBatches = totalSamplesRunPerBatch * batches;
  const totalStudySamplesAllBatches = samplesPerBatch * batches;
  const totalCalAllBatches = totalCalPerBatch * batches;
  const totalQCAllBatches = totalQCPerBatch * batches;
  const totalBlanksAllBatches = blanksPerBatch * batches;
  return {
    totalCalPerBatch, totalQCPerBatch, totalSamplesRunPerBatch, totalWellsUsedPerBatch,
    wellsRemaining, totalSamplesRunAllBatches, totalStudySamplesAllBatches,
    totalCalAllBatches, totalQCAllBatches, totalBlanksAllBatches,
  };
}

// ---------- LC Gradient (trapezoidal integration) ----------
function computeGradient(rows) {
  const segments = [];
  let volA = 0;
  let volB = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const r1 = rows[i];
    const r2 = rows[i + 1];
    const t1 = num(r1.time), t2 = num(r2.time);
    const dt = t2 - t1;
    const avgFlow = (num(r1.flow) + num(r2.flow)) / 2;
    const avgA = (num(r1.a) + num(r2.a)) / 2;
    const avgB = (num(r1.b) + num(r2.b)) / 2;
    const segVol = dt * avgFlow;
    const segVolA = (segVol * avgA) / 100;
    const segVolB = (segVol * avgB) / 100;
    segments.push({ from: t1, to: t2, dt, avgFlow, avgA, avgB, segVol, segVolA, segVolB });
    volA += segVolA;
    volB += segVolB;
  }
  return { segments, volA, volB, totalVol: volA + volB };
}

// ---------- Calibrator & QC Prep ----------
function computeCalibratorPrep(cp, batches) {
  const stockDilution = cp.stockDilution || [];
  const workingPrep = cp.workingPrep || [];
  const totalMethanolPerBatchUL = stockDilution.reduce((sum, r) => sum + num(r && r.meoh), 0);
  const s2Vol = num(stockDilution[1] && stockDilution[1].vol); // volume of S1 drawn to make S2
  const p1Vol = num(workingPrep[0] && workingPrep[0].vol); // volume of S1 drawn directly for P1
  const totalStdPerBatchUL = s2Vol + p1Vol;
  const totalISForCalPerBatch = workingPrep.reduce((sum, r) => sum + num(r && r.isVol), 0);

  const std = cp.standard || {};
  const vialSize = num(std.vialSize);
  const dead = num(std.dead);
  const costPerVial = num(std.costPerVial);
  const stdTotalVol = totalStdPerBatchUL * num(batches, 1);
  const stdUsable = vialSize - dead;
  const stdVialsNeeded = stdUsable > 0 ? Math.ceil(stdTotalVol / stdUsable) : 0;
  const stdTotalCost = stdVialsNeeded * costPerVial;

  return {
    totalMethanolPerBatchUL, totalStdPerBatchUL, totalISForCalPerBatch,
    stdTotalVol, stdUsable, stdVialsNeeded, stdTotalCost,
    calPrepTotalCost: stdTotalCost, // methanol is costed on the Solvents & Acid tab now
  };
}

// ---------- Reagents (IS, QC material) ----------
function computeReagents(reagents, batchCalc, batches) {
  function line(cfg, usesPerBatch) {
    cfg = cfg || {};
    usesPerBatch = num(usesPerBatch);
    const volPerUse = num(cfg.volPerUse);
    const vialSize = num(cfg.vialSize);
    const dead = num(cfg.dead);
    const costPerVial = num(cfg.costPerVial);
    const volRequiredPerBatch = volPerUse * usesPerBatch;
    const volRequiredAllBatches = volRequiredPerBatch * num(batches, 1);
    const usableVol = vialSize - dead;
    const vialsNeeded = usableVol > 0 ? Math.ceil(volRequiredAllBatches / usableVol) : 0;
    const totalCost = vialsNeeded * costPerVial;
    const totalUsesAllBatches = usesPerBatch * num(batches, 1);
    const costPerSample = safeDiv(totalCost, totalUsesAllBatches);
    return { usesPerBatch, volRequiredPerBatch, volRequiredAllBatches, usableVol, vialsNeeded, totalCost, totalUsesAllBatches, costPerSample };
  }
  const is = line(reagents.is, batchCalc.totalSamplesRunPerBatch);
  const qc = line(reagents.qc, batchCalc.totalQCPerBatch);
  return { is, qc, totalCost: is.totalCost + qc.totalCost };
}

// ---------- Column & Guard Column ----------
function computeColumn(column, batchCalc) {
  function line(cfg) {
    cfg = cfg || {};
    const lifetime = num(cfg.lifetime);
    const cost = num(cfg.cost);
    const totalSamplesNeeded = num(batchCalc.totalSamplesRunAllBatches);
    const unitsNeeded = lifetime > 0 ? Math.ceil(totalSamplesNeeded / lifetime) : 0;
    const totalCost = unitsNeeded * cost;
    const costPerSample = safeDiv(totalCost, totalSamplesNeeded);
    return { totalSamplesNeeded, unitsNeeded, totalCost, costPerSample };
  }
  const analytical = line(column.analytical);
  const guard = line(column.guard);
  return { analytical, guard, totalCost: analytical.totalCost + guard.totalCost };
}

// ---------- Solvents & Acid ----------
function computeSolvents(solvents, gradientCalc, batchCalc, calPrepCalc, batches) {
  const totalSamples = num(batchCalc.totalSamplesRunAllBatches);
  const batchesNum = num(batches, 1);
  function line(cfg, volPerSample) {
    cfg = cfg || {};
    volPerSample = num(volPerSample);
    const bottleSize = num(cfg.bottleSize);
    const dead = num(cfg.dead);
    const costPerBottle = num(cfg.costPerBottle);
    const volRequired = volPerSample * totalSamples;
    const usable = bottleSize - dead;
    const bottlesNeeded = usable > 0 ? Math.ceil(volRequired / usable) : 0;
    const totalCost = bottlesNeeded * costPerBottle;
    const costPerSample = safeDiv(totalCost, totalSamples);
    return { volPerSample, volRequired, usable, bottlesNeeded, totalCost, costPerSample };
  }
  const water = line(solvents.water, gradientCalc.volA);
  const acn = line(solvents.acn, gradientCalc.volB);
  const pfheptaVolPerSample = num(solvents.pfheptaConc) * (water.volPerSample + acn.volPerSample);
  const pfhepta = line(solvents.pfhepta, pfheptaVolPerSample);
  const mobilePhaseTotal = water.totalCost + acn.totalCost + pfhepta.totalCost;

  // Calibrator dilution methanol: per-BATCH driven (not per-sample), linked from Calibrator & QC Prep
  const cm = solvents.calibratorMethanol || {};
  const cmBottleSize = num(cm.bottleSize, 4000);
  const cmDead = num(cm.dead, 30);
  const cmCostPerBottle = num(cm.costPerBottle, 45);
  const cmVolPerBatchML = num(calPrepCalc && calPrepCalc.totalMethanolPerBatchUL) / 1000;
  const cmTotalVolML = cmVolPerBatchML * batchesNum;
  const cmUsable = cmBottleSize - cmDead;
  const cmBottlesNeeded = cmUsable > 0 ? Math.ceil(cmTotalVolML / cmUsable) : 0;
  const cmTotalCost = cmBottlesNeeded * cmCostPerBottle;
  const calibratorMethanol = { volPerBatchML: cmVolPerBatchML, totalVolML: cmTotalVolML, usable: cmUsable, bottlesNeeded: cmBottlesNeeded, totalCost: cmTotalCost, costPerBatch: safeDiv(cmTotalCost, batchesNum) };

  // General lab & maintenance solvents: flat manual quantity x cost, not sample/batch driven
  const generalSolvents = (solvents.generalSolvents || []).map((g) => ({
    ...g, totalCost: num(g && g.qty) * num(g && g.costPerUnit),
  }));
  const generalSolventsTotal = generalSolvents.reduce((sum, g) => sum + g.totalCost, 0);

  const totalCost = mobilePhaseTotal + calibratorMethanol.totalCost + generalSolventsTotal;
  return { water, acn, pfhepta, mobilePhaseTotal, calibratorMethanol, generalSolvents, generalSolventsTotal, totalCost };
}

// ---------- Consumables (general lab consumables, flat quantity x cost) ----------
function computeConsumables(consumables) {
  const items = ((consumables && consumables.items) || []).map((it) => ({
    ...it, totalCost: num(it && it.qty) * num(it && it.costPerUnit),
  }));
  const totalCost = items.reduce((sum, it) => sum + it.totalCost, 0);
  return { items, totalCost };
}

// ---------- Freight & Tax ----------
function computeFreightTax(freightTax, subtotal, batches, totalStudySamplesAllBatches) {
  freightTax = freightTax || {};
  const freightItems = (freightTax.freightItems || []).map((f) => ({ ...f, amount: num(f && f.amount) }));
  const freightTotal = freightItems.reduce((sum, f) => sum + f.amount, 0);
  const taxableBase = num(subtotal) + (freightTax.applyTaxToFreight ? freightTotal : 0);
  const taxAmount = taxableBase * num(freightTax.taxRate);
  const finalTotal = num(subtotal) + freightTotal + taxAmount;
  return {
    freightItems, freightTotal, taxableBase, taxAmount, finalTotal,
    finalCostPerBatch: safeDiv(finalTotal, num(batches, 1)),
    finalCostPerSample: safeDiv(finalTotal, num(totalStudySamplesAllBatches)),
  };
}

// ---------- Full site computation ----------
function computeAll(data) {
  const batchCalc = computeBatch(data.batchSetup);
  const gradientCalc = computeGradient(data.lcGradient);
  const calPrepCalc = computeCalibratorPrep(data.calibratorPrep, data.batchSetup.batches);
  const reagentsCalc = computeReagents(data.reagents, batchCalc, data.batchSetup.batches);
  const columnCalc = computeColumn(data.column, batchCalc);
  const solventsCalc = computeSolvents(data.solvents, gradientCalc, batchCalc, calPrepCalc, data.batchSetup.batches);
  const consumablesCalc = computeConsumables(data.consumables);

  const grandTotal = reagentsCalc.totalCost + calPrepCalc.calPrepTotalCost + columnCalc.totalCost
    + solventsCalc.totalCost + consumablesCalc.totalCost;
  const costPerBatch = safeDiv(grandTotal, data.batchSetup.batches);
  const costPerStudySample = safeDiv(grandTotal, batchCalc.totalStudySamplesAllBatches);

  const freightTaxCalc = computeFreightTax(
    data.freightTax || { freightItems: [], taxRate: 0, applyTaxToFreight: true },
    grandTotal, data.batchSetup.batches, batchCalc.totalStudySamplesAllBatches
  );

  return {
    batchCalc, gradientCalc, calPrepCalc, reagentsCalc, columnCalc, solventsCalc, consumablesCalc, freightTaxCalc,
    summary: {
      reagentsTotal: reagentsCalc.totalCost,
      calPrepTotal: calPrepCalc.calPrepTotalCost,
      columnTotal: columnCalc.totalCost,
      solventsTotal: solventsCalc.totalCost,
      consumablesTotal: consumablesCalc.totalCost,
      grandTotal, costPerBatch, costPerStudySample,
    },
  };
}

if (typeof module !== 'undefined') module.exports = { computeAll, computeBatch, computeGradient, computeCalibratorPrep, computeReagents, computeColumn, computeSolvents, computeConsumables, computeFreightTax };
