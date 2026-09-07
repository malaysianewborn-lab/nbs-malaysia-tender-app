/* Calculation engine — mirrors the Excel workbook's formulas exactly.
   Pure functions: (site data) -> (computed values). No side effects. */

function roundUp(value, decimals = 0) {
  const f = Math.pow(10, decimals);
  return Math.ceil((value - Number.EPSILON) * f) / f;
}

function safeDiv(a, b) {
  return b ? a / b : 0;
}

// ---------- Batch Setup ----------
function computeBatch(bs) {
  const totalCalPerBatch = bs.calLevels * bs.calReps;
  const totalQCPerBatch = bs.qcLevels * bs.qcReps;
  const totalSamplesRunPerBatch = bs.samplesPerBatch + totalCalPerBatch + totalQCPerBatch + bs.blanksPerBatch;
  const totalWellsUsedPerBatch = totalSamplesRunPerBatch;
  const wellsRemaining = 96 - totalWellsUsedPerBatch;
  const totalSamplesRunAllBatches = totalSamplesRunPerBatch * bs.batches;
  const totalStudySamplesAllBatches = bs.samplesPerBatch * bs.batches;
  const totalCalAllBatches = totalCalPerBatch * bs.batches;
  const totalQCAllBatches = totalQCPerBatch * bs.batches;
  const totalBlanksAllBatches = bs.blanksPerBatch * bs.batches;
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
    const dt = r2.time - r1.time;
    const avgFlow = (r1.flow + r2.flow) / 2;
    const avgA = (r1.a + r2.a) / 2;
    const avgB = (r1.b + r2.b) / 2;
    const segVol = dt * avgFlow;
    const segVolA = (segVol * avgA) / 100;
    const segVolB = (segVol * avgB) / 100;
    segments.push({ from: r1.time, to: r2.time, dt, avgFlow, avgA, avgB, segVol, segVolA, segVolB });
    volA += segVolA;
    volB += segVolB;
  }
  return { segments, volA, volB, totalVol: volA + volB };
}

// ---------- Calibrator & QC Prep ----------
function computeCalibratorPrep(cp, batches) {
  const totalMethanolPerBatchUL = cp.stockDilution.reduce((sum, r) => sum + (r.meoh || 0), 0);
  const s2Vol = (cp.stockDilution[1] && cp.stockDilution[1].vol) || 0; // volume of S1 drawn to make S2
  const p1Vol = (cp.workingPrep[0] && cp.workingPrep[0].vol) || 0; // volume of S1 drawn directly for P1
  const totalStdPerBatchUL = s2Vol + p1Vol;
  const totalISForCalPerBatch = cp.workingPrep.reduce((sum, r) => sum + (r.isVol || 0), 0);

  const std = cp.standard;
  const stdTotalVol = totalStdPerBatchUL * batches;
  const stdUsable = std.vialSize - std.dead;
  const stdVialsNeeded = stdUsable > 0 ? Math.ceil(stdTotalVol / stdUsable) : 0;
  const stdTotalCost = stdVialsNeeded * std.costPerVial;

  const meoh = cp.methanol;
  const meohPerBatchML = totalMethanolPerBatchUL / 1000;
  const meohTotalVolML = meohPerBatchML * batches;
  const meohUsable = meoh.bottleSize - meoh.dead;
  const meohBottlesNeeded = meohUsable > 0 ? Math.ceil(meohTotalVolML / meohUsable) : 0;
  const meohTotalCost = meohBottlesNeeded * meoh.costPerBottle;

  return {
    totalMethanolPerBatchUL, totalStdPerBatchUL, totalISForCalPerBatch,
    stdTotalVol, stdUsable, stdVialsNeeded, stdTotalCost,
    meohPerBatchML, meohTotalVolML, meohUsable, meohBottlesNeeded, meohTotalCost,
    calPrepTotalCost: stdTotalCost + meohTotalCost,
  };
}

// ---------- Reagents (IS, QC material) ----------
function computeReagents(reagents, batchCalc, batches) {
  function line(cfg, usesPerBatch) {
    const volRequiredPerBatch = cfg.volPerUse * usesPerBatch;
    const volRequiredAllBatches = volRequiredPerBatch * batches;
    const usableVol = cfg.vialSize - cfg.dead;
    const vialsNeeded = usableVol > 0 ? Math.ceil(volRequiredAllBatches / usableVol) : 0;
    const totalCost = vialsNeeded * cfg.costPerVial;
    const totalUsesAllBatches = usesPerBatch * batches;
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
    const totalSamplesNeeded = batchCalc.totalSamplesRunAllBatches;
    const unitsNeeded = cfg.lifetime > 0 ? Math.ceil(totalSamplesNeeded / cfg.lifetime) : 0;
    const totalCost = unitsNeeded * cfg.cost;
    const costPerSample = safeDiv(totalCost, totalSamplesNeeded);
    return { totalSamplesNeeded, unitsNeeded, totalCost, costPerSample };
  }
  const analytical = line(column.analytical);
  const guard = line(column.guard);
  return { analytical, guard, totalCost: analytical.totalCost + guard.totalCost };
}

// ---------- Solvents & Acid ----------
function computeSolvents(solvents, gradientCalc, batchCalc) {
  const totalSamples = batchCalc.totalSamplesRunAllBatches;
  function line(cfg, volPerSample) {
    const volRequired = volPerSample * totalSamples;
    const usable = cfg.bottleSize - cfg.dead;
    const bottlesNeeded = usable > 0 ? Math.ceil(volRequired / usable) : 0;
    const totalCost = bottlesNeeded * cfg.costPerBottle;
    const costPerSample = safeDiv(totalCost, totalSamples);
    return { volPerSample, volRequired, usable, bottlesNeeded, totalCost, costPerSample };
  }
  const water = line(solvents.water, gradientCalc.volA);
  const acn = line(solvents.acn, gradientCalc.volB);
  const pfheptaVolPerSample = solvents.pfheptaConc * (water.volPerSample + acn.volPerSample);
  const pfhepta = line(solvents.pfhepta, pfheptaVolPerSample);
  return { water, acn, pfhepta, totalCost: water.totalCost + acn.totalCost + pfhepta.totalCost };
}

// ---------- Full site computation ----------
function computeAll(data) {  const batchCalc = computeBatch(data.batchSetup);
  const gradientCalc = computeGradient(data.lcGradient);
  const calPrepCalc = computeCalibratorPrep(data.calibratorPrep, data.batchSetup.batches);
  const reagentsCalc = computeReagents(data.reagents, batchCalc, data.batchSetup.batches);
  const columnCalc = computeColumn(data.column, batchCalc);
  const solventsCalc = computeSolvents(data.solvents, gradientCalc, batchCalc);

  const grandTotal = reagentsCalc.totalCost + calPrepCalc.calPrepTotalCost + columnCalc.totalCost + solventsCalc.totalCost;
  const costPerBatch = safeDiv(grandTotal, data.batchSetup.batches);
  const costPerStudySample = safeDiv(grandTotal, batchCalc.totalStudySamplesAllBatches);

  return {
    batchCalc, gradientCalc, calPrepCalc, reagentsCalc, columnCalc, solventsCalc,
    summary: {
      reagentsTotal: reagentsCalc.totalCost,
      calPrepTotal: calPrepCalc.calPrepTotalCost,
      columnTotal: columnCalc.totalCost,
      solventsTotal: solventsCalc.totalCost,
      grandTotal, costPerBatch, costPerStudySample,
    },
  };
}

if (typeof module !== 'undefined') module.exports = { computeAll, computeBatch, computeGradient, computeCalibratorPrep, computeReagents, computeColumn, computeSolvents };
